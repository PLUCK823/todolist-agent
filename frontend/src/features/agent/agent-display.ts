const MAX_DISPLAY_DEPTH = 8
const MAX_DISPLAY_NODES = 400
const MAX_DISPLAY_STRING = 4_096

export function formatAgentMessageTime(value: string): string | null {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function safeSerializeAgentResult(value: unknown): string {
  const seen = new WeakSet<object>()
  let nodes = 0

  function normalize(current: unknown, depth: number): unknown {
    nodes++
    if (nodes > MAX_DISPLAY_NODES || depth > MAX_DISPLAY_DEPTH) return '[内容已截断]'
    if (current === undefined) return '[未定义]'
    if (typeof current === 'string') return current.length > MAX_DISPLAY_STRING ? `${current.slice(0, MAX_DISPLAY_STRING)}…` : current
    if (typeof current === 'bigint' || typeof current === 'symbol' || typeof current === 'function') return String(current)
    if (current === null || typeof current !== 'object') return current
    if (seen.has(current)) return '[循环引用]'
    seen.add(current)
    if (Array.isArray(current)) return current.slice(0, 100).map((item) => normalize(item, depth + 1))
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(current).slice(0, 100)) {
      try { result[key] = normalize((current as Record<string, unknown>)[key], depth + 1) } catch { result[key] = '[无法读取]' }
    }
    return result
  }

  try { return JSON.stringify(normalize(value, 0), null, 2) ?? 'null' } catch { return '「结果无法安全显示」' }
}
