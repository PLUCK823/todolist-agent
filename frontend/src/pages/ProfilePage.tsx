import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/common/ConfirmDialog'
import { Button } from '../shared/ui/Button'
import { TextField } from '../shared/ui/TextField'
import { useToast } from '../shared/ui/toast-context'
import { useAuth } from '../features/auth/auth-context'
import AvatarDialog, { Avatar } from '../features/profile/AvatarDialog'
import type { AvatarValue } from '../features/auth/auth.types'

export default function ProfilePage() {
  const { account, updateProfile, logout } = useAuth()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [name, setName] = useState(account?.name ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [timezone, setTimezone] = useState(account?.timezone ?? '')
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  if (!account) return <div className="app-page-loader" role="status">正在加载个人资料…</div>

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    const nextErrors: typeof errors = {}
    if (!name.trim()) nextErrors.name = '请输入显示名称'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = '请输入有效的邮箱地址'
    setErrors(nextErrors)
    if (nextErrors.name) { nameRef.current?.focus(); return }
    if (nextErrors.email) { emailRef.current?.focus(); return }
    setPending(true)
    try { await updateProfile({ name, email, timezone }); addToast('success', '个人资料已保存') }
    catch { addToast('error', '保存失败，请稍后重试') }
    finally { setPending(false) }
  }

  const saveAvatar = async (avatar: AvatarValue) => {
    await updateProfile({ avatar })
    addToast('success', '头像已更新')
  }

  const confirmLogout = async () => {
    setPending(true)
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <section className="profile-page">
      <header className="profile-page__header"><div><p>账户中心</p><h1>个人资料</h1><span>管理登录账户与工作偏好</span></div><Button type="submit" form="profile-form" disabled={pending}>{pending ? '保存中…' : '保存修改'}</Button></header>
      <div className="profile-identity panel-surface"><Avatar avatar={account.avatar} name={account.name} className="profile-identity__avatar" /><div><h2>{account.name}</h2><p>{account.email} · 已登录</p></div><Button variant="secondary" onClick={() => setAvatarOpen(true)}>更换头像</Button></div>
      <div className="profile-grid">
        <form id="profile-form" className="panel-surface profile-form" onSubmit={save} noValidate><h2>账户信息</h2><TextField inputRef={nameRef} name="name" label="显示名称" value={name} error={errors.name} onChange={(event) => setName(event.target.value)} /><TextField inputRef={emailRef} name="email" label="邮箱地址" type="email" spellCheck={false} value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} /><TextField name="timezone" label="时区" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></form>
        <section className="panel-surface profile-status"><h2>账户状态</h2><dl><div><dt>登录方式</dt><dd>邮箱登录</dd></div><div><dt>任务总数</dt><dd>{account.taskCount}</dd></div><div><dt>Agent 对话</dt><dd>{account.agentSessionCount} 次</dd></div><div><dt>账户安全</dt><dd className="status-ok">正常</dd></div></dl><Button variant="secondary" onClick={() => setLogoutOpen(true)} className="w-full">退出登录</Button></section>
      </div>
      <div className="profile-stats" aria-label="使用统计"><div><strong>{account.taskCount}</strong><span>总任务</span></div><div><strong>3</strong><span>已完成</span></div><div><strong>4</strong><span>进行中</span></div><div><strong>{account.agentSessionCount}</strong><span>Agent 对话</span></div></div>
      <AvatarDialog open={avatarOpen} avatar={account.avatar} onOpenChange={setAvatarOpen} onSave={saveAvatar} />
      <ConfirmDialog isOpen={logoutOpen} title="确认退出登录" message="退出后将返回登录页面；当前设备上的头像偏好仍会保留。" confirmLabel="确认退出" onConfirm={confirmLogout} onCancel={() => setLogoutOpen(false)} pending={pending} />
    </section>
  )
}
