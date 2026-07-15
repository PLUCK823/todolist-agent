interface OverlayEntry {
  id: symbol
  root: HTMLElement
  focusElement: HTMLElement
  restoreFocusTo: HTMLElement | null
}

const overlays: OverlayEntry[] = []
let previousBodyOverflow: string | null = null
let backgroundInertState: Map<HTMLElement, boolean> | null = null

function shouldKeepInteractive(element: HTMLElement) {
  return element.hasAttribute('aria-live') || element.hasAttribute('data-overlay-allow-interaction')
}

function inertBackground(root: HTMLElement) {
  backgroundInertState = new Map()
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child === root || shouldKeepInteractive(child)) continue
    backgroundInertState.set(child, child.hasAttribute('inert'))
    child.setAttribute('inert', '')
  }
}

function restoreBackground() {
  for (const [element, wasInert] of backgroundInertState ?? []) {
    if (!element.isConnected || wasInert) continue
    element.removeAttribute('inert')
  }
  backgroundInertState = null
}

export function registerOverlay(entry: OverlayEntry) {
  if (overlays.length === 0 && typeof document !== 'undefined') {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inertBackground(entry.root)
  }
  overlays.push(entry)
  syncOverlayInteractivity()

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
  removed.root.removeAttribute('inert')

  for (const entry of overlays.slice(index)) {
    if (
      entry.restoreFocusTo &&
      (removed.root.contains(entry.restoreFocusTo) || !entry.restoreFocusTo.isConnected)
    ) {
      entry.restoreFocusTo = removed.restoreFocusTo
    }
  }

  syncOverlayInteractivity()
  const nextTop = overlays.at(-1)

  if (overlays.length === 0) {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = previousBodyOverflow ?? ''
    }
    previousBodyOverflow = null
    restoreBackground()
    if (wasTop && removed.restoreFocusTo?.isConnected) {
      removed.restoreFocusTo.focus()
    }
    return
  }

  if (!wasTop || !nextTop) return

  if (
    removed.restoreFocusTo?.isConnected &&
    nextTop.root.contains(removed.restoreFocusTo)
  ) {
    removed.restoreFocusTo.focus()
  } else {
    nextTop.focusElement.focus()
  }
}

function syncOverlayInteractivity() {
  const topIndex = overlays.length - 1
  overlays.forEach((entry, index) => {
    entry.root.toggleAttribute('inert', index !== topIndex)
  })
}
