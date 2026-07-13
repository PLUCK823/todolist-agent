import { useState } from 'react'

export default function ProfilePage() {
  const [name, setName] = useState('用户')
  const [email, setEmail] = useState('user@example.com')
  const [isEditing, setIsEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setIsEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-8" style={{ color: '#1a1a2e' }}>
        个人资料
      </h1>

      {/* Avatar Section */}
      <div className="flex items-center gap-6 mb-8 p-6 bg-white rounded-xl border" style={{ borderColor: '#e5e7eb' }}>
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold"
          style={{ backgroundColor: '#7165ea' }}
        >
          {name.charAt(0)}
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: '#1a1a2e' }}>
            {name}
          </h2>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            {email}
          </p>
        </div>
      </div>

      {/* Edit Form */}
      <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#e5e7eb' }}>
        <h3 className="text-base font-semibold mb-4" style={{ color: '#1a1a2e' }}>
          编辑信息
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#6b7280' }}>
              昵称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setIsEditing(true) }}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#e5e7eb', color: '#1a1a2e' }}
              onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
              onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#6b7280' }}>
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setIsEditing(true) }}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: '#e5e7eb', color: '#1a1a2e' }}
              onFocus={(e) => (e.target.style.borderColor = '#7165ea')}
              onBlur={(e) => (e.target.style.borderColor = '#e5e7eb')}
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!isEditing}
              className="px-6 py-2 rounded-lg text-white text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#7165ea' }}
            >
              保存
            </button>
            {saved && (
              <span className="text-sm text-green-500">已保存</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-3 gap-4">
        {[
          { label: '总任务', value: '--' },
          { label: '已完成', value: '--' },
          { label: '进行中', value: '--' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border p-4 text-center"
            style={{ borderColor: '#e5e7eb' }}
          >
            <p className="text-2xl font-bold" style={{ color: '#7165ea' }}>
              {stat.value}
            </p>
            <p className="text-xs mt-1" style={{ color: '#6b7280' }}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
