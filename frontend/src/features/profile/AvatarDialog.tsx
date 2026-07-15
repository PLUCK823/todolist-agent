import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import type { AvatarPreset, AvatarValue } from '../auth/auth.types'
import { deleteAvatarBlob, getAvatarBlob, persistAvatarFile } from './avatar.storage'

const presets: { value: AvatarPreset; label: string; initials: string }[] = [
  { value: 'amber', label: '暖橙', initials: 'HZ' },
  { value: 'ocean', label: '海蓝', initials: 'PL' },
  { value: 'forest', label: '松绿', initials: '✓' },
  { value: 'violet', label: '星紫', initials: '✦' },
]

export function Avatar({ avatar, name, className = '' }: { avatar: AvatarValue; name: string; className?: string }) {
  if (avatar.kind === 'image') return <img className={`account-avatar ${className}`} src={avatar.value} alt={`${name}的头像`} />
  if (avatar.kind === 'blob') return <StoredAvatar storageKey={avatar.value} name={name} className={className} />
  const preset = presets.find((item) => item.value === avatar.value) ?? presets[0]
  return <span className={`account-avatar account-avatar--${preset.value} ${className}`} aria-label={`${name}的头像`}>{preset.initials}</span>
}

function StoredAvatar({ storageKey, name, className }: { storageKey: string; name: string; className: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    getAvatarBlob(storageKey).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => undefined)
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [storageKey])
  return url ? <img className={`account-avatar ${className}`} src={url} alt={`${name}的头像`} /> : <span className={`account-avatar account-avatar--amber ${className}`} aria-label={`${name}的头像`}>…</span>
}

interface AvatarDialogProps { open: boolean; avatar: AvatarValue | AvatarPreset; onOpenChange(open: boolean): void; onSave(avatar: AvatarValue): void | Promise<void> }

export default function AvatarDialog({ open, ...props }: AvatarDialogProps) {
  return open ? <AvatarDialogSession {...props} /> : null
}

function AvatarDialogSession({ avatar, onOpenChange, onSave }: Omit<AvatarDialogProps, 'open'>) {
  const initialPreset = typeof avatar === 'string' ? avatar : avatar.kind === 'preset' ? avatar.value : 'amber'
  const [selected, setSelected] = useState<AvatarValue>({ kind: 'preset', value: initialPreset })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
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

  const choosePreset = (preset: AvatarPreset) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null); fileRef.current = null
    setSelected({ kind: 'preset', value: preset }); setError('')
  }

  const save = async () => {
    setPending(true); setError('')
    let newlyStored: AvatarValue | null = null
    try {
      const value = fileRef.current ? await persistAvatarFile(fileRef.current) : selected
      if (fileRef.current) newlyStored = value
      await onSave(value)
      const previous = typeof avatar === 'string' ? null : avatar
      if (previous?.kind === 'blob' && (value.kind !== 'blob' || value.value !== previous.value)) {
        await deleteAvatarBlob(previous.value).catch(() => undefined)
      }
      onOpenChange(false)
    } catch {
      if (newlyStored?.kind === 'blob') await deleteAvatarBlob(newlyStored.value).catch(() => undefined)
      setError('头像保存失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange} title="更换头像" description="选择一个预设头像，或上传你自己的图片。" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button><Button onClick={save} disabled={pending}>{pending ? '保存中…' : '保存头像'}</Button></>}>
      <div className="avatar-picker" role="radiogroup" aria-label="预设头像">
        {presets.map((preset) => <label key={preset.value}><input type="radio" name="avatar-preset" value={preset.value} checked={selected.kind === 'preset' && selected.value === preset.value} onChange={() => choosePreset(preset.value)} aria-label={preset.label} /><Avatar avatar={{ kind: 'preset', value: preset.value }} name={preset.label} /><span>{preset.label}</span></label>)}
      </div>
      <label className="avatar-upload">上传头像<input aria-label="上传头像" type="file" accept="image/png,image/jpeg" onChange={chooseFile} /></label>
      {previewUrl ? <img className="avatar-upload__preview" src={previewUrl} alt="头像预览" /> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <p className="avatar-upload__hint">PNG 或 JPEG，最大 5MB</p>
    </Dialog>
  )
}
