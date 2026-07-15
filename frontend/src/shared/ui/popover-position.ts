interface PositionInput {
  anchor: Pick<DOMRect, 'left' | 'top' | 'bottom'>
  popover: { width: number; height: number }
  viewport: { width: number; height: number }
  gap?: number
  padding?: number
}

export function getPopoverPosition({
  anchor,
  popover,
  viewport,
  gap = 8,
  padding = 12,
}: PositionInput) {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

  const below = anchor.bottom + gap
  const above = anchor.top - gap - popover.height
  const fitsBelow = below + popover.height <= viewport.height - padding
  const fitsAbove = above >= padding
  const spaceBelow = viewport.height - anchor.bottom
  const spaceAbove = anchor.top
  const shouldFlip = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow)
  const top = clamp(
    shouldFlip ? above : below,
    padding,
    viewport.height - popover.height - padding,
  )
  const left = clamp(
    anchor.left,
    padding,
    viewport.width - popover.width - padding,
  )

  return { left, top }
}
