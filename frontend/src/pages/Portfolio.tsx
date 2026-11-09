import { LineChart as LineIcon, RotateCcw, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useToast } from '../components/Toasts'
import { Empty, Panel, Stat } from '../components/ui'
import { getJSON, postJSON } from '../lib/api'
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-[15px] tracking-[0.2em] text-amber uppercase">Paper portfolio</h1>
        <span className="text-[12px] text-dim">Virtual ₹1,00,000 · trades placed by the Portfolio Manager at the latest close · no shorting</span>
        <div className="ml-auto flex items-center gap-2">
          {confirmReset ? (
            <>
              <span className="text-[12px] text-warn">Delete all paper trades?</span>
              <button onClick={reset} className="rounded border border-down/60 px-3 py-1.5 font-mono text-[11px] text-down uppercase hover:bg-down/10">
                Yes, reset
              </button>
              <button onClick={() => setConfirmReset(false)} className="rounded border border-line px-3 py-1.5 font-mono text-[11px] text-muted uppercase hover:bg-ink-800">
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 font-mono text-[11px] text-muted uppercase hover:bg-ink-800 hover:text-fg"
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="panel grid grid-cols-2 gap-4 p-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total value" value={rupee(snap?.total_value)} />
        <Stat label="Cash" value={rupee(snap?.cash)} />
        <Stat label="Invested" value={rupee(snap?.invested)} />
        <Stat label="Total P&L" value={rupee(snap?.pnl)} valueClass={tone(snap?.pnl)} sub={pct(snap?.pnl_pct)} />
        <Stat label="Realised P&L" value={rupee(snap?.realised_pnl)} valueClass={tone(snap?.realised_pnl)} />
        <Stat label="Trades" value={snap?.trade_count ?? '—'} sub={`${snap?.holdings.length ?? 0} open positions`} />
      </div>

      <Panel
        title="Portfolio vs Nifty 50 · normalised to 100"
        icon={<LineIcon size={13} />}
        right={
          lastPoint ? (
            <span className="font-mono text-[11px]">
              <span className="text-amber">QUORUM {num(lastPoint.portfolio)}</span>
              <span className="ml-3 text-info">NIFTY {num(lastPoint.nifty)}</span>
            </span>
          ) : null
        }
        bodyClass="p-3"
      >
        <div className="h-[300px]">
          {series.length === 0 ? (
            <Empty>{loading ? 'Loading…' : history?.message ?? 'No trades yet.'}</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#141a21" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#6f7a88', fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickLine={false} axisLine={{ stroke: '#1c242e' }} minTickGap={32} />
                <YAxis
                  domain={[(min: number) => Math.floor(Math.min(min, 100) - 1), (max: number) => Math.ceil(Math.max(max, 100) + 1)]}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  tick={{ fill: '#6f7a88', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <ReferenceLine y={100} stroke="#2a3542" strokeDasharray="4 4" />
                <Tooltip
                  contentStyle={{ background: '#0e131a', border: '1px solid #2a3542', borderRadius: 6, fontFamily: 'IBM Plex Mono', fontSize: 11 }}
                  labelStyle={{ color: '#8b96a4' }}
                  formatter={(v, name) => [num(Number(v)), name === 'portfolio' ? 'QUORUM portfolio' : 'Nifty 50']}
                />
                <Legend wrapperStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 11 }} formatter={(v) => (v === 'portfolio' ? 'QUORUM portfolio' : 'Nifty 50 (^NSEI)')} />
                <Line type="monotone" dataKey="portfolio" stroke="#ffb224" strokeWidth={2} dot={series.length < 3} isAnimationActive />
                <Line type="monotone" dataKey="nifty" stroke="#4cc2ff" strokeWidth={1.6} dot={series.length < 3} isAnimationActive />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        {history?.message && series.length > 0 && <p className="mt-2 text-[11px] text-dim">{history.message}</p>}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Holdings" icon={<Wallet size={13} />} bodyClass="overflow-x-auto">
          {!snap?.holdings.length ? (
            <Empty>No open positions.</Empty>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="label border-b border-line text-left">
                  {['Ticker', 'Qty', 'Avg cost', 'Last', 'Value', 'Unrealised', 'Weight'].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {snap.holdings.map((h) => (
                  <tr key={h.ticker} className="border-b border-line/60">
                    <td className="px-3 py-2 text-fg">{h.ticker}</td>
                    <td className="px-3 py-2">{h.qty}</td>
                    <td className="px-3 py-2">{rupee(h.avg_cost)}</td>
                    <td className="px-3 py-2">{rupee(h.last_price)}</td>
                    <td className="px-3 py-2">{rupee(h.market_value)}</td>
                    <td className={`px-3 py-2 ${tone(h.unrealised_pnl)}`}>
                      {rupee(h.unrealised_pnl)} <span className="text-[10px]">({pct(h.unrealised_pct)})</span>
                    </td>
                    <td className="px-3 py-2">{num(h.weight_pct, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Recent decisions (agent memory)" bodyClass="overflow-x-auto">
          {!runs.length ? (
            <Empty>Every live analysis is stored and fed back to the Portfolio Manager as memory.</Empty>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="label border-b border-line text-left">
                  {['When', 'Ticker', 'Decision', 'Conf', 'Size', 'Price', 'LLM'].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="px-3 py-2 text-muted">{fmtDateTime(r.ts)}</td>
                    <td className="px-3 py-2 text-fg">{r.ticker}</td>
                    <td className={`px-3 py-2 ${r.decision === 'BUY' ? 'text-up' : r.decision === 'SELL' ? 'text-down' : 'text-amber'}`}>{r.decision}</td>
                    <td className="px-3 py-2">{r.confidence}</td>
                    <td className="px-3 py-2">{num(r.position_size_pct, 1)}%</td>
                    <td className="px-3 py-2">{rupee(r.price)}</td>
                    <td className="px-3 py-2 text-dim">{r.llm_mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <Panel title="Trade history" bodyClass="overflow-x-auto">
        {!trades.length ? (
          <Empty>No paper trades yet. Run an analysis on the Trading Floor.</Empty>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="label border-b border-line text-left">
                {['#', 'Market date', 'Placed', 'Ticker', 'Side', 'Qty', 'Price', 'Value', 'Conf', 'Note'].map((h) => (
                  <th key={h} className="px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-line/60">
                  <td className="px-3 py-2 text-dim">{t.id}</td>
                  <td className="px-3 py-2">{fmtDate(t.trade_date)}</td>
                  <td className="px-3 py-2 text-muted">{fmtDateTime(t.ts)}</td>
                  <td className="px-3 py-2 text-fg">{t.ticker}</td>
                  <td className={`px-3 py-2 ${t.side === 'BUY' ? 'text-up' : 'text-down'}`}>{t.side}</td>
                  <td className="px-3 py-2">{t.qty}</td>
                  <td className="px-3 py-2">{rupee(t.price)}</td>
                  <td className="px-3 py-2">{rupee(t.value)}</td>
                  <td className="px-3 py-2">{t.confidence ?? '—'}</td>
                  <td className="px-3 py-2 font-sans text-muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
