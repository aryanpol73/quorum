import { Check, Gavel, Receipt } from 'lucide-react'
import { num, rupee } from '../lib/format'
import type { Decision, RunState } from '../types'
import { CitedText } from './Citations'
import { AnimatedNumber, Bar, LlmBadge, Panel, roman } from './ui'

const JEWEL: Record<Decision, { light: string; base: string; deep: string; glow: string; word: string }> = {
  BUY: { light: '#9af0cc', base: '#2fbf8a', deep: '#0d5a40', glow: 'rgba(63,216,162,0.55)', word: 'Acquire' },
  SELL: { light: '#ffb0c2', base: '#d9385f', deep: '#5e0f25', glow: 'rgba(242,90,124,0.55)', word: 'Divest' },
  HOLD: { light: '#fbe7b4', base: '#c9a053', deep: '#5c4217', glow: 'rgba(220,183,108,0.5)', word: 'Abide' },
}

/** The verdict, pressed into a wax seal with a slowly rotating inscription. */
function Seal({ decision, id }: { decision: Decision; id: string }) {
  const j = JEWEL[decision]
  const bumps = 26
  return (
    <div key={id} className="stamp relative mx-auto h-[210px] w-[210px]" style={{ filter: `drop-shadow(0 18px 34px ${j.glow})` }}>
      {/* impact ripple */}
      <span className="ripple absolute inset-0 rounded-full border-2" style={{ borderColor: j.base }} />
      <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={`Verdict: ${decision}`}>
        <defs>
          <radialGradient id={`wax-${id}`} cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor={j.light} />
            <stop offset="0.45" stopColor={j.base} />
            <stop offset="1" stopColor={j.deep} />
          </radialGradient>
          <linearGradient id={`rim-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,0.55)" />
            <stop offset="0.5" stopColor="rgba(255,255,255,0.05)" />
            <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
          </linearGradient>
          <path id={`ring-${id}`} d="M100,100 m-68,0 a68,68 0 1,1 136,0 a68,68 0 1,1 -136,0" />
        </defs>
        {/* scalloped wax edge */}
        {Array.from({ length: bumps }, (_, i) => {
          const a = (i / bumps) * Math.PI * 2
          const r = 84 + (i % 3 === 0 ? 3 : i % 2 === 0 ? -1 : 1)
          return <circle key={i} cx={100 + Math.cos(a) * r} cy={100 + Math.sin(a) * r} r={11} fill={`url(#wax-${id})`} />
        })}
        <circle cx="100" cy="100" r="86" fill={`url(#wax-${id})`} />
        <circle cx="100" cy="100" r="80" fill="none" stroke={`url(#rim-${id})`} strokeWidth="2.5" />
        <circle cx="100" cy="100" r="56" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
        <g className="seal-ring">
          <text fontFamily="'Manrope', sans-serif" fontSize="9.5" fontWeight="800" letterSpacing="3.2" fill="rgba(255,255,255,0.72)">
            <textPath href={`#ring-${id}`}>QUORUM · DECREE OF THE COUNCIL · QUORUM · DECREE OF THE COUNCIL ·</textPath>
          </text>
        </g>
        <text
          x="100"
          y="108"
          textAnchor="middle"
          fontFamily="'Cormorant Garamond', Georgia, serif"
          fontSize="40"
          fontWeight="700"
          letterSpacing="3"
          fill="rgba(255,255,255,0.95)"
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1.2 }}
        >
          {decision}
        </text>
        <text x="100" y="128" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontStyle="italic" fontSize="13" fill="rgba(255,255,255,0.7)">
          {j.word}
        </text>
      </svg>
    </div>
  )
}

function ConfidenceRing({ value, color }: { value: number; color: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[64px] w-[64px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          className="ring-draw"
          style={{ strokeDashoffset: c * (1 - value / 100), filter: `drop-shadow(0 0 4px ${color})`, ['--c' as string]: c, transition: 'stroke-dashoffset 0.8s' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <AnimatedNumber value={value} format={(v) => Math.round(v).toString()} className="tabular text-[17px] text-fg" />
      </div>
    </div>
  )
}

const STAGES: { label: string; nodes: string[] }[] = [
  { label: 'Analysts gather evidence', nodes: ['market_analyst', 'news_analyst', 'fundamentals_analyst'] },
  { label: 'Evidence ledger sealed', nodes: ['evidence_board'] },
  { label: 'Bull and Bear debate', nodes: ['bull', 'bear'] },
  { label: 'Risk Manager reflects', nodes: ['risk_manager'] },
  { label: 'Portfolio Manager decides', nodes: ['portfolio_manager'] },
  { label: 'Paper trade executed', nodes: ['paper_trade'] },
]

function Progress({ run }: { run: RunState }) {
  const started = (n: string[]) => run.nodes.some((s) => n.includes(s.node))
  const active = (n: string[]) => run.nodes.some((s) => n.includes(s.node) && s.end == null)
  return (
    <ol className="relative space-y-0">
      {STAGES.map((st, i) => {
        const isActive = active(st.nodes)
        const later = STAGES.slice(i + 1).some((x) => started(x.nodes))
        const done = started(st.nodes) && !isActive && (later || run.status !== 'running')
        const debateRounds = st.nodes.includes('bull') ? run.turns.filter((t) => t.side === 'bear' && !t.streaming).length : 0
        return (
          <li key={st.label} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < STAGES.length - 1 && (
              <span className="absolute top-7 bottom-0 left-[13px] w-px overflow-hidden bg-line-strong">
                <span className="block w-full bg-gradient-to-b from-gold to-gold/30 transition-[height] duration-700" style={{ height: done ? '100%' : 0 }} />
              </span>
            )}
            <span
              className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] transition-all duration-500 ${
                done ? 'border-gold/60 bg-gold/15 text-gold-bright' : isActive ? 'aura border-gold/40 bg-ink-850 text-gold' : 'border-line-strong bg-ink-900 text-dim'
              }`}
            >
              {done ? <Check size={13} /> : <span className="font-serif text-[13px]">{roman(i + 1)}</span>}
            </span>
            <div className="pt-1 leading-tight">
              <div className={`text-[13px] font-semibold transition-colors duration-500 ${done ? 'text-muted' : isActive ? 'text-gold-bright' : 'text-dim'}`}>{st.label}</div>
              {st.nodes.includes('bull') && (isActive || done) && (
                <div className="tabular mt-0.5 text-[11px] text-dim">
                  round {debateRounds} of {run.meta?.rounds ?? 3}
                </div>
              )}
              {isActive && !st.nodes.includes('bull') && (
                <span className="dots mt-1 text-gold">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function VerdictPanel({ run }: { run: RunState }) {
  const v = run.verdict
  const trade = run.trade
  const color = v ? JEWEL[v.decision].base : 'var(--color-gold)'

  return (
    <Panel eyebrow="Decree" title="The Verdict" icon={<Gavel size={14} />} right={v ? <LlmBadge llm={v.llm} /> : null} bodyClass="p-5">
      {!v ? (
        run.status === 'idle' ? (
          <div className="flex h-full min-h-[380px] flex-col items-center justify-center gap-5 text-center">
            <div className="relative grid h-36 w-36 place-items-center">
              <span className="absolute inset-0 animate-[spin_60s_linear_infinite] rounded-full border border-dashed border-gold/35" />
              <div className="grid h-24 w-24 animate-float place-items-center rounded-full border border-gold/20 bg-gold/[0.04]">
                <Gavel size={30} className="text-gold/70" />
              </div>
            </div>
            <div>
              <p className="title-serif text-[24px] italic">Awaiting the council</p>
              <p className="mx-auto mt-2 max-w-[260px] text-[12.5px] leading-relaxed text-dim">
                Choose a stock and convene the council. Seven agents will analyse it, debate it and seal a decision.
              </p>
            </div>
          </div>
        ) : run.status === 'error' ? (
          <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 text-center">
            <p className="title-serif text-[24px] text-down italic">Session adjourned</p>
            <p className="max-w-[280px] text-[13px] leading-relaxed text-muted">{run.error}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="title-serif text-[22px] italic">The council is deliberating</p>
              <p className="tabular mt-1 text-[12px] text-gold">{run.elapsed.toFixed(1)}s in session</p>
            </div>
            <Progress run={run} />
          </div>
        )
      ) : (
        <div className="space-y-5">
          <Seal decision={v.decision} id={run.meta?.run_id ?? 'seal'} />

          <div className="rise grid grid-cols-[auto_1fr] items-center gap-4 rounded-2xl border border-line/80 bg-ink-950/40 p-3.5" style={{ animationDelay: '350ms' }}>
            <ConfidenceRing value={v.confidence} color={color} />
            <div className="min-w-0 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="label">Confidence</span>
                <span className="label">Position</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="tabular text-[13px] text-muted">{v.confidence}/100</span>
                <span className="tabular text-[15px] text-fg">
                  {num(v.position_size_pct, 1)}% <span className="text-[11px] text-dim">of {num(v.max_position_pct, 1)}% cap</span>
                </span>
              </div>
              <Bar value={v.position_size_pct} max={20} color={color} />
            </div>
          </div>

          <ul className="space-y-2.5">
            {v.rationale.map((r, i) => (
              <li key={i} className="rise-right flex gap-3 text-[13px] leading-relaxed text-fg/90" style={{ animationDelay: `${500 + i * 120}ms` }}>
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span>
                  <CitedText text={r} />
                </span>
              </li>
            ))}
          </ul>

          {v.adjustments.length > 0 && <p className="rounded-xl border border-line px-3 py-2 text-[11.5px] text-dim">{v.adjustments.join(' ')}</p>}

          <div
            className="rise relative overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.09] via-transparent to-transparent p-4"
            style={{ animationDelay: '850ms' }}
          >
            <div className="eyebrow mb-2 flex items-center gap-1.5">
              <Receipt size={12} /> Order ticket
            </div>
            {!trade ? (
              <p className="text-[12px] text-dim">Routing the order…</p>
            ) : trade.executed && trade.trade ? (
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`font-serif text-[22px] font-bold ${trade.trade.side === 'BUY' ? 'text-up' : 'text-down'}`}>{trade.trade.side}</span>
                  <span className="tabular text-[15px] text-fg">
                    {trade.trade.qty} × {trade.trade.ticker}
                  </span>
                  <span className="tabular text-[13px] text-muted">@ {rupee(trade.trade.price)}</span>
                </div>
                <div className="tabular mt-1 text-[13px] text-gold-bright">= {rupee(trade.trade.value)}</div>
                {trade.portfolio && (
                  <div className="tabular mt-2 text-[11px] text-dim">
                    Cash {rupee(trade.portfolio.cash, 0)} · Portfolio {rupee(trade.portfolio.total_value, 0)}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-muted">No order · {trade.reason}</p>
            )}
            <p className="mt-2 text-[10.5px] text-dim">
              Close {rupee(v.price)} on {v.price_date} · virtual ₹1,00,000 portfolio
            </p>
          </div>
        </div>
      )}
    </Panel>
  )
}
