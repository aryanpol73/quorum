import { ScrollText, ShieldHalf, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Fragment } from 'react'
import { leanColor, sourceColor } from '../lib/format'
import type { Evidence, RiskFlag, RunState, Turn } from '../types'
import { CitedText, useEvidence } from './Citations'
import { Empty, LlmBadge, Medallion, Ornament, Panel, roman } from './ui'

const SEV: Record<RiskFlag['severity'], string> = {
  high: 'text-down border-down/40',
  medium: 'text-warn border-warn/40',
  low: 'text-info border-info/40',
}

function RiskCallout({ flag }: { flag: RiskFlag }) {
  return (
    <div
      className={`rise relative flex max-w-[82%] items-start gap-3 overflow-hidden rounded-2xl border border-warn/30 bg-gradient-to-r from-warn/[0.1] to-warn/[0.03] py-2.5 pr-4 pl-4 ${
        flag.side === 'bull' ? 'mr-auto ml-12' : 'mr-12 ml-auto'
      }`}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-warn shadow-[0_0_14px] shadow-warn" />
      <ShieldHalf size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="text-[12.5px] leading-snug">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.16em] text-warn uppercase">Risk Manager's note</span>
          <span className={`rounded-full border px-1.5 text-[9.5px] font-bold tracking-wider uppercase ${SEV[flag.severity]}`}>{flag.severity}</span>
          <span className="text-[10px] text-dim">
            on the {flag.side} · round {roman(flag.round)} · {flag.origin === 'auto' ? 'automatic check' : 'LLM review'}
          </span>
        </div>
        <p className="text-fg/90">{flag.issue}</p>
      </div>
    </div>
  )
}

function Bubble({ turn, flags }: { turn: Turn; flags: RiskFlag[] }) {
  const bull = turn.side === 'bull'
  const color = bull ? 'var(--color-up)' : 'var(--color-down)'
  return (
    <>
      <div className={`flex items-end gap-3 ${bull ? 'rise-left' : 'rise-right flex-row-reverse'}`}>
        <Medallion color={color} size={36} active={turn.streaming}>
          {bull ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
        </Medallion>
        <div
          className={`relative max-w-[80%] rounded-[22px] border px-5 py-3.5 ${bull ? 'rounded-bl-md' : 'rounded-br-md'}`}
          style={{
            borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
            background: `linear-gradient(${bull ? '120deg' : '240deg'}, color-mix(in srgb, ${color} 11%, transparent), color-mix(in srgb, ${color} 3%, transparent) 70%)`,
            boxShadow: turn.streaming ? `0 0 34px -12px ${color}` : undefined,
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-serif text-[16px] font-semibold" style={{ color }}>
              {bull ? 'The Bull' : 'The Bear'}
            </span>
            <span className="text-[10px] font-bold tracking-[0.16em] text-dim uppercase">round {roman(turn.round)}</span>
            {!turn.streaming && <LlmBadge llm={turn.llm} />}
          </div>
          <p className={`text-[14px] leading-[1.7] text-fg/95 ${turn.streaming ? 'caret' : ''}`}>
            {turn.text ? <CitedText text={turn.text} invalid={turn.invalid_citations} /> : <span className="text-dim italic">gathering thoughts…</span>}
          </p>
          {!turn.streaming && (
            <div className="mt-2 text-[10.5px] text-dim">
              Evidence cited · {turn.citations.length ? turn.citations.join(' · ') : <span className="text-down">none</span>}
              {turn.invalid_citations.length > 0 && <span className="text-down"> · invalid {turn.invalid_citations.join(', ')}</span>}
            </div>
          )}
        </div>
      </div>
      {flags.map((f, i) => (
        <RiskCallout key={`${turn.id}-${i}`} flag={f} />
      ))}
    </>
  )
}

export function DebatePanel({ run }: { run: RunState }) {
  const flags = run.risk?.flags ?? []
  const rounds = [...new Set(run.turns.map((t) => t.round))].sort((a, b) => a - b)
  return (
    <Panel
      eyebrow="The chamber"
      title="Bull versus Bear"
      icon={<Users size={14} />}
      right={run.meta ? <span className="text-[11px] text-dim">{run.meta.rounds} rounds · evidence-only · audited by the Risk Manager</span> : null}
      bodyClass="px-5 py-5"
    >
      {run.turns.length === 0 ? (
        <Empty icon={<ScrollText size={22} />}>
          {run.status === 'running'
            ? 'The analysts are gathering evidence. The debate opens once the evidence ledger is sealed.'
            : 'The Bull and the Bear will argue here, round by round, citing only evidence from the ledger.'}
        </Empty>
      ) : (
        <div className="space-y-4">
          {rounds.map((r) => (
            <Fragment key={r}>
              <Ornament>Round {roman(r)}</Ornament>
              {run.turns
                .filter((t) => t.round === r)
                .map((t) => (
                  <Bubble key={t.id} turn={t} flags={flags.filter((f) => f.round === t.round && f.side === t.side)} />
                ))}
            </Fragment>
          ))}
          {run.risk && (
            <div className="rise relative mt-2 overflow-hidden rounded-2xl border border-warn/25 bg-gradient-to-br from-warn/[0.08] to-transparent px-5 py-4">
              <div className="mb-1 flex items-center gap-2">
                <ShieldHalf size={15} className="text-warn" />
                <span className="text-[10px] font-bold tracking-[0.18em] text-warn uppercase">Risk Manager · closing review</span>
              </div>
              <p className="text-[13px] leading-relaxed text-fg/90">
                {flags.length === 0 ? `Reviewed ${run.turns.length} arguments and found no unsupported claims. ` : ''}
                {run.risk.notes}
              </p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

const GROUPS: [Evidence['source'], string][] = [
  ['market', 'Technical'],
  ['news', 'News'],
  ['fundamentals', 'Fundamentals'],
]

export function EvidenceLedger({ ledger }: { ledger: Evidence[] }) {
  const { hovered, setHovered } = useEvidence()
  return (
    <Panel
      eyebrow="Sealed evidence"
      title="The Ledger"
      icon={<ScrollText size={14} />}
      right={ledger.length ? <span className="tabular text-[11px] text-dim">{ledger.length} items</span> : null}
      bodyClass="px-4 py-3 overflow-y-auto max-h-[640px]"
    >
      {ledger.length === 0 ? (
        <Empty>Compiled from the three analysts. The debaters may cite only these IDs.</Empty>
      ) : (
        <div className="space-y-4">
          {GROUPS.map(([src, label]) => {
            const items = ledger.filter((e) => e.source === src)
            if (!items.length) return null
            return (
              <div key={src}>
                <div className="eyebrow mb-1.5">{label}</div>
                <ul className="space-y-0.5">
                  {items.map((e, i) => (
                    <li
                      key={e.id}
                      style={{ animationDelay: `${i * 25}ms` }}
                      onMouseEnter={() => setHovered(e.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`rise flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-snug transition-colors duration-200 ${
                        hovered === e.id ? 'bg-gold/[0.08]' : ''
                      }`}
                    >
                      <span className={`mt-px shrink-0 rounded-md border px-1.5 font-mono text-[10px] ${sourceColor[e.id[0]]}`}>{e.id}</span>
                      <span className={`mt-px shrink-0 text-[10px] ${leanColor(e.lean)}`}>{e.lean === 'bullish' ? '▲' : e.lean === 'bearish' ? '▼' : '◆'}</span>
                      <span className="text-fg/85">{e.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
