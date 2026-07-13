import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import RequireSession from '../features/auth/RequireSession'

const AppShell = lazy(() => import('../features/shell/AppShell'))
const MyTasksPage = lazy(() => import('../pages/MyTasksPage'))
const UpcomingPage = lazy(() => import('../pages/UpcomingPage'))
const AssistantPage = lazy(() => import('../pages/AssistantPage'))
const ProfilePage = lazy(() => import('../pages/ProfilePage'))
const AuthPage = lazy(() => import('../pages/AuthPage'))

function PageLoader() {
  return (
    <div className="app-page-loader" role="status">
      加载中...
    </div>
  )
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={withSuspense(<AuthPage />)} />
        <Route path="/register" element={withSuspense(<AuthPage />)} />
        <Route element={<RequireSession />}>
          <Route element={withSuspense(<AppShell />)}>
            <Route path="/" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={withSuspense(<MyTasksPage />)} />
            <Route path="/upcoming" element={withSuspense(<UpcomingPage />)} />
            <Route path="/assistant" element={withSuspense(<AssistantPage />)} />
            <Route path="/profile" element={withSuspense(<ProfilePage />)} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
