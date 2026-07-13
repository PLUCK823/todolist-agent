interface OverlayEntry {
  id: symbol
  element: () => HTMLElement | null
  restoreFocusTo: HTMLElement | null
}

const overlays: OverlayEntry[] = []
let previousBodyOverflow: string | null = null

export function registerOverlay(entry: OverlayEntry) {
  if (overlays.length === 0 && typeof document !== 'undefined') {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  overlays.push(entry)

  return () => unregisterOverlay(entry.id)
}

export function isTopOverlay(id: symbol) {
  return overlays.at(-1)?.id === id
}

function unregisterOverlay(id: symbol) {
  const index = overlays.findIndex((entry) => entry.id === id)
  if (index === -1) return

  const wasTop = index === overlays.length - 1
  const [removed] = overlays.splice(index, 1)
  const nextTop = overlays.at(-1)

  if (overlays.length === 0) {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = previousBodyOverflow ?? ''
    }
    previousBodyOverflow = null
    if (wasTop && removed.restoreFocusTo?.isConnected) {
      removed.restoreFocusTo.focus()
    }
    return
  }

  if (!wasTop || !nextTop) return

  const nextTopElement = nextTop.element()
  if (
    removed.restoreFocusTo?.isConnected &&
    nextTopElement?.contains(removed.restoreFocusTo)
  ) {
    removed.restoreFocusTo.focus()
  } else {
    nextTopElement?.focus()
  }
}
