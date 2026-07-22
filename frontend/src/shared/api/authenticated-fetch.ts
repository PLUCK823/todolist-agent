export const API_AUTH_EXPIRED_EVENT = 'todolist:auth-expired'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  readonly status: number
  readonly code: number | null

  constructor(
    message: string,
    status: number,
    code: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const NO_REFRESH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
])

let refreshPromise: Promise<void> | null = null
let sessionEpoch = 0

function requestPath(input: RequestInfo | URL): string {
  if (input instanceof Request) return new URL(input.url, window.location.origin).pathname
  return new URL(String(input), window.location.origin).pathname
}

function withCredentials(init?: RequestInit): RequestInit {
  return { ...init, credentials: 'include' }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw new ApiError('服务返回了无法识别的响应', response.status, null, { cause })
  }

  if (!body || typeof body !== 'object') {
    throw new ApiError('服务返回了无法识别的响应', response.status)
  }
  const envelope = body as Partial<ApiEnvelope<T>>
  const code = typeof envelope.code === 'number' ? envelope.code : null
  if (code === null || !('data' in envelope)) {
    throw new ApiError('服务返回了无法识别的响应', response.status, code)
  }
  const message = typeof envelope.message === 'string' && envelope.message
    ? envelope.message
    : response.ok ? '服务返回了无法识别的响应' : `请求失败（${response.status}）`

  if (!response.ok || code !== 0) {
    throw new ApiError(message, response.status, code)
  }
  return envelope.data as T
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, withCredentials(init))
  } catch (cause) {
    throw new ApiError('网络连接失败', 0, null, { cause })
  }
  return parseEnvelope<T>(response)
}

function emitAuthExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(API_AUTH_EXPIRED_EVENT))
}

function refreshSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = apiFetch('/api/auth/refresh', { method: 'POST' })
      .then(() => {
        sessionEpoch += 1
      })
      .catch((error) => {
        sessionEpoch += 1
        emitAuthExpired()
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export async function authenticatedFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const epochAtStart = sessionEpoch
  const replayable = input instanceof Request
    ? new Request(input.clone(), withCredentials(init))
    : null
  const attempt = () => replayable
    ? apiFetch<T>(replayable.clone())
    : apiFetch<T>(input, init)

  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || NO_REFRESH_PATHS.has(requestPath(input))) {
      throw error
    }
  }

  if (sessionEpoch === epochAtStart) await refreshSession()
  return attempt()
}
