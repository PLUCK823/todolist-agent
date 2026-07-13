import { NavLink } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

function TasksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function UpcomingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function AssistantIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2a4 4 0 014 4c0 2.21-1.79 4-4 4s-4-1.79-4-4a4 4 0 014-4z" />
      <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
      <circle cx="17" cy="7" r="3" />
      <path d="M21 12l-2 2-4-4" />
    </svg>
  )
}

function ProfileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { to: '/tasks', label: '任务', icon: TasksIcon },
  { to: '/upcoming', label: '安排', icon: UpcomingIcon },
  { to: '/assistant', label: '助手', icon: AssistantIcon },
  { to: '/profile', label: '我的', icon: ProfileIcon },
]

export default function NavigationRail() {
  return (
    <nav
      className="fixed left-0 top-0 flex h-screen w-[72px] flex-col items-center bg-[var(--color-nav-bg)] py-4 z-20"
      aria-label="主导航"
    >
      {/* Logo */}
      <div
        className="mb-6 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-sm font-bold text-white select-none"
        aria-hidden="true"
      >
        AT
      </div>

      {/* Nav items */}
      <ul className="flex w-full flex-col items-center gap-1" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="w-full">
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                [
                  'relative flex w-full flex-col items-center gap-0.5 py-3 text-center transition-colors duration-150 hover:bg-white/10',
                  isActive
                    ? 'text-[var(--color-primary)]'
                    : 'text-[var(--color-text-secondary)]',
                ].join(' ')
              }
              aria-label={item.label}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-sm bg-[var(--color-primary)]" />
                  )}
                  <item.icon
                    className="h-5 w-5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-[10px] leading-none font-medium">
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Spacer to push items to top */}
      <div className="flex-1" aria-hidden="true" />
    </nav>
  )
}
