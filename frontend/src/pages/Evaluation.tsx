import { CircleCheck, FlaskConical, LoaderCircle, Play, Square, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useToast } from '../components/Toasts'
import { Chip, Empty, LlmBadge, Magnetic, Panel, RoyalButton } from '../components/ui'
import { CHART } from '../lib/chartTheme'
import { getJSON, streamSSE } from '../lib/api'
import { fmtDate, fmtDateTime, num, pct, tone } from '../lib/format'
import type { Decision, EvalConfig, EvalResults, EvalRow, StrategyResult } from '../types'

const STRAT_COLOR: Record<string, string> = {
  agent: '#dcb76c',
  buy_hold: '#8aaeff',
  rsi_rule: '#c7a2ff',
  random: '#6f6891',
}

interface Progress {
  stage: 'queued' | 'data' | 'agents' | 'done'
  agentsDone: number
  row?: EvalRow
}

const decCls = (d?: Decision | null) => (d === 'BUY' ? 'text-up' : d === 'SELL' ? 'text-down' : d === 'HOLD' ? 'text-gold' : 'text-dim')

function hit(d: Decision | null | undefined, r: number | null, band: number) {
  if (!d || r == null) return null
  if (d === 'BUY') return r > 0
  if (d === 'SELL') return r < 0
  return Math.abs(r) <= band
}

export function Evaluation() {
  const toast = useToast()
  const [cfg, setCfg] = useState<EvalConfig | null>(null)
  const [asOf, setAsOf] = useState('')
  const [horizon, setHorizon] = useState(10)
  const [withFund, setWithFund] = useState(false)
  const [results, setResults] = useState<EvalResults | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    getJSON<EvalResults | null>('/api/evaluation/latest')
      .then((r) => r && setResults(r))
      .catch(() => {})
  }, [])

  useEffect(() => {
    getJSON<EvalConfig>(`/api/evaluation/config?horizon=${horizon}`)
      .then((c) => {
        setCfg(c)
        setAsOf((cur) => {
          if (!cur) return c.default_as_of ?? ''
          if (c.max_as_of && cur > c.max_as_of) return c.max_as_of
          return cur
        })
      })
      .catch((e) => toast('error', (e as Error).message))
  }, [horizon, toast])

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async () => {
    if (!cfg || !asOf) return
    if (asOf <= cfg.knowledge_cutoff) {
      toast('error', `As-of date must be after the LLM knowledge cutoff (${cfg.knowledge_cutoff}).`)
      return
    }
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setRunning(true)
    setProgress(Object.fromEntries(cfg.tickers.map((t) => [t, { stage: 'queued', agentsDone: 0 } as Progress])))
    const url = `/api/evaluation/stream?as_of=${asOf}&horizon=${horizon}&include_fundamentals=${withFund}`
    try {
      await streamSSE(
        url,
        (ev) => {
          const tk = ev.ticker as string | undefined
          if (ev.type === 'eval_progress' && tk) {
            setProgress((p) => ({ ...p, [tk]: { ...p[tk], stage: ev.stage as Progress['stage'] } }))
          } else if (ev.type === 'eval_agent' && tk && ev.status === 'done') {
            setProgress((p) => ({ ...p, [tk]: { ...p[tk], agentsDone: (p[tk]?.agentsDone ?? 0) + 1 } }))
          } else if (ev.type === 'eval_row') {
            const row = ev.row as EvalRow
            setProgress((p) => ({ ...p, [row.ticker]: { ...p[row.ticker], stage: 'done', row } }))
          } else if (ev.type === 'eval_done') {
            setResults({ id: ev.id as number, ts: new Date().toISOString(), params: ev.params as EvalResults['params'], strategies: ev.strategies as StrategyResult[], rows: ev.rows as EvalRow[] })
            toast('success', 'Evaluation complete.')
          } else if (ev.type === 'error') {
            toast('error', String(ev.message))
          }
        },
        ctl.signal,
      )
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [cfg, asOf, horizon, withFund, toast])

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
    toast('info', 'Evaluation stopped.')
  }

  const band = (results?.params.hold_band_pct ?? cfg?.hold_band_pct ?? 2) / 100
  const strategies = results?.strategies ?? []
  const randomS = strategies.find((s) => s.key === 'random')

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <div className="eyebrow">The audit</div>
        <h1 className="title-serif text-[40px] leading-tight md:text-[46px]">
          Honest <span className="gold-text italic">evaluation</span>
        </h1>
        <p className="mt-1 text-[13px] text-dim">The council's decisions against simple baselines on forward returns, with no look-ahead.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
        <Panel eyebrow="Look-ahead bias" title="Why the date must follow the knowledge cutoff" icon={<TriangleAlert size={14} />} bodyClass="p-5 space-y-3 text-[13px] leading-relaxed text-fg/85">
          <p>
            A language model is trained on text up to its <span className="text-gold">knowledge cutoff</span>. If we asked it to judge INFY "as of" a date
            before that cutoff, it may already have read what happened next — earnings surprises, crashes, rallies. That is{' '}
            <span className="text-warn">look-ahead bias</span>, and it makes back-tests look far better than reality.
          </p>
          <p>
            So QUORUM only evaluates dates after <span className="tabular rounded-md border border-gold/25 bg-gold/[0.07] px-1.5 text-gold">LLM_KNOWLEDGE_CUTOFF = {cfg?.knowledge_cutoff ?? '…'}</span>. Prices,
            indicators and news are all truncated at the as-of date (Google News <span className="font-mono">before:</span> operator). Company
            fundamentals are a <em>current</em> snapshot, not point-in-time, so they are excluded by default.
          </p>
          <p className="text-muted">
            Hit rule: BUY is right if the forward return is &gt; 0, SELL if &lt; 0, HOLD if it stays within ±{num(band * 100, 1)}%. Strategy return: BUY earns
            the move, SELL earns its inverse (a short), HOLD earns 0.
          </p>
        </Panel>

        <Panel eyebrow="Ten stocks · one window" title="Run the evaluation" icon={<FlaskConical size={14} />} bodyClass="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="label block">As-of date</span>
              <input
                type="date"
                value={asOf}
                min={cfg?.min_as_of}
                max={cfg?.max_as_of ?? undefined}
                onChange={(e) => setAsOf(e.target.value)}
                disabled={running}
                className="w-full rounded-xl border border-line-strong bg-ink-950/60 px-3 py-2.5 font-mono text-[13px] text-fg [color-scheme:dark] outline-none transition focus:border-gold/60 focus:shadow-[0_0_0_4px_rgba(220,183,108,0.08)]"
              />
            </label>
            <label className="space-y-1">
              <span className="label block">Horizon (trading days)</span>
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                disabled={running}
                className="w-full rounded-xl border border-line-strong bg-ink-950/60 px-3 py-2.5 font-mono text-[13px] text-fg outline-none transition focus:border-gold/60 focus:shadow-[0_0_0_4px_rgba(220,183,108,0.08)]"
              >
                {[5, 10, 20].map((h) => (
                  <option key={h} value={h}>
                    {h} days
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={withFund} onChange={(e) => setWithFund(e.target.checked)} disabled={running} className="mt-0.5 h-4 w-4 accent-[#dcb76c]" />
            <span>Include fundamentals (not point-in-time — introduces mild look-ahead; off = strict)</span>
          </label>
          <p className="text-[11.5px] leading-relaxed text-dim">
            {cfg ? `${cfg.tickers.length} tickers · ${cfg.debate_rounds} debate round(s) per ticker · valid range ${cfg.min_as_of} → ${cfg.max_as_of}` : 'loading…'}
          </p>
          <div className="flex items-center gap-2">
            {running ? (
              <Magnetic>
                <button onClick={stop} className="btn-session px-5 py-3 text-[12.5px] font-bold">
                  <LoaderCircle size={15} className="animate-spin text-down" /> Evaluating · stop <Square size={10} className="fill-current text-down" />
                </button>
              </Magnetic>
            ) : (
              <RoyalButton onClick={run} disabled={!cfg || !asOf} className="py-1.5 pr-6 pl-1.5 text-[12.5px]">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-950/90 text-gold">
                  <Play size={13} className="fill-current" />
                </span>
                RUN EVALUATION
              </RoyalButton>
            )}
            {cfg && <LlmBadge llm={cfg.llm.state === 'online' ? 'gemini' : 'offline'} />}
          </div>
          {cfg && cfg.llm.state !== 'online' && (
            <p className="text-[11px] text-warn">Gemini is offline, so the rule-based offline engine will make the "agent" decisions.</p>
          )}
        </Panel>
      </div>

      {Object.keys(progress).length > 0 && running && (
        <Panel eyebrow="In session" title="Progress" bodyClass="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(progress).map(([t, p]) => (
              <div key={t} className={`relative rounded-2xl border px-3.5 py-3 transition-colors duration-500 ${p.stage === 'agents' ? 'aura border-gold/30 bg-gold/[0.04]' : p.stage === 'done' ? 'border-up/25 bg-up/[0.03]' : 'border-line'}`}>
                <div className="flex items-center justify-between font-mono text-[12px]">
                  <span className="text-fg">{t}</span>
                  {p.stage === 'done' ? <CircleCheck size={13} className="text-up" /> : p.stage === 'queued' ? <span className="text-dim">·</span> : <LoaderCircle size={13} className="animate-spin text-gold" />}
                </div>
                <div className="mt-1 text-[11px] text-dim">
                  {p.stage === 'done'
                    ? p.row?.agent
                      ? <span className={decCls(p.row.agent)}>{p.row.agent} · fwd {pct((p.row.fwd_return ?? 0) * 100)}</span>
                      : p.row?.note ?? 'skipped'
                    : p.stage === 'agents'
                      ? `agents done: ${p.agentsDone}`
                      : p.stage}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!results ? (
        <Panel eyebrow="Results" title="No evaluation yet">
          <Empty>No evaluation yet. Choose an as-of date after the cutoff and run it.</Empty>
        </Panel>
      ) : (
        <>
          <div
            className="rise relative overflow-hidden rounded-2xl border border-warn/30 bg-gradient-to-r from-warn/[0.1] to-warn/[0.02] px-6 py-4 text-[13.5px] leading-relaxed text-fg/90"
          >
            <span className="absolute inset-y-0 left-0 w-[3px] bg-warn shadow-[0_0_16px] shadow-warn" />
            <span className="text-[10.5px] font-bold tracking-[0.18em] text-warn uppercase">Read this first · </span>
            With ~10 decisions over a single short window, these numbers are dominated by noise: a random strategy lands anywhere between{' '}
            <span className="tabular text-warn">
              {num(randomS?.hit_rate_p5, 0)}% and {num(randomS?.hit_rate_p95, 0)}%
            </span>{' '}
            hit rate (90% band). Expect QUORUM to be <strong>near-random</strong>. The value of this system is <strong>explainability</strong> — every
            decision comes with cited evidence, a visible debate and a risk review — <strong>not prediction</strong>.
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel
              title="Strategy comparison"
              right={
                <span className="font-mono text-[10px] text-dim">
                  as of {fmtDate(results.params.as_of)} · {results.params.horizon}d horizon · {results.ts ? `run ${fmtDateTime(results.ts)}` : ''}
                </span>
              }
              bodyClass="overflow-x-auto"
            >
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="label border-b border-line text-left">
                    {['Strategy', 'N', 'Hit rate', 'Avg return', 'Decisions (B/H/S)'].map((h) => (
                      <th key={h} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {strategies.map((s) => (
                    <tr key={s.key} className="row-hover border-b border-line/50">
                      <td className="px-4 py-3">
                        <span className="mr-2.5 inline-block h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: STRAT_COLOR[s.key], boxShadow: `0 0 8px ${STRAT_COLOR[s.key]}` }} />
                        <span className={`font-sans font-semibold ${s.key === 'agent' ? 'text-gold' : 'text-fg'}`}>{s.name}</span>
                      </td>
                      <td className="px-4 py-3">{s.n}</td>
                      <td className="px-4 py-3">
                        {s.hit_rate == null ? '—' : `${num(s.hit_rate, 1)}%`}
                        {s.key === 'random' && s.hit_rate_p5 != null && (
                          <span className="ml-1 text-[10px] text-dim">
                            ({num(s.hit_rate_p5, 0)}–{num(s.hit_rate_p95, 0)})
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${tone(s.avg_return_pct)}`}>{pct(s.avg_return_pct)}</td>
                      <td className="px-4 py-3 text-muted">{s.counts ? `${s.counts.BUY} / ${s.counts.HOLD} / ${s.counts.SELL}` : 'uniform'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11.5px] text-dim">
                <span>LLM: {results.params.llm.state === 'online' ? results.params.llm.model : 'offline engine'}</span>
                <span>· debate rounds {results.params.debate_rounds}</span>
                <span>· fundamentals {results.params.include_fundamentals ? 'included' : 'excluded (strict)'}</span>
                <span>· cutoff {results.params.knowledge_cutoff}</span>
              </div>
            </Panel>

            <Panel eyebrow="At a glance" title="Hit rate & average return" bodyClass="p-4">
              <div className="grid h-[270px] grid-cols-2 gap-3">
                <MetricChart data={strategies} metric="hit_rate" label="Hit rate %" band={randomS} />
                <MetricChart data={strategies} metric="avg_return_pct" label="Avg return %" />
              </div>
            </Panel>
          </div>

          <Panel eyebrow="Case by case" title="Per-ticker decisions" bodyClass="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="label border-b border-line text-left">
                  {['Ticker', 'As of', 'Exit', 'Entry → exit', 'Fwd return', 'QUORUM', 'Conf', 'RSI', 'RSI rule', 'LLM', 'Note'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {results.rows.map((r) => {
                  const h = hit(r.agent, r.fwd_return, band)
                  return (
                    <tr key={r.ticker} className="row-hover border-b border-line/50">
                      <td className="px-4 py-3 text-fg">{r.ticker}</td>
                      <td className="px-4 py-3 text-muted">{r.as_of ?? '—'}</td>
                      <td className="px-4 py-3 text-muted">{r.exit_date ?? '—'}</td>
                      <td className="px-4 py-3 text-muted">{r.entry != null ? `${num(r.entry)} → ${num(r.exit)}` : '—'}</td>
                      <td className={`px-4 py-3 ${tone(r.fwd_return)}`}>{r.fwd_return == null ? '—' : pct(r.fwd_return * 100)}</td>
                      <td className={`px-4 py-3 ${decCls(r.agent)}`}>
                        {r.agent ?? '—'} {h != null && <span className={h ? 'text-up' : 'text-down'}>{h ? '✓' : '✗'}</span>}
                      </td>
                      <td className="px-4 py-3">{r.confidence ?? '—'}</td>
                      <td className="px-4 py-3">{num(r.rsi, 1)}</td>
                      <td className={`px-4 py-3 ${decCls(r.rsi_rule)}`}>{r.rsi_rule ?? '—'}</td>
                      <td className="px-4 py-3">{r.llm_mode ? <Chip className="border-line text-dim">{r.llm_mode}</Chip> : '—'}</td>
                      <td className="px-4 py-3 font-sans text-[11px] text-dim">{r.note ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  )
}

function MetricChart({
  data,
  metric,
  label,
  band,
}: {
  data: StrategyResult[]
  metric: 'hit_rate' | 'avg_return_pct'
  label: string
  band?: StrategyResult
}) {
  const rows = data.map((s) => ({ key: s.key, name: s.key === 'agent' ? 'QUORUM' : s.key === 'buy_hold' ? 'B&H' : s.key === 'rsi_rule' ? 'RSI' : 'Random', value: s[metric] ?? 0 }))
  return (
    <div className="flex min-h-0 flex-col">
      <div className="eyebrow mb-2 text-center">{label}</div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              {Object.entries(STRAT_COLOR).map(([k, c]) => (
                <linearGradient key={k} id={`bar-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={c} stopOpacity={1} />
                  <stop offset="1" stopColor={c} stopOpacity={0.35} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ ...CHART.tick, fill: '#aca4c4' }} tickLine={false} axisLine={{ stroke: CHART.axis }} />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} />
            {band?.hit_rate_p5 != null && band.hit_rate_p95 != null && (
              <ReferenceArea y1={band.hit_rate_p5} y2={band.hit_rate_p95} fill="#c7a2ff" fillOpacity={0.08} stroke="rgba(199,162,255,0.25)" strokeDasharray="3 3" />
            )}
            <ReferenceLine y={0} stroke="#3a3160" />
            <Tooltip
              cursor={{ fill: 'rgba(220,183,108,0.05)' }}
              contentStyle={CHART.tooltip}
              formatter={(v) => [`${num(Number(v), metric === 'hit_rate' ? 1 : 2)}%`, label]}
            />
            <Bar dataKey="value" radius={[8, 8, 2, 2]} isAnimationActive animationDuration={900}>
              {rows.map((r) => (
                <Cell key={r.key} fill={`url(#bar-${r.key})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
