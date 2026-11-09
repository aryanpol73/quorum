import { motion } from 'framer-motion'
import { Activity, Briefcase, CircleCheck, Landmark, Newspaper, ShieldHalf, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { num, pct, rupee, signed, tone } from '../lib/format'
import type {
  AgentKey,
  AgentState,
  FundamentalsOutput,
  Headline,
  Indicators,
  MarketOutput,
  NewsOutput,
  RiskOutput,
  RunState,
  Verdict,
} from '../types'
import { CitedText } from './Citations'
import { Bar, Chip, LlmBadge, Medallion, roman, useSpotlight } from './ui'

const META: Record<AgentKey, { title: string; role: string; icon: ReactNode; color: string }> = {
  market: { title: 'Market Data', role: 'yfinance · RSI · SMA · MACD', icon: <Activity size={16} />, color: 'var(--color-info)' },
  news: { title: 'News Analyst', role: 'Google News · headline sentiment', icon: <Newspaper size={16} />, color: 'var(--color-violet)' },
  fundamentals: { title: 'Fundamentals', role: 'P/E · P/B · leverage · growth', icon: <Landmark size={16} />, color: 'var(--color-gold)' },
  bull: { title: 'The Bull', role: 'argues for buying', icon: <TrendingUp size={16} />, color: 'var(--color-up)' },
  bear: { title: 'The Bear', role: 'argues against buying', icon: <TrendingDown size={16} />, color: 'var(--color-down)' },
  risk: { title: 'Risk Manager', role: 'reflection · position cap', icon: <ShieldHalf size={16} />, color: 'var(--color-warn)' },
  pm: { title: 'Portfolio Manager', role: 'final decision · strict JSON', icon: <Briefcase size={16} />, color: 'var(--color-gold-bright)' },
}

function StatusPill({ status, round }: { status: AgentState['status']; round?: number }) {
  const cfg: Record<AgentState['status'], { cls: string; label: string; icon?: ReactNode }> = {
    idle: { cls: 'border-line-strong text-dim', label: 'Idle' },
    thinking: {
      cls: 'border-gold/50 bg-gold/10 text-gold-bright',
      label: round ? `Round ${roman(round)}` : 'Thinking',
      icon: (
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
      ),
    },
    waiting: { cls: 'border-info/35 bg-info/[0.07] text-info', label: round ? `Round ${roman(round)} done` : 'Waiting' },
    done: { cls: 'border-up/35 bg-up/10 text-up', label: 'Done', icon: <CircleCheck size={11} /> },
    error: { cls: 'border-down/45 bg-down/10 text-down', label: 'Error', icon: <TriangleAlert size={11} /> },
    skipped: { cls: 'border-line-strong text-dim', label: 'Skipped' },
  }
  const c = cfg[status]
  return (
    <span
      key={status + (round ?? '')}
      className={`fade-in flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10px] font-bold tracking-[0.12em] uppercase ${c.cls}`}
    >
      {c.icon}
      {c.label}
    </span>
  )
}

function RawStream({ text }: { text: string }) {
  const tail = text.length > 420 ? '…' + text.slice(-420) : text
  return (
    <div className="relative">
      <div className="label mb-1.5 flex items-center gap-1.5 text-gold/70">
        <span className="h-1 w-1 animate-pulse rounded-full bg-gold" /> structured output streaming
      </div>
      <pre className="caret font-mono text-[10.5px] leading-relaxed break-all whitespace-pre-wrap text-muted/80">{tail || ' '}</pre>
    </div>
  )
}

function Waiting({ status, message }: { status: AgentState['status']; message?: string }) {
  if (status === 'skipped') return <p className="text-[12.5px] leading-relaxed text-dim">{message ?? 'Skipped for this run.'}</p>
  if (status === 'error') return <p className="text-[12.5px] text-down">{message ?? 'This agent failed; the council continued without it.'}</p>
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
      {status === 'thinking' ? (
        <>
          <span className="dots text-gold">
            <i />
            <i />
            <i />
          </span>
          <p className="text-[12px] text-muted">Calling tools…</p>
        </>
      ) : (
        <p className="font-serif text-[15px] text-dim italic">Awaiting the council</p>
      )}
    </div>
  )
}

function KV({ k, v, cls = 'text-fg' }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="rounded-lg border border-line/70 bg-ink-950/40 px-2 py-1.5">
      <div className="text-[9px] font-bold tracking-[0.14em] text-dim uppercase">{k}</div>
      <div className={`tabular mt-0.5 text-[12.5px] ${cls}`}>{v}</div>
    </div>
  )
}

// ---------------------------------------------------------------- bodies
function MarketBody({ a }: { a: AgentState }) {
  const out = a.output as MarketOutput | undefined
  const ind = (out?.indicators ?? (a.data?.indicators as Indicators | undefined)) ?? null
  if (!ind) return <Waiting status={a.status} message={a.message} />
  const rsiTone = ind.rsi14 == null ? '' : ind.rsi14 >= 70 ? 'text-down' : ind.rsi14 <= 30 ? 'text-up' : 'text-fg'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        <KV k="RSI 14" v={num(ind.rsi14, 1)} cls={rsiTone} />
        <KV k="MACD hist" v={signed(ind.macd_hist)} cls={tone(ind.macd_hist)} />
        <KV k="Volume ×" v={num(ind.volume_spike_ratio)} cls={(ind.volume_spike_ratio ?? 0) >= 1.5 ? 'text-gold' : 'text-fg'} />
        <KV k="vs 52w high" v={pct(ind.pct_from_52w_high, 1)} cls={tone(ind.pct_from_52w_high)} />
        <KV k="6m return" v={pct(ind.return_6m_pct, 1)} cls={tone(ind.return_6m_pct)} />
        <KV k="Volatility" v={`${num(ind.volatility_ann_pct, 1)}%`} />
      </div>
      <p className={`text-[13px] leading-relaxed text-fg/90 ${a.status === 'thinking' ? 'caret' : ''}`}>{out?.interpretation ?? a.text}</p>
    </div>
  )
}

function scoreCls(s?: number) {
  if (s == null) return 'border-line text-dim'
  if (s >= 0.15) return 'border-up/35 bg-up/10 text-up'
  if (s <= -0.15) return 'border-down/35 bg-down/10 text-down'
  return 'border-line-strong text-muted'
}

function NewsBody({ a }: { a: AgentState }) {
  const out = a.output as NewsOutput | undefined
  if (!out) {
    const heads = (a.data?.headlines as Headline[] | undefined) ?? []
    if (!heads.length) return <Waiting status={a.status} message={a.message} />
    return (
      <div className="space-y-2">
        <div className="text-[12px] text-muted">{heads.length} headlines gathered · scoring each one</div>
        <RawStream text={a.text} />
      </div>
    )
  }
  const g = out.aggregate
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/70 bg-ink-950/40 px-3 py-2.5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">Aggregate sentiment</span>
          <span className={`tabular text-[15px] ${tone(g.score)}`}>{signed(g.score)}</span>
        </div>
        <div className="relative h-[6px] rounded-full" style={{ background: 'linear-gradient(90deg, var(--color-down), rgba(120,110,160,0.35) 50%, var(--color-up))' }}>
          <span
            className="from-center absolute -top-[5px] h-4 w-4 rounded-full border-2 border-ink-950 bg-gold-bright shadow-[0_0_12px] shadow-gold transition-[left] duration-700"
            style={{ left: `calc(${((g.score + 1) / 2) * 100}% - 8px)` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[9.5px] font-semibold tracking-wider text-dim uppercase">
          <span>bearish</span>
          <span>
            {g.positive} positive · {g.negative} negative
          </span>
          <span>bullish</span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{out.summary}</p>
      <ul className="space-y-1.5">
        {out.headlines.map((h, i) => (
          <li key={i} className="rise-left flex items-start gap-2.5 text-[12px] leading-snug" style={{ animationDelay: `${i * 40}ms` }}>
            <span className={`tabular mt-px shrink-0 rounded-md border px-1.5 text-[10.5px] ${scoreCls(h.score)}`}>{signed(h.score, 1)}</span>
            <span className="min-w-0">
              <a href={h.link ?? undefined} target="_blank" rel="noreferrer" className="text-fg/90 transition-colors hover:text-gold-bright" title={h.reason}>
                {h.title}
              </a>
              <span className="ml-1 text-[10.5px] text-dim">· {h.source}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const FUND_ROWS: [string, string, (v: number | null) => string][] = [
  ['pe', 'P/E', (v) => num(v, 1)],
  ['pb', 'P/B', (v) => num(v, 2)],
  ['debt_to_equity', 'Debt/Eq', (v) => (v == null ? '—' : `${num(v, 2)}x`)],
  ['revenue_growth_pct', 'Rev growth', (v) => pct(v, 1)],
  ['profit_margin_pct', 'Margin', (v) => (v == null ? '—' : `${num(v, 1)}%`)],
  ['market_cap_cr', 'Mcap ₹cr', (v) => (v == null ? '—' : new Intl.NumberFormat('en-IN').format(v))],
]

function FundamentalsBody({ a }: { a: AgentState }) {
  const out = a.output as FundamentalsOutput | undefined
  const metrics = (out?.metrics ?? (a.data?.metrics as Record<string, number | null> | undefined)) ?? null
  if (!metrics) return <Waiting status={a.status} message={a.message} />
  const v = out?.judgement?.valuation
  const vCls = v === 'cheap' ? 'border-up/40 bg-up/10 text-up' : v === 'expensive' ? 'border-down/40 bg-down/10 text-down' : 'border-gold/40 bg-gold/10 text-gold'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {FUND_ROWS.map(([key, label, fmt]) => (
          <KV key={key} k={label} v={fmt(metrics[key] ?? null)} cls={metrics[key] == null ? 'text-dim' : 'text-fg'} />
        ))}
      </div>
      {out ? (
        <>
          <div className="flex items-center gap-2.5">
            <Chip className={vCls}>{v}</Chip>
            <span className="text-[12px] text-muted">{out.judgement.summary}</span>
          </div>
          <ul className="space-y-1 text-[12px] leading-snug text-fg/85">
            {out.judgement.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[6px] h-1 w-1 shrink-0 rotate-45 bg-gold/70" />
                {r}
              </li>
            ))}
          </ul>
          {out.missing.length > 0 && <p className="text-[11px] text-dim">Missing: {out.missing.join(', ')}</p>}
        </>
      ) : (
        <RawStream text={a.text} />
      )}
    </div>
  )
}

function DebaterBody({ a, side, run }: { a: AgentState; side: 'bull' | 'bear'; run: RunState }) {
  const turns = run.turns.filter((t) => t.side === side)
  const rounds = run.meta?.rounds ?? 3
  if (!turns.length) return <Waiting status={a.status} message={a.message} />
  const last = turns[turns.length - 1]
  const cites = new Set(turns.flatMap((t) => t.citations))
  const color = side === 'bull' ? 'var(--color-up)' : 'var(--color-down)'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {Array.from({ length: rounds }, (_, i) => {
          const t = turns[i]
          return (
            <div key={i} className="flex flex-1 items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rotate-45 rounded-[2px] border transition-all duration-500 ${t?.streaming ? 'animate-pulse' : ''}`}
                style={{
                  borderColor: t ? color : 'var(--color-line-strong)',
                  background: t && !t.streaming ? color : 'transparent',
                  boxShadow: t ? `0 0 10px -2px ${color}` : undefined,
                }}
              />
              <span className="font-serif text-[12px] text-dim italic">{roman(i + 1)}</span>
              {i < rounds - 1 && <span className="h-px flex-1 bg-line-strong" />}
            </div>
          )
        })}
      </div>
      <p className={`text-[13px] leading-relaxed text-fg/90 ${last.streaming ? 'caret' : ''}`}>
        <CitedText text={last.text} invalid={last.invalid_citations} />
      </p>
      {!last.streaming && (
        <p className="text-[11px] text-dim">
          {turns.length} argument{turns.length > 1 ? 's' : ''} · {cites.size} pieces of evidence cited
        </p>
      )}
    </div>
  )
}

function RiskBody({ a }: { a: AgentState }) {
  const out = a.output as RiskOutput | undefined
  if (!out) return a.status === 'thinking' ? <RawStream text={a.text} /> : <Waiting status={a.status} message={a.message} />
  const sev = (s: string) => out.flags.filter((f) => f.severity === s).length
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/70 bg-ink-950/40 px-3 py-2.5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">Max position</span>
          <span className="tabular text-[20px] text-warn">{num(out.max_position_pct, 1)}%</span>
        </div>
        <Bar value={out.max_position_pct} max={20} color="var(--color-warn)" />
        <div className="mt-1.5 flex justify-between text-[10.5px] text-dim">
          <span className="tabular">
            σ {num(out.volatility_ann_pct, 1)}% → cap {num(out.volatility_cap_pct, 1)}%
          </span>
          <span>20% ceiling</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className="border-line-strong text-muted">{out.risk_level} risk</Chip>
        <Chip className={sev('high') ? 'border-down/45 text-down' : 'border-line text-dim'}>{sev('high')} high</Chip>
        <Chip className={sev('medium') ? 'border-warn/45 text-warn' : 'border-line text-dim'}>{sev('medium')} medium</Chip>
        <Chip className={sev('low') ? 'border-info/40 text-info' : 'border-line text-dim'}>{sev('low')} low</Chip>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{out.notes}</p>
    </div>
  )
}

function PMBody({ a }: { a: AgentState }) {
  const out = a.output as Verdict | undefined
  if (!out) return a.status === 'thinking' ? <RawStream text={a.text} /> : <Waiting status={a.status} message={a.message} />
  const c = out.decision === 'BUY' ? 'text-up' : out.decision === 'SELL' ? 'text-down' : 'text-gold'
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className={`font-serif text-[34px] leading-none font-bold tracking-[0.12em] ${c}`}>{out.decision}</span>
        <span className="tabular text-[12px] text-muted">
          conf {out.confidence} · size {num(out.position_size_pct, 1)}%
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg/85">
        <CitedText text={out.rationale[0]} />
      </p>
      <p className="text-[11px] text-dim">Schema-validated decision · priced at {rupee(out.price)}</p>
    </div>
  )
}

// ---------------------------------------------------------------- card
export function AgentCard({ k, run, index = 0, children }: { k: AgentKey; run: RunState; index?: number; children?: ReactNode }) {
  const a = run.agents[k]
  const m = META[k]
  const thinking = a.status === 'thinking'
  const spot = useSpotlight()
  const dur =
    a.startedAt != null
      ? a.endedAt != null && a.status !== 'thinking'
        ? a.endedAt - a.startedAt
        : run.status === 'running'
          ? Math.max(0, run.elapsed - a.startedAt)
          : null
      : null
  return (
    <motion.article
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onMouseMove={spot}
      className={`panel spotlight rise flex h-[330px] flex-col ${thinking ? 'aura' : ''}`}
      style={{
        animationDelay: `${index * 60}ms`,
        ...(a.status === 'done' ? { borderColor: `color-mix(in srgb, ${m.color} 28%, var(--color-line))` } : {}),
      }}
    >
      <span className="spot" />
      <header className="relative flex items-center gap-3 px-4 pt-4 pb-3">
        <Medallion color={m.color} active={thinking || a.status === 'done'}>
          {m.icon}
        </Medallion>
        <div className="min-w-0 leading-tight">
          <h3 className="title-serif truncate text-[19px]">{m.title}</h3>
          <p className="truncate text-[11px] text-dim">{m.role}</p>
        </div>
        <div className="ml-auto">
          <StatusPill status={a.status} round={a.status === 'thinking' || a.status === 'waiting' ? a.round : undefined} />
        </div>
      </header>
      <div className="mx-4 hairline opacity-60" />
      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      <footer className="relative flex items-center gap-2 border-t border-line/70 px-4 py-2 text-[10.5px] text-dim">
        <LlmBadge llm={a.llm} />
        <span className="tabular ml-auto">{dur != null ? `${dur.toFixed(1)}s` : '—'}</span>
      </footer>
    </motion.article>
  )
}

function StageHeader({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="grid h-9 w-9 place-items-center rounded-full border border-gold/35 bg-gold/[0.07] font-serif text-[16px] font-semibold text-gold">{roman(n)}</span>
      <div className="leading-tight">
        <div className="title-serif text-[22px]">{title}</div>
        <div className="text-[11.5px] text-dim">{sub}</div>
      </div>
      <span className="hairline ml-2 flex-1" />
    </div>
  )
}

export function AgentGrid({ run }: { run: RunState }) {
  return (
    <div className="space-y-4">
      <StageHeader n={1} title="The Analysts" sub="Three agents gather evidence at the same time — LangGraph fan-out" />
      <div className="grid gap-4 md:grid-cols-3">
        <AgentCard k="market" run={run} index={0}>
          <MarketBody a={run.agents.market} />
        </AgentCard>
        <AgentCard k="news" run={run} index={1}>
          <NewsBody a={run.agents.news} />
        </AgentCard>
        <AgentCard k="fundamentals" run={run} index={2}>
          <FundamentalsBody a={run.agents.fundamentals} />
        </AgentCard>
      </div>
      <StageHeader n={2} title="Debate, Reflection & Decision" sub="Evidence-only arguments · a risk review of every claim · a schema-validated verdict" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AgentCard k="bull" run={run} index={3}>
          <DebaterBody a={run.agents.bull} side="bull" run={run} />
        </AgentCard>
        <AgentCard k="bear" run={run} index={4}>
          <DebaterBody a={run.agents.bear} side="bear" run={run} />
        </AgentCard>
        <AgentCard k="risk" run={run} index={5}>
          <RiskBody a={run.agents.risk} />
        </AgentCard>
        <AgentCard k="pm" run={run} index={6}>
          <PMBody a={run.agents.pm} />
        </AgentCard>
      </div>
    </div>
  )
}
