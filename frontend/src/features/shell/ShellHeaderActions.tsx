import { useContext, useLayoutEffect, useRef } from 'react'
import { ShellContext } from './shell-context'

export function ShellHeaderActionsSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const shell = useContext(ShellContext)
  const setHeaderActionsElement = shell?.setHeaderActionsElement
  useLayoutEffect(() => {
    setHeaderActionsElement?.(ref.current)
    return () => setHeaderActionsElement?.(null)
  }, [setHeaderActionsElement])
  return <div ref={ref} className="shell-header-actions-slot" />
}
