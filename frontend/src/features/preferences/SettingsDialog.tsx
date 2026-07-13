import { useEffect, useState } from 'react'
import { useOptionalToast } from '../../shared/ui/toast-context'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { SETTINGS_OPEN_EVENT } from '../shell/shell-events'
import { useOptionalPreferences } from './preferences-context'
import { defaultPreferences, type Preferences } from './preferences.types'

export default function SettingsDialog() {
  const preferenceContext = useOptionalPreferences()
  const toastContext = useOptionalToast()
  const preferences = preferenceContext?.preferences
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Preferences>(preferences ?? defaultPreferences)

  useEffect(() => {
    if (!preferences) return
    const handleOpen = () => { setDraft(preferences); setOpen(true) }
    window.addEventListener(SETTINGS_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, handleOpen)
  }, [preferences])

  if (!preferenceContext || !toastContext) return null
  const { updatePreferences } = preferenceContext
  const { addToast } = toastContext

  const save = () => {
    updatePreferences(draft)
    setOpen(false)
    addToast('success', '设置已保存')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} title="设置" description="调整界面外观与智能助手的默认行为。" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>取消</Button><Button onClick={save}>保存设置</Button></>}>
      <div className="settings-form">
        <label>语言<select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as Preferences['language'] })}><option value="zh-CN">简体中文</option></select></label>
        <label>主题<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Preferences['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label className="settings-switch"><span><strong>启动时展开智能助手</strong><small>进入工作区后自动显示右侧助手</small></span><input type="checkbox" checked={draft.agentStartsOpen} onChange={(event) => setDraft({ ...draft, agentStartsOpen: event.target.checked })} /></label>
        <label>动态效果<select value={draft.reducedMotion === null ? 'system' : draft.reducedMotion ? 'reduce' : 'full'} onChange={(event) => setDraft({ ...draft, reducedMotion: event.target.value === 'system' ? null : event.target.value === 'reduce' })}><option value="system">跟随系统</option><option value="full">完整动效</option><option value="reduce">减少动效</option></select></label>
      </div>
    </Dialog>
  )
}
