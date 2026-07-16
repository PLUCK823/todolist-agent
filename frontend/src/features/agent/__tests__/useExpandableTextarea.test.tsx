import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useExpandableTextarea } from '../useExpandableTextarea'

function Harness() {
  const [value, setValue] = useState('')
  const sizing = useExpandableTextarea(value)
  return <>
    <textarea
      ref={sizing.ref}
      aria-label="sized"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={sizing.onPointerDown}
      onPointerUp={sizing.onPointerUp}
    />
    <button type="button" onClick={sizing.reset}>reset</button>
  </>
}

describe('useExpandableTextarea', () => {
  it('clamps automatic growth and enables overflow at the automatic limit', () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'sized' })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 280 })

    fireEvent.change(textarea, { target: { value: 'long content' } })

    expect(textarea.style.height).toBe('220px')
    expect(textarea.style.overflowY).toBe('auto')
  })

  it('keeps a manual resize while editing and resets to the two-line default', () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'sized' })
    let measuredHeight = 56
    let contentHeight = 80
    Object.defineProperty(textarea, 'offsetHeight', { configurable: true, get: () => measuredHeight })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => contentHeight })

    fireEvent.pointerDown(textarea)
    measuredHeight = 320
    textarea.style.height = '320px'
    fireEvent.pointerUp(textarea)
    contentHeight = 100
    fireEvent.change(textarea, { target: { value: 'manual size remains' } })

    expect(textarea.style.height).toBe('320px')
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect(textarea.style.height).toBe('56px')
    expect(textarea.style.overflowY).toBe('hidden')
  })
})
