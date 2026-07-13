import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'

export default function RequireSession() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <div className="app-page-loader" role="status">正在检查登录状态...</div>
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}
