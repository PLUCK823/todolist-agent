import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import globalStyles from '../../styles/global.css?raw'

describe('assistant workspace layout contract', () => {
  it('computes a three-row, height-contained conversation with only the middle row scrolling', () => {
    const style = document.createElement('style')
    style.textContent = globalStyles
    document.head.append(style)
    const view = render(
      <main className="assistant-workspace">
        <section className="assistant-conversation">
          <header className="assistant-conversation__header" />
          <div className="assistant-conversation__scroll" />
          <form className="assistant-composer" />
        </section>
      </main>,
    )

    const workspace = view.container.firstElementChild as HTMLElement
    const conversation = workspace.firstElementChild as HTMLElement
    const scroll = conversation.children[1] as HTMLElement
    const composer = conversation.lastElementChild as HTMLElement
    expect(getComputedStyle(workspace).height).toBe('100%')
    expect(getComputedStyle(workspace).minHeight).toMatch(/^0(?:px)?$/)
    expect(getComputedStyle(conversation).gridTemplateRows).toBe('auto minmax(0, 1fr) auto')
    expect(getComputedStyle(conversation).minHeight).toMatch(/^0(?:px)?$/)
    expect(getComputedStyle(scroll).overflowY).toMatch(/auto|scroll/)
    expect(getComputedStyle(conversation).overflowY).not.toMatch(/auto|scroll/)
    expect(getComputedStyle(composer).alignSelf).toBe('end')
    expect(getComputedStyle(composer).flexShrink).toBe('0')

    style.remove()
  })

  it('caps the compact textarea at 360px without viewport/min-height layout traps', () => {
    expect(globalStyles).toMatch(/\.assistant-composer__input\s*\{[\s\S]*?min-height:\s*56px[\s\S]*?max-height:\s*360px/)
    expect(globalStyles).toMatch(/\.assistant-conversation\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/)
    expect(globalStyles).not.toMatch(/\.assistant-(?:workspace|conversation|empty)[^{]*\{[^}]*min-height:\s*(?:100%|100vh|100dvh)/)
    expect(globalStyles).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.assistant-conversation[\s\S]*?min-width:\s*0/)
    expect(globalStyles).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.assistant-sessions\s*\{[\s\S]*?visibility:\s*hidden/)
    expect(globalStyles).toMatch(/\.assistant-sessions\[data-open="true"\][^{]*\{[^}]*visibility:\s*visible/)
  })
})
