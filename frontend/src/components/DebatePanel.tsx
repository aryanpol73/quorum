import { AnimatePresence, motion } from 'framer-motion'
import { ShieldAlert, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Fragment } from 'react'
import { leanColor, sourceColor } from '../lib/format'
import type { Evidence, RiskFlag, RunState, Turn } from '../types'
import { CitedText, useEvidence } from './Citations'
import { Empty, LlmBadge, Panel } from './ui'

const SEV: Record<RiskFlag['severity'], string> = {
  high: 'text-down',
  medium: 'text-warn',
  low: 'text-info',
}

function RiskCallout({ flag }: { flag: RiskFlag }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mx-auto flex max-w-[86%] items-start gap-2 rounded-md border border-warn/40 bg-warn/[0.07] px-3 py-2 ${
        flag.side === 'bull' ? 'mr-auto ml-6' : 'mr-6 ml-auto'
      }`}
    >
      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warn" />
      <div className="text-[12px] leading-snug">
        <span className="font-mono text-[10px] tracking-wider text-warn uppercase">
          Risk Manager · R{flag.round} {flag.side} ·{' '}
          <span className={SEV[flag.severity]}>{flag.severity}</span>
          {flag.origin === 'auto' ? ' · auto-check' : ' · LLM review'}
        </span>
        <p className="text-fg/90">{flag.issue}</p>
      </div>
    </motion.div>
  )
}

function Bubble({ turn, flags }: { turn: Turn; flags: RiskFlag[] }) {
  const bull = turn.side === 'bull'
  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: bull ? -16 : 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25 }}
        className={`flex ${bull ? 'justify-start' : 'justify-end'}`}
      >
        <div
          className={`max-w-[86%] rounded-lg border px-3.5 py-2.5 ${
            bull ? 'rounded-tl-sm border-up/30 bg-up/[0.06]' : 'rounded-tr-sm border-down/30 bg-down/[0.06]'
          }`}
        >
          <div className={`mb-1 flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase ${bull ? 'text-up' : 'text-down'}`}>
            {bull ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {bull ? 'Bull' : 'Bear'} · round {turn.round}
            {!turn.streaming && <LlmBadge llm={turn.llm} />}
          </div>
          <p className={`text-[13px] leading-relaxed text-fg/95 ${turn.streaming ? 'caret' : ''}`}>
            {turn.text ? <CitedText text={turn.text} invalid={turn.invalid_citations} /> : <span className="text-dim">thinking…</span>}
          </p>
          {!turn.streaming && (
            <div className="mt-1.5 font-mono text-[10px] text-dim">
              cites {turn.citations.length ? turn.citations.join(' · ') : <span className="text-down">nothing</span>}
              {turn.invalid_citations.length > 0 && <span className="text-down"> · invalid {turn.invalid_citations.join(', ')}</span>}
            </div>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {flags.map((f, i) => (
          <RiskCallout key={`${turn.id}-${i}`} flag={f} />
        ))}
      </AnimatePresence>
    </>
  )
}

export function DebatePanel({ run }: { run: RunState }) {
  const flags = run.risk?.flags ?? []
  const rounds = [...new Set(run.turns.map((t) => t.round))].sort((a, b) => a - b)
  return (
    <Panel
      title="Debate floor · Bull vs Bear"
      icon={<Users size={13} />}
      right={
        <span className="font-mono text-[10px] text-dim">
          {run.meta ? `${run.meta.rounds} rounds · evidence-only · reflection by Risk Manager` : ''}
        </span>
      }
      bodyClass="px-3 py-3"
    >
      {run.turns.length === 0 ? (
        <Empty>
          {run.status === 'running'
            ? 'Analysts are gathering evidence. The debate opens once the evidence board is assembled.'
            : 'Bull and Bear will argue here, round by round, citing only evidence from the ledger.'}
        </Empty>
      ) : (
        <div className="space-y-3">
          {rounds.map((r) => (
            <Fragment key={r}>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-[10px] tracking-[0.25em] text-dim uppercase">Round {r}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              {run.turns
                .filter((t) => t.round === r)
                .map((t) => (
                  <Bubble key={t.id} turn={t} flags={flags.filter((f) => f.round === t.round && f.side === t.side)} />
                ))}
            </Fragment>
          ))}
          {run.risk && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/[0.05] px-3 py-2"
            >
              <ShieldAlert size={14} className="mt-0.5 text-warn" />
              <p className="text-[12px] leading-snug text-fg/90">
                <span className="font-mono text-[10px] tracking-wider text-warn uppercase">Risk Manager summary · </span>
                {flags.length === 0 ? `Reviewed ${run.turns.length} arguments: no unsupported claims flagged. ` : ''}
                {run.risk.notes}
              </p>
            </motion.div>
          )}
        </div>
      )}
    </Panel>
  )
}

export function EvidenceLedger({ ledger }: { ledger: Evidence[] }) {
  const { hovered, setHovered } = useEvidence()
  const groups: [Evidence['source'], string][] = [
    ['market', 'Technical'],
    ['news', 'News'],
    ['fundamentals', 'Fundamentals'],
  ]
  return (
    <Panel
      title="Evidence ledger"
      right={<span className="font-mono text-[10px] text-dim">{ledger.length ? `${ledger.length} citable items` : ''}</span>}
      bodyClass="px-3 py-2 overflow-y-auto max-h-[560px]"
    >
      {ledger.length === 0 ? (
        <Empty>Built from the three analysts' outputs. Debaters may only cite these IDs.</Empty>
      ) : (
        <div className="space-y-3">
          {groups.map(([src, label]) => {
            const items = ledger.filter((e) => e.source === src)
            if (!items.length) return null
            return (
              <div key={src}>
                <div className="label mb-1">{label}</div>
                <ul className="space-y-1">
                  {items.map((e) => (
                    <li
                      key={e.id}
                      onMouseEnter={() => setHovered(e.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`flex items-start gap-2 rounded px-1 py-0.5 text-[11.5px] leading-snug transition ${
                        hovered === e.id ? 'bg-ink-700' : ''
                      }`}
                    >
                      <span className={`mt-px shrink-0 rounded border px-1 font-mono text-[10px] ${sourceColor[e.id[0]]}`}>{e.id}</span>
                      <span className={`mt-px shrink-0 font-mono text-[10px] ${leanColor(e.lean)}`}>
                        {e.lean === 'bullish' ? '▲' : e.lean === 'bearish' ? '▼' : '•'}
                      </span>
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
