import { motion } from 'framer-motion'
import { CircleCheck, Gavel, LoaderCircle, Receipt } from 'lucide-react'
import { decisionColor, num, rupee } from '../lib/format'
import type { RunState } from '../types'
import { CitedText } from './Citations'
import { Bar, LlmBadge, Panel } from './ui'

function ConfidenceRing({ value, color }: { value: number; color: string }) {
  const r = 38
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[96px] w-[96px] shrink-0">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="7" />
        <motion.circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[22px] font-semibold text-fg">{value}</span>
        <span className="label -mt-0.5">confidence</span>
      </div>
    </div>
  )
}

const STAGES: { label: string; nodes: string[] }[] = [
  { label: 'Analysts (parallel)', nodes: ['market_analyst', 'news_analyst', 'fundamentals_analyst'] },
  { label: 'Evidence board', nodes: ['evidence_board'] },
  { label: 'Bull vs Bear debate', nodes: ['bull', 'bear'] },
  { label: 'Risk reflection', nodes: ['risk_manager'] },
  { label: 'Portfolio decision', nodes: ['portfolio_manager'] },
  { label: 'Paper trade', nodes: ['paper_trade'] },
]

function Progress({ run }: { run: RunState }) {
  const started = (n: string[]) => run.nodes.some((s) => n.includes(s.node))
  const active = (n: string[]) => run.nodes.some((s) => n.includes(s.node) && s.end == null)
  return (
    <ol className="space-y-2">
      {STAGES.map((st, i) => {
        const isActive = active(st.nodes)
        const later = STAGES.slice(i + 1).some((x) => started(x.nodes))
        const done = started(st.nodes) && !isActive && (later || run.status !== 'running')
        const debateRounds = st.nodes.includes('bull') ? run.turns.filter((t) => t.side === 'bear' && !t.streaming).length : 0
        return (
          <li key={st.label} className="flex items-center gap-2.5 font-mono text-[11.5px]">
            {done ? (
              <CircleCheck size={14} className="text-up" />
            ) : isActive ? (
              <LoaderCircle size={14} className="animate-spin text-amber" />
            ) : (
              <span className="mx-[3px] h-2 w-2 rounded-full border border-dim" />
            )}
            <span className={done ? 'text-muted' : isActive ? 'text-amber' : 'text-dim'}>{st.label}</span>
            {st.nodes.includes('bull') && (isActive || done) && (
              <span className="text-[10px] text-dim">
                {debateRounds}/{run.meta?.rounds ?? 3}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function VerdictPanel({ run }: { run: RunState }) {
  const v = run.verdict
  const color = decisionColor(v?.decision)
  const trade = run.trade

  return (
    <Panel title="Verdict" icon={<Gavel size={13} />} right={v ? <LlmBadge llm={v.llm} /> : null} bodyClass="p-4">
      {!v ? (
        run.status === 'idle' ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-full border border-dashed border-line-strong">
              <Gavel size={26} className="text-dim" />
            </div>
            <p className="font-mono text-[12px] tracking-[0.2em] text-dim uppercase">Awaiting quorum</p>
            <p className="max-w-[240px] text-[12px] text-dim">Pick a ticker and convene the agents. Seven agents will analyse, debate and vote.</p>
          </div>
        ) : run.status === 'error' ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
            <p className="font-mono text-[12px] tracking-widest text-down uppercase">Session aborted</p>
            <p className="max-w-[260px] text-[12px] text-muted">{run.error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="font-mono text-[11px] tracking-widest text-amber uppercase">Quorum in session · {run.elapsed.toFixed(1)}s</p>
            <Progress run={run} />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <motion.div
              key={`${run.meta?.run_id}-${v.decision}`}
              initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              className="grid h-[96px] flex-1 place-items-center rounded-lg border-2"
              style={{ borderColor: color, color, background: `color-mix(in srgb, ${color} 10%, transparent)`, boxShadow: `0 0 32px -8px ${color}` }}
            >
              <span className="font-mono text-[40px] leading-none font-bold tracking-[0.18em]">{v.decision}</span>
            </motion.div>
            <ConfidenceRing value={v.confidence} color={color} />
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label">Position size</span>
              <span className="tabular text-[13px] text-fg">
                {num(v.position_size_pct, 1)}% <span className="text-dim">/ cap {num(v.max_position_pct, 1)}%</span>
              </span>
            </div>
            <Bar value={v.position_size_pct} max={20} color={color} />
          </div>

          <ul className="space-y-1.5">
            {v.rationale.map((r, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.12 }}
                className="flex gap-2 text-[12.5px] leading-snug text-fg/90"
              >
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <span>
                  <CitedText text={r} />
                </span>
              </motion.li>
            ))}
          </ul>

          {v.adjustments.length > 0 && (
            <p className="rounded border border-line px-2 py-1 font-mono text-[10.5px] text-dim">{v.adjustments.join(' ')}</p>
          )}

          <div className="rounded-md border border-line bg-ink-850 p-3">
            <div className="label mb-1.5 flex items-center gap-1.5">
              <Receipt size={11} /> Paper trade ticket
            </div>
            {!trade ? (
              <p className="font-mono text-[11px] text-dim">routing order…</p>
            ) : trade.executed && trade.trade ? (
              <div className="font-mono text-[12px]">
                <span className={trade.trade.side === 'BUY' ? 'text-up' : 'text-down'}>{trade.trade.side}</span>{' '}
                <span className="text-fg">
                  {trade.trade.qty} × {trade.trade.ticker} @ {rupee(trade.trade.price)}
                </span>
                <span className="text-muted"> = {rupee(trade.trade.value)}</span>
                {trade.portfolio && (
                  <div className="mt-1 text-[10.5px] text-dim">
                    cash {rupee(trade.portfolio.cash, 0)} · portfolio {rupee(trade.portfolio.total_value, 0)}
                  </div>
                )}
              </div>
            ) : (
              <p className="font-mono text-[11px] text-muted">No order · {trade.reason}</p>
            )}
            <p className="mt-1.5 text-[10px] text-dim">
              Close {rupee(v.price)} on {v.price_date} · virtual ₹1,00,000 portfolio
            </p>
          </div>
        </div>
      )}
    </Panel>
  )
}
