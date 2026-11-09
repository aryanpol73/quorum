import { CandlestickChart } from 'lucide-react'
import { AgentGrid } from '../components/AgentCards'
import { AgentTrace } from '../components/AgentTrace'
import { EvidenceProvider } from '../components/Citations'
import { DebatePanel, EvidenceLedger } from '../components/DebatePanel'
import { PriceChart } from '../components/PriceChart'
import { TickerSearch } from '../components/TickerSearch'
import { AnimatedNumber, Chip, Empty } from '../components/ui'
import { VerdictPanel } from '../components/VerdictPanel'
import { num, pct, rupee, tone } from '../lib/format'
import type { ChartData, RunState } from '../types'

interface Props {
  run: RunState
  chart: ChartData | null
  chartLoading: boolean
  onRun: (symbol: string) => void
  onPreview: (symbol: string) => void
  onStop: () => void
}

function ChartHeader({ chart }: { chart: ChartData | null }) {
  if (!chart) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full border border-gold/25 bg-gold/[0.06] text-gold">
          <CandlestickChart size={14} />
        </span>
        <div className="leading-tight">
          <div className="eyebrow">Market</div>
          <div className="title-serif text-[19px]">Price chart</div>
        </div>
      </div>
    )
  }
  const ind = chart.indicators
  const up = (ind.change_pct ?? 0) >= 0
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
      <div className="leading-tight">
        <div className="flex items-center gap-2">
          <span className="eyebrow">NSE · {chart.ticker}</span>
          {chart.source === 'demo' && <Chip className="border-violet/40 bg-violet/10 text-violet">cached demo data</Chip>}
        </div>
        <div className="title-serif mt-0.5 text-[28px] leading-none">{chart.company}</div>
      </div>
      <AnimatedNumber value={ind.last_close} format={(v) => rupee(v)} className="tabular text-[26px] leading-none text-fg" />
      <span
        className={`tabular rounded-full border px-2.5 py-0.5 text-[12.5px] ${up ? 'border-up/35 bg-up/10 text-up' : 'border-down/35 bg-down/10 text-down'}`}
      >
        {up ? '▲' : '▼'} {pct(ind.change_pct)}
      </span>
      <span className="pb-0.5 font-mono text-[11px] text-dim">
        {chart.yahoo} · {ind.as_of}
      </span>
    </div>
  )
}

function IndicatorStrip({ chart }: { chart: ChartData }) {
  const i = chart.indicators
  const cells: [string, string, string][] = [
    ['RSI 14', num(i.rsi14, 1), i.rsi14 != null && i.rsi14 >= 70 ? 'text-down' : i.rsi14 != null && i.rsi14 <= 30 ? 'text-up' : 'text-fg'],
    ['SMA 20', num(i.sma20), 'text-gold'],
    ['SMA 50', num(i.sma50), 'text-info'],
    ['MACD hist', num(i.macd_hist), tone(i.macd_hist)],
    ['Vol / 20d', `${num(i.volume_spike_ratio)}×`, 'text-fg'],
    ['vs 52w high', pct(i.pct_from_52w_high, 1), tone(i.pct_from_52w_high)],
    ['vs 52w low', pct(i.pct_from_52w_low, 1), tone(i.pct_from_52w_low)],
    ['Volatility', `${num(i.volatility_ann_pct, 1)}%`, 'text-fg'],
  ]
  return (
    <div className="grid grid-cols-4 gap-px overflow-hidden rounded-b-[20px] border-t border-gold/10 bg-gold/[0.06] md:grid-cols-8">
      {cells.map(([k, v, c], idx) => (
        <div key={k} className="rise bg-ink-900/95 px-4 py-3" style={{ animationDelay: `${idx * 50}ms` }}>
          <div className="label">{k}</div>
          <div className={`tabular mt-1 text-[15px] ${c}`}>{v}</div>
        </div>
      ))}
    </div>
  )
}

export function TradingFloor({ run, chart, chartLoading, onRun, onPreview, onStop }: Props) {
  return (
    <EvidenceProvider ledger={run.ledger}>
      <div className="space-y-6">
        <div className="rise space-y-1.5 pt-2">
          <div className="eyebrow">Trading floor</div>
          <h1 className="title-serif text-[40px] leading-[1.05] md:text-[46px]">
            Convene the council, <span className="gold-text italic">hear the debate</span>, receive the decree.
          </h1>
        </div>

        <TickerSearch running={run.status === 'running'} onSubmit={onRun} onPreview={onPreview} onStop={onStop} initial={run.ticker ?? ''} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section className="panel rise flex min-w-0 flex-col">
            <header className="panel-head flex-wrap">
              <ChartHeader chart={chart} />
              <span className="ml-auto hidden items-center gap-3 text-[11px] text-dim md:flex">
                <span className="flex items-center gap-1.5">
                  <span className="h-[2px] w-4 rounded bg-gold" /> SMA 20
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[2px] w-4 rounded bg-info" /> SMA 50
                </span>
                <span>6 months · daily</span>
              </span>
            </header>
            <div className="h-[400px] px-3 pt-2">
              {chart ? (
                <PriceChart data={chart} verdict={run.verdict?.decision} />
              ) : (
                <Empty icon={<CandlestickChart size={26} />}>
                  {chartLoading ? 'Loading price history…' : 'Choose a stock to load six months of daily candles with SMA 20/50 overlays and volume.'}
                </Empty>
              )}
            </div>
            {chart && <IndicatorStrip chart={chart} />}
          </section>
          <VerdictPanel run={run} />
        </div>

        <AgentGrid run={run} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <DebatePanel run={run} />
          <EvidenceLedger ledger={run.ledger} />
        </div>

        <AgentTrace run={run} />
      </div>
    </EvidenceProvider>
  )
}
