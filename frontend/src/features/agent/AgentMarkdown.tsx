import { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface AgentMarkdownProps {
  content: string
  components?: Components
}

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

const allowedElements = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'ul',
]

const schemePattern = /^([a-z][a-z\d+.-]*):/i

function hasControlOrWhitespace(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
  })
}

function decodeForClassification(value: string) {
  let decoded = value.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_match, hex: string | undefined, decimal: string | undefined) => {
    const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10)
    return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : _match
  }).replace(/&colon;?/gi, ':')

  for (let count = 0; count < 3; count += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

const safeMarkdownUrl: UrlTransform = (url) => {
  if (!url || hasControlOrWhitespace(url) || url.includes('\\')) return undefined

  const classified = decodeForClassification(url)
  if (hasControlOrWhitespace(classified.split(/[/?#]/, 1)[0] ?? '')) return undefined
  if (classified.startsWith('//')) return undefined

  const scheme = classified.match(schemePattern)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return undefined
  if (!scheme && classified.includes(':')) return undefined

  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== `${scheme}:`) return undefined
    } catch {
      return undefined
    }
  }

  return url
}

function isExternalHttpUrl(href: string) {
  try {
    const resolved = new URL(href, window.location.href)
    return ['http:', 'https:'].includes(resolved.protocol) && resolved.origin !== window.location.origin
  } catch {
    return false
  }
}

function remarkLiteralHtml() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'html') node.type = 'text'
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

const safeComponents: Components = {
  a({ children, href, node: _node, ...props }) {
    const safeHref = href ? safeMarkdownUrl(href, 'href', _node!) : undefined
    if (!safeHref) return <span className="agent-markdown__blocked-link">{children}</span>
    const external = isExternalHttpUrl(safeHref)
    return <a {...props} href={safeHref} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{children}</a>
  },
  img({ alt }) {
    return alt ? <span className="agent-markdown__image-alt">{alt}</span> : null
  },
  table({ children, node, ...props }) {
    void node
    return (
      <div className="agent-markdown__table-scroll" role="region" aria-label="Markdown 表格" tabIndex={0}>
        <table {...props}>{children}</table>
      </div>
    )
  },
}

interface MarkdownErrorBoundaryProps {
  children: ReactNode
  content: string
  resetComponents?: Components
}

interface MarkdownErrorBoundaryState {
  failed: boolean
}

function hasSameComponents(previous?: Components, next?: Components) {
  if (previous === next) return true
  const previousEntries = Object.entries(previous ?? {})
  const nextEntries = Object.entries(next ?? {})
  return previousEntries.length === nextEntries.length
    && previousEntries.every(([name, component]) => (next ?? {})[name as keyof Components] === component)
}

class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, MarkdownErrorBoundaryState> {
  state: MarkdownErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): MarkdownErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void error
    void info
    // The original response remains visible; host-level observability can capture React errors.
  }

  componentDidUpdate(previous: MarkdownErrorBoundaryProps) {
    if (this.state.failed && (
      previous.content !== this.props.content
      || !hasSameComponents(previous.resetComponents, this.props.resetComponents)
    )) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return <pre className="agent-markdown agent-markdown--fallback" role="alert" aria-label="Markdown 渲染失败">{this.props.content}</pre>
    }
    return this.props.children
  }
}

export function AgentMarkdown({ content, components }: AgentMarkdownProps) {
  return (
    <MarkdownErrorBoundary content={content} resetComponents={components}>
      <div className="agent-markdown">
        <ReactMarkdown
          allowedElements={allowedElements}
          components={{ ...components, ...safeComponents }}
          remarkPlugins={[remarkGfm, remarkLiteralHtml]}
          skipHtml
          unwrapDisallowed
          urlTransform={safeMarkdownUrl}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  )
}
