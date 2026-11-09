import { useEffect, useState } from 'react'
import type { Health } from '../types'

export type Route = 'floor' | 'portfolio' | 'evaluation'

const NAV: { key: Route; label: string; hotkey: string }[] = [
  { key: 'floor', label: 'Trading Floor', hotkey: 'F1' },
  { key: 'portfolio', label: 'Portfolio', hotkey: 'F2' },
  { key: 'evaluation', label: 'Evaluation', hotkey: 'F3' },
]

function useIstClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hh = Number(get('hour'))
  const mm = Number(get('minute'))
  const day = get('weekday')
  const minutes = hh * 60 + mm
  const open = !['Sat', 'Sun'].includes(day) && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30
  return { time: `${get('hour')}:${get('minute')}:${get('second')}`, open }
}

export function Header({ route, health, healthError }: { route: Route; health: Health | null; healthError: boolean }) {
  const clock = useIstClock()
  const llm = health?.llm
  const llmOnline = llm?.state === 'online'

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <a href="#/floor" className="flex items-center gap-2.5" aria-label="QUORUM home">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="11" fill="none" stroke="var(--color-amber)" strokeWidth="3" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const a = (i / 7) * Math.PI * 2 - Math.PI / 2
              return <circle key={i} cx={16 + Math.cos(a) * 11} cy={16 + Math.sin(a) * 11} r="2.2" fill="var(--color-ink-950)" stroke="var(--color-amber)" strokeWidth="1.4" />
            })}
            <circle cx="16" cy="16" r="3.2" fill="var(--color-up)" />
          </svg>
          <div className="leading-none">
            <div className="font-mono text-[17px] font-bold tracking-[0.22em] text-fg">QUORUM</div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-dim uppercase">Agents debate · the floor decides</div>
          </div>
        </a>

        <nav className="flex items-center gap-1" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.key}
              href={`#/${n.key}`}
              aria-current={route === n.key ? 'page' : undefined}
              className={`rounded px-3 py-1.5 font-mono text-[12px] tracking-wider uppercase transition ${
                route === n.key ? 'bg-amber text-ink-950' : 'text-muted hover:bg-ink-800 hover:text-fg'
              }`}
            >
              <span className={`mr-1.5 text-[10px] ${route === n.key ? 'text-ink-950/60' : 'text-dim'}`}>{n.hotkey}</span>
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {healthError ? (
            <span className="rounded border border-down/50 bg-down/10 px-2 py-1 text-down">BACKEND OFFLINE</span>
          ) : (
            <>
              {health?.demo_mode && <span className="rounded border border-violet/50 bg-violet/10 px-2 py-1 text-violet">DEMO MODE</span>}
              <span
                className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
                  llmOnline ? 'border-info/40 bg-info/10 text-info' : 'border-amber/40 bg-amber/10 text-amber'
                }`}
                title={llm?.reason ?? undefined}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${llmOnline ? 'bg-info' : 'bg-amber'}`} />
                {llm ? (llmOnline ? llm.model : `OFFLINE ENGINE${llm.state === 'cooldown' ? ' (cooldown)' : ''}`) : 'LLM …'}
              </span>
            </>
          )}
          <span className={`flex items-center gap-1.5 rounded border px-2 py-1 ${clock.open ? 'border-up/40 text-up' : 'border-line text-muted'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${clock.open ? 'animate-pulse bg-up' : 'bg-dim'}`} />
            NSE {clock.open ? 'OPEN' : 'CLOSED'}
          </span>
          <span className="tabular rounded border border-line px-2 py-1 text-fg">{clock.time} IST</span>
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 text-[11px] text-dim">
        <span className="font-mono tracking-wider text-warn uppercase">Educational simulation · not financial advice</span>
        <span>
          QUORUM is a college mini-project demonstrating multi-agent AI. Decisions are produced by language models and simple rules on
          public data, trade a virtual ₹1,00,000 portfolio only, and must not be used for real investment decisions.
        </span>
        <span className="ml-auto font-mono">Data: Yahoo Finance · Google News RSS</span>
      </div>
    </footer>
  )
}
