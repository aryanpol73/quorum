import { motion } from 'framer-motion'
import { History, LineChart as LineIcon, RotateCcw, ScrollText, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useToast } from '../components/Toasts'
import { AnimatedNumber, Empty, Panel } from '../components/ui'
import { getJSON, postJSON } from '../lib/api'
import { CHART } from '../lib/chartTheme'
import { fmtDate, fmtDateTime, num, pct, rupee, tone } from '../lib/format'
import type { HistoryPoint, PortfolioSnapshot, TradeRecord } from '../types'

interface RunRow {
  id: string
  ts: string
  ticker: string
  decision: string | null
  confidence: number | null
  position_size_pct: number | null
  price: number | null
  llm_mode: string
}

function StatTile({ label, children, sub, index, accent }: { label: string; children: ReactNode; sub?: ReactNode; index: number; accent?: string }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="panel rise relative overflow-hidden px-5 py-4"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {accent && <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />}
      <div className="label">{label}</div>
      <div className="tabular mt-1.5 truncate text-[22px] text-fg">{children}</div>
      {sub != null && <div className="tabular mt-0.5 truncate text-[12px] text-muted">{sub}</div>}
    </motion.div>
  )
}

const TH = ({ children }: { children: ReactNode }) => <th className="label px-4 py-3 text-left font-semibold">{children}</th>

export function Portfolio() {
  const toast = useToast()
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null)
  const [history, setHistory] = useState<{ series: HistoryPoint[]; message?: string | null } | null>(null)
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, h, t, r] = await Promise.all([
        getJSON<PortfolioSnapshot>('/api/portfolio'),
        getJSON<{ series: HistoryPoint[]; message?: string | null }>('/api/portfolio/history'),
        getJSON<TradeRecord[]>('/api/trades'),
        getJSON<RunRow[]>('/api/runs?limit=15'),
      ])
      setSnap(s)
      setHistory(h)
      setTrades(t)
      setRuns(r)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const reset = async () => {
    try {
      await postJSON('/api/portfolio/reset')
      toast('info', 'Portfolio reset to ₹1,00,000 cash.')
      setConfirmReset(false)
      load()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  const series = history?.series ?? []
  const lastPoint = series[series.length - 1]
  const money = (v: number) => rupee(v)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 pt-2">
        <div>
          <div className="eyebrow">The treasury</div>
          <h1 className="title-serif text-[40px] leading-tight md:text-[46px]">
            Paper <span className="gold-text italic">portfolio</span>
          </h1>
          <p className="mt-1 text-[13px] text-dim">A virtual ₹1,00,000. The Portfolio Manager trades at the latest close, and short selling is disabled.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {confirmReset ? (
            <>
              <span className="text-[12.5px] text-warn">Delete every paper trade?</span>
              <button onClick={reset} className="btn-session px-4 py-2 text-[12px] font-bold">
                Yes, reset
              </button>
              <button onClick={() => setConfirmReset(false)} className="btn-ghost px-4 py-2 text-[12px] font-semibold">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="btn-ghost px-4 py-2 text-[12px] font-semibold">
              <RotateCcw size={13} /> Reset portfolio
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total value" index={0} accent="var(--color-gold)">
          <AnimatedNumber value={snap?.total_value} format={money} />
        </StatTile>
        <StatTile label="Cash" index={1}>
          <AnimatedNumber value={snap?.cash} format={money} />
        </StatTile>
        <StatTile label="Invested" index={2}>
          <AnimatedNumber value={snap?.invested} format={money} />
        </StatTile>
        <StatTile label="Total P&L" index={3} sub={<span className={tone(snap?.pnl_pct)}>{pct(snap?.pnl_pct)}</span>} accent={snap && snap.pnl < 0 ? 'var(--color-down)' : 'var(--color-up)'}>
          <span className={tone(snap?.pnl)}>
            <AnimatedNumber value={snap?.pnl} format={money} />
          </span>
        </StatTile>
        <StatTile label="Realised P&L" index={4}>
          <span className={tone(snap?.realised_pnl)}>
            <AnimatedNumber value={snap?.realised_pnl} format={money} />
          </span>
        </StatTile>
        <StatTile label="Trades" index={5} sub={`${snap?.holdings.length ?? 0} open position${snap?.holdings.length === 1 ? '' : 's'}`}>
          {snap?.trade_count ?? '—'}
        </StatTile>
      </div>

      <Panel
        eyebrow="Performance"
        title="Portfolio vs Nifty 50 · rebased to 100"
        icon={<LineIcon size={14} />}
        right={
          lastPoint ? (
            <span className="tabular flex gap-4 text-[12px]">
              <span className="text-gold">QUORUM {num(lastPoint.portfolio)}</span>
              <span className="text-info">NIFTY {num(lastPoint.nifty)}</span>
            </span>
          ) : null
        }
        bodyClass="p-4"
      >
        <div className="h-[320px]">
          {series.length === 0 ? (
            <Empty icon={<LineIcon size={24} />}>{loading ? 'Loading…' : history?.message ?? 'No trades yet.'}</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#dcb76c" stopOpacity={0.35} />
                    <stop offset="1" stopColor="#dcb76c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axis }} minTickGap={32} />
                <YAxis
                  domain={[(min: number) => Math.floor(Math.min(min, 100) - 1), (max: number) => Math.ceil(Math.max(max, 100) + 1)]}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  tick={CHART.tick}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ReferenceLine y={100} stroke="#3a3160" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={CHART.tooltip}
                  labelStyle={{ color: '#aca4c4' }}
                  cursor={{ stroke: 'rgba(220,183,108,0.35)' }}
                  formatter={(v, name) => [num(Number(v)), name === 'portfolio' ? 'QUORUM portfolio' : 'Nifty 50']}
                />
                <Legend wrapperStyle={{ fontFamily: 'Manrope', fontSize: 12 }} formatter={(v) => (v === 'portfolio' ? 'QUORUM portfolio' : 'Nifty 50 (^NSEI)')} />
                <Area type="monotone" dataKey="portfolio" stroke="#dcb76c" strokeWidth={2.4} fill="url(#pf-fill)" dot={series.length < 3} isAnimationActive />
                <Line type="monotone" dataKey="nifty" stroke="#8aaeff" strokeWidth={1.8} dot={series.length < 3} isAnimationActive />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {history?.message && series.length > 0 && <p className="mt-2 text-[12px] text-dim">{history.message}</p>}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel eyebrow="Positions" title="Holdings" icon={<Wallet size={14} />} bodyClass="overflow-x-auto">
          {!snap?.holdings.length ? (
            <Empty>No open positions.</Empty>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line">
                  {['Ticker', 'Qty', 'Avg cost', 'Last', 'Value', 'Unrealised', 'Weight'].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {snap.holdings.map((h) => (
                  <tr key={h.ticker} className="row-hover border-b border-line/50">
                    <td className="px-4 py-3 font-sans font-semibold text-fg">{h.ticker}</td>
                    <td className="px-4 py-3">{h.qty}</td>
                    <td className="px-4 py-3">{rupee(h.avg_cost)}</td>
                    <td className="px-4 py-3">{rupee(h.last_price)}</td>
                    <td className="px-4 py-3">{rupee(h.market_value)}</td>
                    <td className={`px-4 py-3 ${tone(h.unrealised_pnl)}`}>
                      {rupee(h.unrealised_pnl)} <span className="text-[10.5px]">({pct(h.unrealised_pct)})</span>
                    </td>
                    <td className="px-4 py-3">{num(h.weight_pct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel eyebrow="Agent memory" title="Recent decisions" icon={<History size={14} />} bodyClass="overflow-x-auto">
          {!runs.length ? (
            <Empty>Every live analysis is stored and shown to the Portfolio Manager as memory.</Empty>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line">
                  {['When', 'Ticker', 'Decision', 'Conf', 'Size', 'Price', 'LLM'].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {runs.map((r) => (
                  <tr key={r.id} className="row-hover border-b border-line/50">
                    <td className="px-4 py-3 text-muted">{fmtDateTime(r.ts)}</td>
                    <td className="px-4 py-3 font-sans font-semibold text-fg">{r.ticker}</td>
                    <td className={`px-4 py-3 font-serif text-[15px] font-bold ${r.decision === 'BUY' ? 'text-up' : r.decision === 'SELL' ? 'text-down' : 'text-gold'}`}>
                      {r.decision}
                    </td>
                    <td className="px-4 py-3">{r.confidence}</td>
                    <td className="px-4 py-3">{num(r.position_size_pct, 1)}%</td>
                    <td className="px-4 py-3">{rupee(r.price)}</td>
                    <td className="px-4 py-3 text-dim">{r.llm_mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel eyebrow="The ledger of orders" title="Trade history" icon={<ScrollText size={14} />} bodyClass="overflow-x-auto">
        {!trades.length ? (
          <Empty>No paper trades yet. Convene the council on the Trading Floor.</Empty>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                {['#', 'Market date', 'Placed', 'Ticker', 'Side', 'Qty', 'Price', 'Value', 'Conf', 'Note'].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {trades.map((t) => (
                <tr key={t.id} className="row-hover border-b border-line/50">
                  <td className="px-4 py-3 text-dim">{t.id}</td>
                  <td className="px-4 py-3">{fmtDate(t.trade_date)}</td>
                  <td className="px-4 py-3 text-muted">{fmtDateTime(t.ts)}</td>
                  <td className="px-4 py-3 font-sans font-semibold text-fg">{t.ticker}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${t.side === 'BUY' ? 'border-up/35 bg-up/10 text-up' : 'border-down/35 bg-down/10 text-down'}`}>
                      {t.side}
                    </span>
                  </td>
                  <td className="px-4 py-3">{t.qty}</td>
                  <td className="px-4 py-3">{rupee(t.price)}</td>
                  <td className="px-4 py-3">{rupee(t.value)}</td>
                  <td className="px-4 py-3">{t.confidence ?? '—'}</td>
                  <td className="px-4 py-3 font-sans text-muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
