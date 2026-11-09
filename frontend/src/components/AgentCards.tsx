import { motion } from 'framer-motion'
import { Activity, Briefcase, CircleCheck, Landmark, Newspaper, ShieldAlert, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
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
import { Bar, Chip, LlmBadge } from './ui'

const META: Record<AgentKey, { title: string; role: string; icon: ReactNode; accent: string }> = {
  market: { title: 'Market Data', role: 'yfinance · RSI · SMA · MACD', icon: <Activity size={15} />, accent: 'text-info' },
  news: { title: 'News Analyst', role: 'Google News RSS · sentiment', icon: <Newspaper size={15} />, accent: 'text-violet' },
  fundamentals: { title: 'Fundamentals', role: 'P/E · P/B · D/E · growth', icon: <Landmark size={15} />, accent: 'text-amber' },
  bull: { title: 'Bull', role: 'argues the long case', icon: <TrendingUp size={15} />, accent: 'text-up' },
  bear: { title: 'Bear', role: 'argues the short case', icon: <TrendingDown size={15} />, accent: 'text-down' },
  risk: { title: 'Risk Manager', role: 'reflection · position cap', icon: <ShieldAlert size={15} />, accent: 'text-warn' },
  pm: { title: 'Portfolio Manager', role: 'final call · strict JSON', icon: <Briefcase size={15} />, accent: 'text-fg' },
}

function StatusPill({ status, round, rounds }: { status: AgentState['status']; round?: number; rounds?: number }) {
  const map: Record<AgentState['status'], string> = {
    idle: 'border-line text-dim',
    thinking: 'border-amber/60 bg-amber/10 text-amber',
    waiting: 'border-info/40 bg-info/5 text-info',
    done: 'border-up/40 bg-up/10 text-up',
    error: 'border-down/60 bg-down/10 text-down',
    skipped: 'border-line text-dim',
  }
  const label = status === 'thinking' && round ? `R${round}/${rounds ?? 3} speaking` : status === 'waiting' && round ? `R${round} done · waiting` : status
  return (
    <span className={`flex items-center gap-1.5 rounded border px-1.5 py-px font-mono text-[10px] tracking-wider uppercase ${map[status]}`}>
      {status === 'thinking' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />}
      {status === 'done' && <CircleCheck size={11} />}
      {status === 'error' && <TriangleAlert size={11} />}
      {label}
    </span>
  )
}

function RawStream({ text }: { text: string }) {
  const tail = text.length > 420 ? '…' + text.slice(-420) : text
  return (
    <pre className="caret font-mono text-[10.5px] leading-relaxed break-all whitespace-pre-wrap text-muted/80">{tail || ' '}</pre>
  )
}

function Waiting({ status, message }: { status: AgentState['status']; message?: string }) {
  if (status === 'skipped') return <p className="text-[12px] text-dim">{message ?? 'Skipped for this run.'}</p>
  if (status === 'error') return <p className="text-[12px] text-down">{message ?? 'Agent failed; the pipeline continued without it.'}</p>
  return <p className="font-mono text-[11px] text-dim">{status === 'thinking' ? 'calling tools…' : 'idle — awaiting the quorum'}</p>
}

// ---------------------------------------------------------------- bodies
function MarketBody({ a }: { a: AgentState }) {
  const out = a.output as MarketOutput | undefined
  const ind = (out?.indicators ?? (a.data?.indicators as Indicators | undefined)) ?? null
  if (!ind) return <Waiting status={a.status} message={a.message} />
  const rsiTone = ind.rsi14 == null ? '' : ind.rsi14 >= 70 ? 'text-down' : ind.rsi14 <= 30 ? 'text-up' : 'text-fg'
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[11px]">
        <KV k="RSI 14" v={num(ind.rsi14, 1)} cls={rsiTone} />
        <KV k="MACD H" v={signed(ind.macd_hist)} cls={tone(ind.macd_hist)} />
        <KV k="VOL ×" v={num(ind.volume_spike_ratio)} cls={(ind.volume_spike_ratio ?? 0) >= 1.5 ? 'text-amber' : 'text-fg'} />
        <KV k="vs 52W H" v={pct(ind.pct_from_52w_high, 1)} cls={tone(ind.pct_from_52w_high)} />
        <KV k="6M RET" v={pct(ind.return_6m_pct, 1)} cls={tone(ind.return_6m_pct)} />
        <KV k="σ ANN" v={`${num(ind.volatility_ann_pct, 1)}%`} />
      </div>
      <p className={`text-[12.5px] leading-relaxed text-fg/90 ${a.status === 'thinking' ? 'caret' : ''}`}>{out?.interpretation ?? a.text}</p>
    </div>
  )
}

function KV({ k, v, cls = 'text-fg' }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1 border-b border-line/60 pb-0.5">
      <span className="text-[9.5px] tracking-wider text-dim">{k}</span>
      <span className={`tabular ${cls}`}>{v}</span>
    </div>
  )
}

function scoreCls(s?: number) {
  if (s == null) return 'border-line text-dim'
  if (s >= 0.15) return 'border-up/40 bg-up/10 text-up'
  if (s <= -0.15) return 'border-down/40 bg-down/10 text-down'
  return 'border-line text-muted'
}

function NewsBody({ a }: { a: AgentState }) {
  const out = a.output as NewsOutput | undefined
  if (!out) {
    const heads = (a.data?.headlines as Headline[] | undefined) ?? []
    if (!heads.length) return <Waiting status={a.status} message={a.message} />
    return (
      <div className="space-y-2">
        <div className="label">{heads.length} headlines fetched · scoring</div>
        <RawStream text={a.text} />
      </div>
    )
  }
  const g = out.aggregate
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="label">Sentiment</span>
        <div className="relative h-1.5 flex-1 rounded-full bg-gradient-to-r from-down/60 via-ink-700 to-up/60">
          <span
            className="absolute -top-1 h-3.5 w-1 rounded bg-fg shadow"
            style={{ left: `calc(${((g.score + 1) / 2) * 100}% - 2px)` }}
            aria-hidden
          />
        </div>
        <span className={`tabular text-[12px] ${tone(g.score)}`}>{signed(g.score)}</span>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{out.summary}</p>
      <ul className="space-y-1">
        {out.headlines.map((h, i) => (
          <li key={i} className="flex items-start gap-2 text-[11.5px] leading-snug">
            <span className={`tabular mt-px shrink-0 rounded border px-1 text-[10px] ${scoreCls(h.score)}`}>{signed(h.score, 1)}</span>
            <span className="min-w-0">
              <a href={h.link ?? undefined} target="_blank" rel="noreferrer" className="text-fg/90 hover:text-amber" title={h.reason}>
                {h.title}
              </a>
              <span className="ml-1 text-[10px] text-dim">· {h.source}</span>
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
  ['debt_to_equity', 'D/E', (v) => (v == null ? '—' : `${num(v, 2)}x`)],
  ['revenue_growth_pct', 'REV GR', (v) => pct(v, 1)],
  ['profit_margin_pct', 'MARGIN', (v) => (v == null ? '—' : `${num(v, 1)}%`)],
  ['market_cap_cr', 'MCAP ₹CR', (v) => (v == null ? '—' : new Intl.NumberFormat('en-IN').format(v))],
]

function FundamentalsBody({ a }: { a: AgentState }) {
  const out = a.output as FundamentalsOutput | undefined
  const metrics = (out?.metrics ?? (a.data?.metrics as Record<string, number | null> | undefined)) ?? null
  if (!metrics) return <Waiting status={a.status} message={a.message} />
  const v = out?.judgement?.valuation
  const vCls = v === 'cheap' ? 'border-up/50 bg-up/10 text-up' : v === 'expensive' ? 'border-down/50 bg-down/10 text-down' : 'border-amber/50 bg-amber/10 text-amber'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[11px]">
        {FUND_ROWS.map(([key, label, fmt]) => (
          <KV key={key} k={label} v={fmt(metrics[key] ?? null)} cls={metrics[key] == null ? 'text-dim' : 'text-fg'} />
        ))}
      </div>
      {out ? (
        <>
          <div className="flex items-center gap-2">
            <Chip className={vCls}>{v}</Chip>
            <span className="text-[11.5px] text-muted">{out.judgement.summary}</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] leading-snug text-fg/85 marker:text-dim">
            {out.judgement.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {out.missing.length > 0 && <p className="text-[10.5px] text-dim">Missing: {out.missing.join(', ')}</p>}
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
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: rounds }, (_, i) => {
          const t = turns[i]
          return (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${t ? (t.streaming ? 'animate-pulse bg-amber' : side === 'bull' ? 'bg-up' : 'bg-down') : 'bg-ink-700'}`}
            />
          )
        })}
      </div>
      <p className={`text-[12px] leading-relaxed text-fg/90 ${last.streaming ? 'caret' : ''}`}>
        <CitedText text={last.text} invalid={last.invalid_citations} />
      </p>
      {!last.streaming && <p className="font-mono text-[10px] text-dim">{turns.length} argument(s) · {cites.size} distinct evidence cited</p>}
    </div>
  )
}

function RiskBody({ a }: { a: AgentState }) {
  const out = a.output as RiskOutput | undefined
  if (!out) return a.status === 'thinking' ? <RawStream text={a.text} /> : <Waiting status={a.status} message={a.message} />
  const sev = (s: string) => out.flags.filter((f) => f.severity === s).length
  return (
    <div className="space-y-2.5">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="label">Max position</span>
          <span className="tabular text-[15px] text-warn">{num(out.max_position_pct, 1)}%</span>
        </div>
        <Bar value={out.max_position_pct} max={20} color="var(--color-warn)" />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
          <span>σ {num(out.volatility_ann_pct, 1)}% → vol cap {num(out.volatility_cap_pct, 1)}%</span>
          <span>20% hard limit</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className="border-line text-muted">risk {out.risk_level}</Chip>
        <Chip className={sev('high') ? 'border-down/50 text-down' : 'border-line text-dim'}>{sev('high')} high</Chip>
        <Chip className={sev('medium') ? 'border-warn/50 text-warn' : 'border-line text-dim'}>{sev('medium')} med</Chip>
        <Chip className={sev('low') ? 'border-info/40 text-info' : 'border-line text-dim'}>{sev('low')} low</Chip>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{out.notes}</p>
    </div>
  )
}

function PMBody({ a }: { a: AgentState }) {
  const out = a.output as Verdict | undefined
  if (!out) return a.status === 'thinking' ? <RawStream text={a.text} /> : <Waiting status={a.status} message={a.message} />
  const c = out.decision === 'BUY' ? 'text-up' : out.decision === 'SELL' ? 'text-down' : 'text-amber'
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <span className={`font-mono text-2xl font-bold tracking-widest ${c}`}>{out.decision}</span>
        <span className="tabular text-[12px] text-muted">conf {out.confidence} · size {num(out.position_size_pct, 1)}%</span>
      </div>
      <p className="text-[11.5px] leading-snug text-fg/85">
        <CitedText text={out.rationale[0]} />
      </p>
      <p className="font-mono text-[10px] text-dim">Validated against Pydantic schema · @ {rupee(out.price)}</p>
    </div>
  )
}

// ---------------------------------------------------------------- card
export function AgentCard({ k, run, children }: { k: AgentKey; run: RunState; children?: ReactNode }) {
  const a = run.agents[k]
  const m = META[k]
  const thinking = a.status === 'thinking'
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
      layout="position"
      className={`panel flex h-[300px] flex-col overflow-hidden transition-colors ${
        thinking ? 'animate-pulse-ring border-amber/70' : a.status === 'done' ? 'border-line-strong' : ''
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={m.accent}>{m.icon}</span>
        <div className="min-w-0 leading-tight">
          <h3 className="truncate font-mono text-[12px] font-semibold tracking-wider text-fg uppercase">{m.title}</h3>
          <p className="truncate text-[10px] text-dim">{m.role}</p>
        </div>
        <div className="ml-auto">
          <StatusPill status={a.status} round={a.round} rounds={run.meta?.rounds} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">{children}</div>
      <footer className="flex items-center gap-2 border-t border-line px-3 py-1.5 font-mono text-[10px] text-dim">
        <LlmBadge llm={a.llm} />
        <span className="ml-auto tabular">{dur != null ? `${dur.toFixed(1)}s` : '—'}</span>
      </footer>
    </motion.article>
  )
}

export function AgentGrid({ run }: { run: RunState }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="label text-amber">Stage 1 · Analysts</span>
        <span className="font-mono text-[10px] text-dim">run in parallel (LangGraph fan-out)</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <AgentCard k="market" run={run}>
          <MarketBody a={run.agents.market} />
        </AgentCard>
        <AgentCard k="news" run={run}>
          <NewsBody a={run.agents.news} />
        </AgentCard>
        <AgentCard k="fundamentals" run={run}>
          <FundamentalsBody a={run.agents.fundamentals} />
        </AgentCard>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="label text-amber">Stage 2 · Debate, reflection, decision</span>
        <span className="font-mono text-[10px] text-dim">evidence-only arguments · risk review · strict JSON verdict</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AgentCard k="bull" run={run}>
          <DebaterBody a={run.agents.bull} side="bull" run={run} />
        </AgentCard>
        <AgentCard k="bear" run={run}>
          <DebaterBody a={run.agents.bear} side="bear" run={run} />
        </AgentCard>
        <AgentCard k="risk" run={run}>
          <RiskBody a={run.agents.risk} />
        </AgentCard>
        <AgentCard k="pm" run={run}>
          <PMBody a={run.agents.pm} />
        </AgentCard>
      </div>
    </div>
  )
}
