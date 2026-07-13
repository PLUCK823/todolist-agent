import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../shared/ui/Button'
import { TextField } from '../shared/ui/TextField'
import { useAuth } from '../features/auth/auth-context'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FieldErrors { name?: string; email?: string; password?: string }

export default function AuthPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const isRegister = location.pathname === '/register'
  const state = location.state as { registeredEmail?: string; from?: { pathname?: string } } | null
  const [email, setEmail] = useState(state?.registeredEmail ?? '')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    if (isRegister && !name.trim()) nextErrors.name = '请输入显示名称'
    if (!emailPattern.test(email.trim())) nextErrors.email = '请输入有效的邮箱地址'
    if (password.length < 8) nextErrors.password = '密码至少需要 8 位'
    setErrors(nextErrors)
    setFormError('')
    if (Object.keys(nextErrors).length) return

    setPending(true)
    try {
      if (isRegister) {
        const account = await register({ name, email, password })
        navigate('/login', { replace: true, state: { registeredEmail: account.email } })
      } else {
        await login({ email, password })
        navigate(state?.from?.pathname || '/tasks', { replace: true })
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '暂时无法完成操作，请稍后再试')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-labelledby="auth-story-title">
        <div className="auth-brand"><span aria-hidden="true">✓</span><strong>Agent TodoList</strong></div>
        <div className="auth-story__copy">
          <p>专注，从一句话开始</p>
          <h1 id="auth-story-title">把零散想法，交给你的智能任务搭档。</h1>
          <p>创建、整理与推进任务都在同一处完成，让每一天保持清晰。</p>
        </div>
        <div className="auth-story__preview" aria-hidden="true"><span>✦ 智能助手</span><strong>已为你整理明日计划</strong><small>3 个步骤 · 即刻可执行</small></div>
      </section>
      <section className="auth-form-section">
        <div className="auth-form-card">
          <p className="auth-form-card__eyebrow">{isRegister ? '开始使用' : '欢迎回来'}</p>
          <h2>Agent TodoList</h2>
          <p>{isRegister ? '创建新账号' : '登录你的账号'}</p>
          {state?.registeredEmail && !isRegister ? <p className="form-success" role="status">账号已创建，请登录</p> : null}
          {formError ? <p className="form-error" role="alert">{formError}</p> : null}
          <form onSubmit={handleSubmit} noValidate>
            {isRegister ? <TextField label="显示名称" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} placeholder="例如：Plucky HZ" /> : null}
            <TextField label="邮箱地址" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} placeholder="you@example.com" />
            <TextField label="密码" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} placeholder="至少 8 位" />
            <Button type="submit" size="lg" disabled={pending} className="w-full" aria-label={isRegister ? '创建账号' : '登录'}>{pending ? '请稍候...' : isRegister ? '注册' : '登录'}</Button>
          </form>
          <p className="auth-form-card__switch">{isRegister ? <>已有账号？ <Link to="/login">去登录</Link></> : <>没有账号？ <Link to="/register">注册</Link></>}</p>
          <small>继续即表示你同意以本地演示数据体验此原型。</small>
        </div>
      </section>
    </main>
  )
}
