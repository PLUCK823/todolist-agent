import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import type { AvatarPreset, AvatarValue } from '../auth/auth.types'

const presets: { value: AvatarPreset; label: string; initials: string }[] = [
  { value: 'amber', label: '暖橙', initials: 'HZ' },
  { value: 'ocean', label: '海蓝', initials: 'PL' },
  { value: 'forest', label: '松绿', initials: '✓' },
  { value: 'violet', label: '星紫', initials: '✦' },
]

export function Avatar({ avatar, name, className = '' }: { avatar: AvatarValue; name: string; className?: string }) {
  if (avatar.kind === 'image') return <img className={`account-avatar ${className}`} src={avatar.value} alt={`${name}的头像`} />
  const preset = presets.find((item) => item.value === avatar.value) ?? presets[0]
  return <span className={`account-avatar account-avatar--${preset.value} ${className}`} aria-label={`${name}的头像`}>{preset.initials}</span>
}

interface AvatarDialogProps { open: boolean; avatar: AvatarValue | AvatarPreset; onOpenChange(open: boolean): void; onSave(avatar: AvatarValue): void }

export default function AvatarDialog({ open, ...props }: AvatarDialogProps) {
  return open ? <AvatarDialogSession {...props} /> : null
}

function AvatarDialogSession({ avatar, onOpenChange, onSave }: Omit<AvatarDialogProps, 'open'>) {
  const initialPreset = typeof avatar === 'string' ? avatar : avatar.kind === 'preset' ? avatar.value : 'amber'
  const [selected, setSelected] = useState<AvatarValue>({ kind: 'preset', value: initialPreset })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<File | null>(null)

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('仅支持 PNG 或 JPEG 图片'); return }
    if (file.size > 5 * 1024 * 1024) { setError('图片不能超过 5MB'); return }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const url = URL.createObjectURL(file)
    fileRef.current = file
    setPreviewUrl(url)
    setSelected({ kind: 'image', value: url })
  }

  const save = () => {
    const file = fileRef.current
    if (!file) { onSave(selected); onOpenChange(false); return }
    const reader = new FileReader()
    reader.onload = () => { onSave({ kind: 'image', value: String(reader.result) }); onOpenChange(false) }
    reader.readAsDataURL(file)
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="更换头像" description="选择一个预设头像，或上传你自己的图片。" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={save}>保存头像</Button></>}>
      <div className="avatar-picker" role="radiogroup" aria-label="预设头像">
        {presets.map((preset) => <button key={preset.value} type="button" role="radio" aria-checked={selected.kind === 'preset' && selected.value === preset.value} aria-label={preset.label} onClick={() => { setSelected({ kind: 'preset', value: preset.value }); fileRef.current = null }}><Avatar avatar={{ kind: 'preset', value: preset.value }} name={preset.label} /><span>{preset.label}</span></button>)}
      </div>
      <label className="avatar-upload">上传头像<input aria-label="上传头像" type="file" accept="image/png,image/jpeg" onChange={chooseFile} /></label>
      {previewUrl ? <img className="avatar-upload__preview" src={previewUrl} alt="头像预览" /> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <p className="avatar-upload__hint">PNG 或 JPEG，最大 5MB</p>
    </Dialog>
  )
}
