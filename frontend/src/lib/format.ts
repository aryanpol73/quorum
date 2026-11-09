const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })

export const rupee = (v: number | null | undefined, digits: 0 | 2 = 2) =>
  v == null || Number.isNaN(v) ? '—' : `₹${digits === 0 ? inr0.format(v) : inr.format(v)}`

export const num = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(digits)

export const signed = (v: number | null | undefined, digits = 2, suffix = '') =>
  v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`

export const pct = (v: number | null | undefined, digits = 2) => signed(v, digits, '%')

export const compactNum = (v: number | null | undefined) => (v == null ? '—' : compact.format(v))

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-muted' : v > 0 ? 'text-up' : 'text-down')

export const decisionColor = (d?: string | null) =>
  d === 'BUY' ? 'var(--color-up)' : d === 'SELL' ? 'var(--color-down)' : 'var(--color-gold)'

export const leanColor = (lean: string) =>
  lean === 'bullish' ? 'text-up' : lean === 'bearish' ? 'text-down' : 'text-dim'

export const sourceColor: Record<string, string> = {
  T: 'text-info border-info/35 bg-info/10',
  N: 'text-violet border-violet/35 bg-violet/10',
  F: 'text-gold border-gold/35 bg-gold/10',
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
