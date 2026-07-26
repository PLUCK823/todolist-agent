import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AgentTurn from '../AgentTurn'
import type { AgentTurn as AgentTurnModel } from '../agent.types'

function makeTurn(overrides: Partial<AgentTurnModel> = {}): AgentTurnModel {
  return {
    id: 'turn-1',
    ordinal: 1,
    status: 'completed',
    startedAt: '2026-07-20T08:00:00Z',
    completedAt: '2026-07-20T08:00:02Z',
    resultUncertain: false,
    messages: [
      { id: 'user-1', role: 'user', content: '列出今天的任务', createdAt: '2026-07-20T08:00:00Z' },
      { id: 'assistant-1', role: 'assistant', content: '完成。', createdAt: '2026-07-20T08:00:02Z' },
    ],
    steps: [{ id: 'step-1', label: '查询任务', status: 'completed', durationMs: 1250 }],
    ...overrides,
  }
}

describe('AgentTurn', () => {
  it('renders user, assistant, then its execution disclosure in DOM order', () => {
    render(<AgentTurn turn={makeTurn()} />)

    const turn = screen.getByTestId('agent-turn-turn-1')
    expect(Array.from(turn.children).map((node) => node.getAttribute('data-role') ?? node.getAttribute('data-part')))
      .toEqual(['user', 'assistant', 'execution-details'])
    expect(within(turn).getAllByRole('article').map((node) => node.dataset.role)).toEqual(['user', 'assistant'])
  })

  it('renders assistant GFM tables while leaving raw HTML inert', () => {
    render(<AgentTurn turn={makeTurn({
      messages: [
        { id: 'user-1', role: 'user', content: '<b>用户原文</b>', createdAt: '2026-07-20T08:00:00Z' },
        { id: 'assistant-1', role: 'assistant', content: '| 任务 | 状态 |\n| --- | --- |\n| 原型 | 完成 |\n<script>alert(1)</script>', createdAt: '2026-07-20T08:00:02Z' },
      ],
    })} />)

    expect(screen.getByText('<b>用户原文</b>')).toBeVisible()
    expect(screen.getByRole('table')).toHaveTextContent('原型')
    expect(screen.getByText('<script>alert(1)</script>')).toBeVisible()
    expect(document.querySelector('script')).toBeNull()
  })

  it.each([
    ['completed', 'false'],
    ['running', 'true'],
    ['waiting_confirmation', 'true'],
    ['failed', 'true'],
    ['interrupted', 'true'],
  ] as const)('defaults %s turns to expanded=%s', (status, expanded) => {
    render(<AgentTurn turn={makeTurn({ status })} />)
    expect(screen.getByRole('button', { name: /执行详情/ })).toHaveAttribute('aria-expanded', expanded)
  })

  it('resets disclosure only when status changes and respects manual toggles within a status', async () => {
    const user = userEvent.setup()
    const view = render(<AgentTurn turn={makeTurn({ status: 'completed' })} />)
    const disclosure = screen.getByRole('button', { name: /执行详情/ })

    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    view.rerender(<AgentTurn turn={makeTurn({ status: 'completed', steps: [...makeTurn().steps, { id: 'step-2', label: '同步', status: 'completed' }] })} />)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    view.rerender(<AgentTurn turn={makeTurn({ status: 'failed' })} />)
    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'))
    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    view.rerender(<AgentTurn turn={makeTurn({ status: 'failed', failureMessage: '仍然失败' })} />)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')

    view.rerender(<AgentTurn turn={makeTurn({ status: 'running' })} />)
    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'))
  })

  it('shows step count, aggregate status, summed duration, and an uncertain-result warning', () => {
    render(<AgentTurn turn={makeTurn({
      status: 'failed',
      resultUncertain: true,
      steps: [
        { id: 'step-1', label: '创建', status: 'completed', durationMs: 800 },
        { id: 'step-2', label: '同步', status: 'failed', durationMs: 450 },
      ],
    })} />)

    const disclosure = screen.getByRole('button', { name: /执行详情/ })
    expect(disclosure).toHaveTextContent('2 个步骤')
    expect(disclosure).toHaveTextContent('失败')
    expect(disclosure).toHaveTextContent('1.3 秒')
    expect(screen.getByRole('alert')).toHaveTextContent('操作可能已生效，请检查任务状态')
  })

  it('renders one confirmation control and does not expose a historical retry without a token', () => {
    render(<AgentTurn
      turn={makeTurn({
        status: 'waiting_confirmation',
        steps: [
          { id: 'confirm', label: '删除任务', status: 'waiting_confirmation', confirmationId: 'confirm-1', confirmationMessage: '确定删除？' },
          { id: 'failed', label: '查询任务', status: 'failed', retryable: true, errorMessage: '超时' },
        ],
      })}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
    />)

    expect(screen.getAllByRole('button', { name: '确认删除任务' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '重试查询任务' })).not.toBeInTheDocument()
  })

  it('chooses only one canonical confirmation and prevents duplicate submission', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<AgentTurn
      turn={makeTurn({
        status: 'waiting_confirmation',
        steps: [
          { id: 'confirm-1', label: '删除任务一', status: 'waiting_confirmation', confirmationId: 'confirmation-1' },
          { id: 'confirm-2', label: '删除任务二', status: 'waiting_confirmation', confirmationId: 'confirmation-2' },
        ],
      })}
      pendingConfirmationId="confirmation-1"
      onConfirm={onConfirm}
    />)

    const confirm = screen.getByRole('button', { name: '确认删除任务一' })
    expect(screen.queryByRole('button', { name: '确认删除任务二' })).not.toBeInTheDocument()
    await user.click(confirm)
    await user.click(confirm)
    expect(confirm).toBeDisabled()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('offers only one live-authorized retry and suppresses all retries for uncertain results', () => {
    const steps: AgentTurnModel['steps'] = [
      { id: 'retry-1', label: '查询一', status: 'failed', retryable: true },
      { id: 'retry-2', label: '查询二', status: 'failed', retryable: true },
    ]
    const view = render(<AgentTurn turn={makeTurn({ status: 'failed', steps })} canRetry={() => true} />)
    expect(screen.getByRole('button', { name: '重试查询一' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '重试查询二' })).not.toBeInTheDocument()

    view.rerender(<AgentTurn turn={makeTurn({ status: 'failed', resultUncertain: true, steps })} canRetry={() => true} />)
    expect(screen.queryByRole('button', { name: /重试查询/ })).not.toBeInTheDocument()
  })

  it('hides stale confirmation controls when the result is uncertain', () => {
    render(<AgentTurn turn={makeTurn({
      status: 'waiting_confirmation',
      resultUncertain: true,
      steps: [{ id: 'confirm', label: '删除任务', status: 'waiting_confirmation', confirmationId: 'confirmation-1' }],
    })} />)
    expect(screen.queryByRole('button', { name: '确认删除任务' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消删除任务' })).not.toBeInTheDocument()
  })

  it('links unique stable disclosure ids across multiple turns', () => {
    const view = render(<><AgentTurn turn={makeTurn()} /><AgentTurn turn={makeTurn({ id: 'turn-2', ordinal: 2 })} /></>)
    const buttons = screen.getAllByRole('button', { name: /执行详情/ })
    const ids = buttons.map((button) => button.getAttribute('aria-controls'))
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => expect(document.getElementById(id!)).toHaveAttribute('role', 'region'))

    view.rerender(<><AgentTurn turn={makeTurn({ failureMessage: '更新' })} /><AgentTurn turn={makeTurn({ id: 'turn-2', ordinal: 2 })} /></>)
    expect(screen.getAllByRole('button', { name: /执行详情/ }).map((button) => button.getAttribute('aria-controls'))).toEqual(ids)
  })
})
