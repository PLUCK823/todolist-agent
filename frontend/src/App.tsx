import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'

const AppShell = lazy(() => import('./components/layout/AppShell'))
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'))
const UpcomingPage = lazy(() => import('./pages/UpcomingPage'))
const AssistantPage = lazy(() => import('./pages/AssistantPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64" style={{ color: '#6b7280' }}>
      <div className="text-sm">加载中...</div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={
        <Suspense fallback={<PageLoader />}>
          <AuthPage />
        </Suspense>
      } />
      <Route path="/register" element={
        <Suspense fallback={<PageLoader />}>
          <AuthPage />
        </Suspense>
      } />
      <Route element={
        <Suspense fallback={<PageLoader />}>
          <AppShell />
        </Suspense>
      }>
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="/tasks" element={
          <Suspense fallback={<PageLoader />}>
            <MyTasksPage />
          </Suspense>
        } />
        <Route path="/upcoming" element={
          <Suspense fallback={<PageLoader />}>
            <UpcomingPage />
          </Suspense>
        } />
        <Route path="/assistant" element={
          <Suspense fallback={<PageLoader />}>
            <AssistantPage />
          </Suspense>
        } />
        <Route path="/profile" element={
          <Suspense fallback={<PageLoader />}>
            <ProfilePage />
          </Suspense>
        } />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
