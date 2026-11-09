import { CandlestickChart } from 'lucide-react'
import { AgentGrid } from '../components/AgentCards'
import { AgentTrace } from '../components/AgentTrace'
import { EvidenceProvider } from '../components/Citations'
import { DebatePanel, EvidenceLedger } from '../components/DebatePanel'
import { PriceChart } from '../components/PriceChart'
import { TickerSearch } from '../components/TickerSearch'
import { Chip, Empty, Panel } from '../components/ui'
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

function QuoteHeader({ chart }: { chart: ChartData }) {
  const ind = chart.indicators
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-mono text-[18px] font-semibold tracking-wider text-fg">{chart.ticker}</span>
      <span className="text-[12px] text-muted">{chart.company}</span>
      <span className="tabular text-[18px] text-fg">{rupee(ind.last_close)}</span>
      <span className={`tabular text-[13px] ${tone(ind.change_pct)}`}>{pct(ind.change_pct)}</span>
      <span className="font-mono text-[10px] text-dim">
        {chart.yahoo} · {ind.as_of}
      </span>
      {chart.source === 'demo' && <Chip className="border-violet/50 text-violet">cached demo data</Chip>}
    </div>
  )
}

function IndicatorStrip({ chart }: { chart: ChartData }) {
  const i = chart.indicators
  const cells: [string, string, string][] = [
    ['RSI(14)', num(i.rsi14, 1), i.rsi14 != null && i.rsi14 >= 70 ? 'text-down' : i.rsi14 != null && i.rsi14 <= 30 ? 'text-up' : 'text-fg'],
    ['SMA20', num(i.sma20), 'text-amber'],
    ['SMA50', num(i.sma50), 'text-info'],
    ['MACD hist', num(i.macd_hist), tone(i.macd_hist)],
    ['Vol / 20d', `${num(i.volume_spike_ratio)}x`, 'text-fg'],
    ['52W high', pct(i.pct_from_52w_high, 1), tone(i.pct_from_52w_high)],
    ['52W low', pct(i.pct_from_52w_low, 1), tone(i.pct_from_52w_low)],
    ['σ annual', `${num(i.volatility_ann_pct, 1)}%`, 'text-fg'],
  ]
  return (
    <div className="grid grid-cols-4 border-t border-line md:grid-cols-8">
      {cells.map(([k, v, c]) => (
        <div key={k} className="border-r border-line px-3 py-2 last:border-r-0">
          <div className="label">{k}</div>
          <div className={`tabular text-[13px] ${c}`}>{v}</div>
        </div>
      ))}
    </div>
  )
}

export function TradingFloor({ run, chart, chartLoading, onRun, onPreview, onStop }: Props) {
  return (
    <EvidenceProvider ledger={run.ledger}>
      <div className="space-y-4">
        <TickerSearch running={run.status === 'running'} onSubmit={onRun} onPreview={onPreview} onStop={onStop} initial={run.ticker ?? ''} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel
            title={chart ? <QuoteHeader chart={chart} /> : 'Price chart'}
            icon={!chart ? <CandlestickChart size={13} /> : undefined}
            right={
              <span className="hidden font-mono text-[10px] text-dim md:inline">
                <span className="text-amber">━ SMA20</span> <span className="ml-2 text-info">━ SMA50</span> <span className="ml-2">▮ volume</span> · 6M daily
              </span>
            }
            bodyClass="flex flex-col"
          >
            <div className="h-[380px] px-2">
              {chart ? (
                <PriceChart data={chart} verdict={run.verdict?.decision} />
              ) : (
                <Empty>{chartLoading ? 'Loading price history…' : 'Select a ticker to load six months of daily candles with SMA20/SMA50 overlays and volume.'}</Empty>
              )}
            </div>
            {chart && <IndicatorStrip chart={chart} />}
          </Panel>
          <VerdictPanel run={run} />
        </div>

        <AgentGrid run={run} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <DebatePanel run={run} />
          <EvidenceLedger ledger={run.ledger} />
        </div>

        <AgentTrace run={run} />
      </div>
    </EvidenceProvider>
  )
}
