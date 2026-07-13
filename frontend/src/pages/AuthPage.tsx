import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'

export default function AuthPage() {
  const location = useLocation()
  const isRegister = location.pathname === '/register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('请填写所有必填字段')
      return
    }
    if (isRegister && !name.trim()) {
      setError('请填写昵称')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要6位')
      return
    }

    // Placeholder: auth not yet implemented
    setError('用户认证功能即将上线')
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f7f7f9' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-4"
            style={{ backgroundColor: '#7165ea' }}
          >
            AT
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#1a1a2e' }}>
            Agent TodoList
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            {isRegister ? '创建新账号' : '登录你的账号'}
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border p-8" style={{ borderColor: '#e5e7eb' }}>
          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm text-center"
              style={{ backgroundColor: '#fef2f2', color: '#ef4444' }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#6b7280' }}>
                  昵称
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="你的昵称"
                  className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: '#e5e7eb', color: '#1a1a2e' }}
                  onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
                  onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#6b7280' }}>
                邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: '#e5e7eb', color: '#1a1a2e' }}
                onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#6b7280' }}>
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少6位"
                className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: '#e5e7eb', color: '#1a1a2e' }}
                onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
                onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl text-white font-medium text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#7165ea' }}
            >
              {isRegister ? '注册' : '登录'}
            </button>
          </form>

          <p className="text-xs text-center mt-6" style={{ color: '#6b7280' }}>
            {isRegister ? (
              <>
                已有账号？{' '}
                <a href="/login" className="font-medium" style={{ color: '#7165ea' }}>
                  去登录
                </a>
              </>
            ) : (
              <>
                没有账号？{' '}
                <a href="/register" className="font-medium" style={{ color: '#7165ea' }}>
                  注册
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
