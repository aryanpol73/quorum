import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import type { ChartData, ChartPoint, Decision } from '../types'
import { num, rupee } from '../lib/format'

const C = {
  up: '#3fd8a2',
  down: '#f25a7c',
  gold: '#dcb76c',
  sapphire: '#8aaeff',
  grid: 'rgba(120, 100, 180, 0.07)',
  border: 'rgba(220, 183, 108, 0.14)',
  text: '#8a83a6',
}

interface Props {
  data: ChartData | null
  verdict?: Decision | null
}

export function PriceChart({ data, verdict }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const [hover, setHover] = useState<ChartPoint | null>(null)

  useEffect(() => {
    if (!ref.current || !data?.series.length) return
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: C.text,
        fontFamily: 'DM Mono, ui-monospace, monospace',
        fontSize: 11,
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, rightOffset: 4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(220,183,108,0.35)', labelBackgroundColor: '#9e7a3a' },
        horzLine: { color: 'rgba(220,183,108,0.35)', labelBackgroundColor: '#9e7a3a' },
      },
      // let the mouse wheel scroll the page; drag / pinch still pan and zoom the chart
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    })
    chartRef.current = chart

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderVisible: false,
      wickUpColor: C.up,
      wickDownColor: C.down,
    })
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } })
    candles.setData(data.series.map((d) => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close })))
    candleRef.current = candles

    const sma = (key: 'sma20' | 'sma50', color: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      s.setData(data.series.filter((d) => d[key] != null).map((d) => ({ time: d.time as Time, value: d[key] as number })))
    }
    sma('sma20', C.gold)
    sma('sma50', C.sapphire)

    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    vol.setData(
      data.series.map((d) => ({
        time: d.time as Time,
        value: d.volume,
        color: d.close >= d.open ? 'rgba(63,216,162,0.28)' : 'rgba(242,90,124,0.28)',
      })),
    )

    markersRef.current = createSeriesMarkers(candles, [])
    chart.timeScale().fitContent()

    const byTime = new Map(data.series.map((d) => [d.time, d]))
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null)
        return
      }
      setHover(byTime.get(String(param.time)) ?? null)
    })

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      markersRef.current = null
    }
  }, [data])

  // Verdict marker on the latest candle
  useEffect(() => {
    const last = data?.series[data.series.length - 1]
    if (!markersRef.current || !last) return
    if (!verdict) {
      markersRef.current.setMarkers([])
      return
    }
    markersRef.current.setMarkers([
      {
        time: last.time as Time,
        position: verdict === 'SELL' ? 'aboveBar' : 'belowBar',
        color: verdict === 'BUY' ? C.up : verdict === 'SELL' ? C.down : C.gold,
        shape: verdict === 'BUY' ? 'arrowUp' : verdict === 'SELL' ? 'arrowDown' : 'circle',
        text: verdict,
      },
    ])
  }, [verdict, data])

  const last = data?.series[data.series.length - 1]
  const shown = hover ?? last

  return (
    <div className="relative h-full min-h-[320px]">
      {shown && (
        <div className="pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap gap-x-3.5 gap-y-0.5 font-mono text-[11px]">
          <span className="text-dim">{shown.time}</span>
          <span className="text-muted">
            O <span className="text-fg">{num(shown.open)}</span>
          </span>
          <span className="text-muted">
            H <span className="text-fg">{num(shown.high)}</span>
          </span>
          <span className="text-muted">
            L <span className="text-fg">{num(shown.low)}</span>
          </span>
          <span className="text-muted">
            C <span className={shown.close >= shown.open ? 'text-up' : 'text-down'}>{rupee(shown.close)}</span>
          </span>
          <span className="text-gold">SMA20 {num(shown.sma20)}</span>
          <span className="text-info">SMA50 {num(shown.sma50)}</span>
        </div>
      )}
      <div ref={ref} className="absolute inset-0 top-6" />
    </div>
  )
}
