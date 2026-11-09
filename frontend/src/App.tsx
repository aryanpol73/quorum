import { MotionConfig } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Footer, Header, type Route } from './components/Header'
import { ToastProvider, useToast } from './components/Toasts'
import { getJSON, streamSSE } from './lib/api'
import { initialRun, runReducer } from './lib/runReducer'
import { TradingFloor } from './pages/TradingFloor'
import type { ChartData, Health, QuorumEvent, TradeResult } from './types'

// Portfolio & Evaluation pull in Recharts, so they are code-split.
const Portfolio = lazy(() => import('./pages/Portfolio').then((m) => ({ default: m.Portfolio })))
const Evaluation = lazy(() => import('./pages/Evaluation').then((m) => ({ default: m.Evaluation })))

const ROUTES: Route[] = ['floor', 'portfolio', 'evaluation']

function useHashRoute(): Route {
  const read = () => {
    const r = window.location.hash.replace(/^#\/?/, '') as Route
    return ROUTES.includes(r) ? r : 'floor'
  }
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    // Bloomberg-style function keys: F1 floor, F2 portfolio, F3 evaluation
    const onKey = (e: KeyboardEvent) => {
      const i = ['F1', 'F2', 'F3'].indexOf(e.key)
      if (i >= 0) {
        e.preventDefault()
        window.location.hash = `#/${ROUTES[i]}`
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return route
}

function Shell() {
  const toast = useToast()
  const route = useHashRoute()
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState(false)
  const [run, dispatch] = useReducer(runReducer, initialRun)
  const [chart, setChart] = useState<ChartData | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const chartReq = useRef(0)

  useEffect(() => {
    let alive = true
    const ping = () =>
      getJSON<Health>('/api/health')
        .then((h) => {
          if (!alive) return
          setHealth(h)
          setHealthError(false)
        })
        .catch(() => alive && setHealthError(true))
    ping()
    const id = window.setInterval(ping, 15000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const loadChart = useCallback(
    async (symbol: string) => {
      const req = ++chartReq.current
      setChartLoading(true)
      try {
        const data = await getJSON<ChartData>(`/api/chart/${encodeURIComponent(symbol)}`)
        if (req === chartReq.current) setChart(data)
      } catch (e) {
        if (req === chartReq.current) {
          setChart(null)
          toast('error', (e as Error).message)
        }
      } finally {
        if (req === chartReq.current) setChartLoading(false)
      }
    },
    [toast],
  )

  const startRun = useCallback(
    async (symbol: string) => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      dispatch({ kind: 'start', ticker: symbol })
      if (chart?.ticker !== symbol) loadChart(symbol)

      const t0 = performance.now()
      const timer = window.setInterval(() => dispatch({ kind: 'tick', elapsed: (performance.now() - t0) / 1000 }), 200)
      const toasted = new Set<string>()
      let finished = false

      const onEvent = (ev: QuorumEvent) => {
        dispatch({ kind: 'event', ev })
        if (ev.type === 'notice') {
          // agent-scoped notices are prefixed "agent: ..." - toast each kind once per run
          const msg = String(ev.message)
          const key = msg.replace(/^\w+: /, '').slice(0, 60)
          if (!toasted.has(key)) {
            toasted.add(key)
            toast(ev.level === 'error' ? 'error' : ev.level === 'warn' ? 'warn' : 'info', msg)
          }
        } else if (ev.type === 'error') {
          toast('error', String(ev.message))
        } else if (ev.type === 'trade') {
          const r = ev.result as TradeResult
          if (r.executed && r.trade) toast('success', `Paper trade executed: ${r.trade.side} ${r.trade.qty} × ${r.trade.ticker} @ ₹${r.trade.price.toLocaleString('en-IN')}`)
        } else if (ev.type === 'done') {
          finished = true
        }
      }

      try {
        await streamSSE(`/api/analyze/${encodeURIComponent(symbol)}/stream`, onEvent, ctl.signal)
        if (!finished && !ctl.signal.aborted) {
          dispatch({ kind: 'fail', message: 'The stream ended unexpectedly. Check the backend logs.' })
          toast('error', 'The analysis stream ended unexpectedly.')
        }
      } catch (e) {
        dispatch({ kind: 'fail', message: (e as Error).message })
        toast('error', (e as Error).message)
      } finally {
        window.clearInterval(timer)
        if (abortRef.current === ctl) abortRef.current = null
      }
    },
    [chart?.ticker, loadChart, toast],
  )

  const stopRun = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ kind: 'fail', message: 'Session stopped by user.' })
    toast('info', 'Quorum adjourned (stopped by user).')
  }, [toast])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="flex min-h-screen flex-col">
      <div className="royal-canvas" aria-hidden>
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
      </div>
      <Header route={route} health={health} healthError={healthError} />
      <main className="mx-auto w-full max-w-[1560px] flex-1 px-5 py-6">
        <div key={route} className="rise">
            {route === 'floor' && (
              <TradingFloor run={run} chart={chart} chartLoading={chartLoading} onRun={startRun} onPreview={loadChart} onStop={stopRun} />
            )}
            <Suspense fallback={<p className="title-serif p-12 text-center text-[20px] text-dim italic">Opening the chamber…</p>}>
              {route === 'portfolio' && <Portfolio />}
              {route === 'evaluation' && <Evaluation />}
            </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </MotionConfig>
  )
}
