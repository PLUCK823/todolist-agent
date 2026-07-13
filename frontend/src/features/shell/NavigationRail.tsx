import { NavLink } from 'react-router-dom'
import type { ReactNode, SVGProps } from 'react'
import { useShell } from './shell-context'
import { requestSettingsOpen } from './shell-events'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

function TasksIcon(props: IconProps) {
  return <Icon {...props}><path d="M8 6h12M8 12h12M8 18h12" /><path d="m3.5 6 .8.8L6 5M3.5 12l.8.8L6 11M3.5 18l.8.8L6 17" /></Icon>
}

function CalendarIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></Icon>
}

function SparkIcon(props: IconProps) {
  return <Icon {...props}><path d="m12 2 1.55 4.45L18 8l-4.45 1.55L12 14l-1.55-4.45L6 8l4.45-1.55L12 2Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></Icon>
}

function SettingsIcon(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z" /></Icon>
}

function PanelIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16M14 9l3 3-3 3" /></Icon>
}

const primaryItems = [
  { to: '/tasks', label: '我的任务', icon: TasksIcon },
  { to: '/upcoming', label: '近期安排', icon: CalendarIcon },
  { to: '/assistant', label: '智能助手', icon: SparkIcon },
]

function navClassName(isActive: boolean) {
  return `nav-rail__control${isActive ? ' nav-rail__control--active' : ''}`
}

export default function NavigationRail() {
  const { navExpanded, toggleNav } = useShell()
  const labelState = navExpanded ? 'expanded' : 'collapsed'

  return (
    <nav
      className="nav-rail"
      data-expanded={navExpanded}
      aria-label="主导航"
    >
      <div className="nav-rail__brand" aria-label="Agent TodoList">
        <span aria-hidden="true">✓</span>
        <strong
          className="nav-rail__label"
          data-state={labelState}
          aria-hidden={!navExpanded}
        >
          Agent TodoList
        </strong>
      </div>

      <ul className="nav-rail__list" role="list">
        {primaryItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) => navClassName(isActive)}
              aria-label={item.label}
            >
              <item.icon />
              <span
                className="nav-rail__label"
                data-state={labelState}
                aria-hidden={!navExpanded}
              >
                {item.label}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="nav-rail__spacer" aria-hidden="true" />

      <button
        type="button"
        className="nav-rail__control"
        onClick={requestSettingsOpen}
        aria-label="设置"
      >
        <SettingsIcon />
        <span
          className="nav-rail__label"
          data-state={labelState}
          aria-hidden={!navExpanded}
        >
          设置
        </span>
      </button>

      <NavLink
        to="/profile"
        className={({ isActive }) => `${navClassName(isActive)} nav-rail__profile`}
        aria-label="用户资料"
      >
        <span className="nav-rail__avatar" aria-hidden="true">HZ</span>
        <span
          className="nav-rail__user"
          data-state={labelState}
          aria-hidden={!navExpanded}
        >
          <strong data-state={labelState} aria-hidden={!navExpanded}>Plucky HZ</strong>
          <small aria-hidden={!navExpanded}>plucky@example.com</small>
        </span>
      </NavLink>

      <button
        type="button"
        className="nav-rail__control"
        onClick={toggleNav}
        aria-label={navExpanded ? '收起导航' : '展开导航'}
        aria-expanded={navExpanded}
      >
        <PanelIcon className={navExpanded ? 'nav-rail__toggle-icon--expanded' : ''} />
        <span
          className="nav-rail__label"
          data-state={labelState}
          aria-hidden={!navExpanded}
        >
          收起导航
        </span>
      </button>
    </nav>
  )
}
