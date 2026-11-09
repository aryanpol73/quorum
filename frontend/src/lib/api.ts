import type { QuorumEvent } from '../types'

export class ApiError extends Error {}

export async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Cannot reach the QUORUM backend. Is it running on port 8000?')
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail)
  }
  return res.json() as Promise<T>
}

export const postJSON = <T>(path: string) => getJSON<T>(path, { method: 'POST' })

/**
 * Minimal Server-Sent Events client built on fetch (instead of EventSource) so the
 * run can be aborted and the browser never auto-reconnects and re-runs the agents.
 */
export async function streamSSE(url: string, onEvent: (ev: QuorumEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { signal, headers: { Accept: 'text/event-stream' } })
  } catch (err) {
    if (signal.aborted) return
    throw new ApiError('Cannot reach the QUORUM backend. Is it running on port 8000?')
  }
  if (!res.ok || !res.body) throw new ApiError(`Stream failed: ${res.status} ${res.statusText}`)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value.replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue // keep-alive comment
        try {
          onEvent(JSON.parse(data) as QuorumEvent)
        } catch {
          /* ignore a malformed frame rather than killing the run */
        }
      }
    }
  } catch (err) {
    if (signal.aborted) return
    throw err
  }
}
