import { createContext, useContext, useState, type ReactNode } from 'react'
import { sourceColor } from '../lib/format'
import type { Evidence } from '../types'

interface Ctx {
  byId: Map<string, Evidence>
  hovered: string | null
  setHovered: (id: string | null) => void
}

const EvidenceCtx = createContext<Ctx>({ byId: new Map(), hovered: null, setHovered: () => {} })
export const useEvidence = () => useContext(EvidenceCtx)

export function EvidenceProvider({ ledger, children }: { ledger: Evidence[]; children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const byId = new Map(ledger.map((e) => [e.id, e]))
  return <EvidenceCtx.Provider value={{ byId, hovered, setHovered }}>{children}</EvidenceCtx.Provider>
}

export function CitationChip({ id, invalid = false }: { id: string; invalid?: boolean }) {
  const { byId, hovered, setHovered } = useEvidence()
  const ev = byId.get(id)
  const bad = invalid || (byId.size > 0 && !ev)
  const cls = bad ? 'text-down border-down/60 bg-down/10 line-through' : sourceColor[id[0]] ?? 'text-muted border-line'
  return (
    <span className="group relative inline-block align-baseline">
      <span
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(null)}
        className={`mx-0.5 cursor-help rounded-md border px-1.5 py-px font-mono text-[10px] leading-4 transition-all duration-200 ${cls} ${hovered === id ? 'ring-1 ring-current shadow-[0_0_12px_-2px_currentColor]' : ''}`}
      >
        {id}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-72 -translate-x-1/2 translate-y-1 rounded-xl border border-gold/25 bg-ink-850/95 p-3 text-left text-[12px] leading-snug text-fg opacity-0 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95)] backdrop-blur-xl transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
      >
        {bad ? (
          <span className="text-down">Evidence {id} does not exist in the ledger (possible hallucination).</span>
        ) : ev ? (
          <>
            <span className="eyebrow mb-1 block">
              {ev.id} · {ev.source} · leans {ev.lean}
            </span>
            {ev.detail}
          </>
        ) : (
          'Evidence ledger loading…'
        )}
      </span>
    </span>
  )
}

const SPLIT = /(\[[^[\]]{1,40}\])/g
const ID = /\b([TNF]\d{1,2})\b/g

/** Renders prose and turns "[T2]" / "[N3, F1]" citations into interactive chips. */
export function CitedText({ text, invalid = [] }: { text: string; invalid?: string[] }) {
  const parts = text.split(SPLIT)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('[') && part.endsWith(']')) {
          const ids = part.toUpperCase().match(ID)
          if (ids?.length) return ids.map((id, j) => <CitationChip key={`${i}-${j}`} id={id} invalid={invalid.includes(id)} />)
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
