import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import styles from '../../../styles/global.css?raw'
import { AgentMarkdown } from '../AgentMarkdown'

describe('AgentMarkdown', () => {
  it('renders semantic Markdown and GFM content', () => {
    render(<AgentMarkdown content={`# 执行摘要

这里有 **重点**、~~旧状态~~ 和 \`inline()\`。

> 保留上下文

- 第一项
- [x] 已完成
- [ ] 待处理

\`\`\`ts
const status = 'ready'
\`\`\`

| 任务 | 状态 |
| --- | --- |
| 发布 | 完成 |`} />)

    expect(screen.getByRole('heading', { name: '执行摘要', level: 1 })).toBeVisible()
    expect(screen.getByText('重点').tagName).toBe('STRONG')
    expect(screen.getByText('旧状态').tagName).toBe('DEL')
    expect(screen.getByText('保留上下文').closest('blockquote')).toBeInTheDocument()
    expect(screen.getByText("const status = 'ready'").closest('pre')).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes.every((checkbox) => checkbox.hasAttribute('disabled'))).toBe(true)

    const region = screen.getByRole('region', { name: 'Markdown 表格' })
    expect(region).toHaveClass('agent-markdown__table-scroll')
    expect(region).toHaveAttribute('tabindex', '0')
    const table = within(region).getByRole('table')
    expect(table.querySelector('thead')).toBeInTheDocument()
    expect(table.querySelector('tbody')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: '任务' })).toBeVisible()
    expect(within(table).getByRole('cell', { name: '完成' })).toBeVisible()
  })

  it('opens only external http(s) links in a protected new tab', () => {
    render(<AgentMarkdown content={`[外站](https://example.com/docs) [同源](${window.location.origin}/guide) [相对](/tasks/1) [锚点](#result) [邮件](mailto:team@example.com)`} />)

    expect(screen.getByRole('link', { name: '外站' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.getByRole('link', { name: '外站' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '外站' })).toHaveAttribute('rel', 'noopener noreferrer')

    for (const name of ['同源', '相对', '锚点', '邮件']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('target')
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('rel')
    }
  })

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['mixed case', 'JaVaScRiPt:alert(1)'],
    ['data', 'data:text/html,boom'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['leading space', ' javascript:alert(1)'],
    ['leading control', '\u0001javascript:alert(1)'],
    ['embedded control', 'java\u0000script:alert(1)'],
    ['percent encoded scheme', '%6Aavascript:alert(1)'],
    ['percent encoded colon', 'javascript%3Aalert(1)'],
    ['HTML entity colon', 'javascript&#x3A;alert(1)'],
    ['protocol relative', '//evil.example/track'],
    ['backslash confusion', 'https:\\evil.example/track'],
  ])('does not emit an href for a %s URL', (_case, href) => {
    const { container } = render(<AgentMarkdown content={`[不安全](${href})`} />)
    expect(container.querySelector('a[href]')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('不安全')
  })

  it('renders raw HTML literally without creating executable or tracking elements', () => {
    const content = '<script>window.pwned = true</script>\n<img src="https://tracker.example/pixel" onerror="window.pwned=true">\n<svg onload="window.pwned=true"></svg>'
    const { container } = render(<AgentMarkdown content={content} />)

    expect(container).toHaveTextContent('<script>window.pwned = true</script>')
    expect(container).toHaveTextContent('<img src="https://tracker.example/pixel" onerror="window.pwned=true">')
    expect(container.querySelector('script, img, svg')).not.toBeInTheDocument()
  })

  it('does not load Markdown images and preserves useful alt text', () => {
    const { container } = render(<AgentMarkdown content="![进度图](https://tracker.example/progress.png)" />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('进度图')).toBeVisible()
  })

  it('falls back to the original plain text when a real child renderer throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const content = '**保留原始回复**'
    function ThrowingParagraph(): never {
      throw new Error('renderer failed')
    }

    render(<AgentMarkdown content={content} components={{ p: ThrowingParagraph }} />)

    expect(screen.getByRole('alert', { name: 'Markdown 渲染失败' })).toHaveTextContent(content)
    expect(screen.queryByText('保留原始回复')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
})

describe('AgentMarkdown styles', () => {
  it('keeps prose, long words, code and tables inside the message column', () => {
    expect(styles).toMatch(/\.agent-markdown\s*\{[\s\S]*?max-width:\s*100%/)
    expect(styles).toMatch(/\.agent-markdown\s*\{[\s\S]*?overflow-wrap:\s*anywhere/)
    expect(styles).toMatch(/\.agent-markdown pre\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow-x:\s*auto/)
    expect(styles).toMatch(/\.agent-markdown__table-scroll\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?overflow-x:\s*auto/)
  })

  it('uses semantic theme tokens and visible focus styles', () => {
    const markdownRules = styles.match(/\.agent-markdown[\s\S]*?(?=@media \(max-width: 1000px\))/)?.[0] ?? ''
    expect(markdownRules).toContain('var(--text)')
    expect(markdownRules).toContain('var(--text-muted)')
    expect(markdownRules).toContain('var(--border)')
    expect(markdownRules).toContain('var(--surface-subtle)')
    expect(markdownRules).toMatch(/:focus-visible[\s\S]*?var\(--primary\)/)
  })
})
