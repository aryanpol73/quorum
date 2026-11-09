import { motion } from 'framer-motion'
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
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  const open = !['Sat', 'Sun'].includes(get('weekday')) && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30
  return { time: `${get('hour')}:${get('minute')}:${get('second')}`, open }
}

/** Crest: a "Q" monogram inside a gold ring with seven seats — one per agent. */
export function Crest({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="crest-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8e4ae" />
          <stop offset="0.5" stopColor="#dcb76c" />
          <stop offset="1" stopColor="#9e7a3a" />
        </linearGradient>
        <radialGradient id="crest-core" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#2a2150" />
          <stop offset="1" stopColor="#0d0a1b" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="url(#crest-core)" stroke="url(#crest-gold)" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="23" fill="none" stroke="url(#crest-gold)" strokeOpacity="0.45" strokeWidth="0.8" />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2 - Math.PI / 2
        return <circle key={i} cx={32 + Math.cos(a) * 26} cy={32 + Math.sin(a) * 26} r="1.9" fill="url(#crest-gold)" />
      })}
      <text x="32" y="41" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontSize="26" fontWeight="700" fill="url(#crest-gold)">
        Q
      </text>
    </svg>
  )
}

export function Header({ route, health, healthError }: { route: Route; health: Health | null; healthError: boolean }) {
  const clock = useIstClock()
  const llm = health?.llm
  const llmOnline = llm?.state === 'online'

  return (
    <header className="sticky top-0 z-40 border-b border-gold/10 bg-ink-950/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3">
        <a href="#/floor" className="group flex items-center gap-3" aria-label="QUORUM home">
          <motion.span whileHover={{ rotate: 12, scale: 1.05 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>
            <Crest />
          </motion.span>
          <div className="leading-none">
            <div className="gold-text font-serif text-[25px] font-semibold tracking-[0.3em]">QUORUM</div>
            <div className="mt-1 text-[9.5px] font-semibold tracking-[0.32em] text-dim uppercase">The council of agents</div>
          </div>
        </a>

        <nav className="relative flex items-center rounded-full border border-gold/15 bg-ink-900/70 p-1" aria-label="Main">
          {NAV.map((n) => {
            const active = route === n.key
            return (
              <a
                key={n.key}
                href={`#/${n.key}`}
                aria-current={active ? 'page' : undefined}
                title={`${n.label} (${n.hotkey})`}
                className={`relative z-10 rounded-full px-4 py-1.5 text-[12.5px] font-semibold tracking-wide transition-colors duration-300 ${
                  active ? 'text-gold-bright' : 'text-muted hover:text-fg'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-full border border-gold/40"
                    style={{ background: 'linear-gradient(180deg, rgba(220,183,108,0.2), rgba(220,183,108,0.06))', boxShadow: '0 0 24px -8px rgba(220,183,108,0.6)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                {n.label}
              </a>
            )
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          {healthError ? (
            <span className="rounded-full border border-down/40 bg-down/10 px-3 py-1 text-down">Backend offline</span>
          ) : (
            <>
              {health?.demo_mode && <span className="rounded-full border border-violet/40 bg-violet/10 px-3 py-1 tracking-wide text-violet">Demo mode</span>}
              <span
                className={`flex items-center gap-2 rounded-full border px-3 py-1 tracking-wide ${
                  llmOnline ? 'border-info/35 bg-info/10 text-info' : 'border-gold/30 bg-gold/[0.07] text-gold'
                }`}
                title={llm?.reason ?? undefined}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${llmOnline ? 'bg-info shadow-[0_0_8px] shadow-info' : 'bg-gold'}`} />
                {llm ? (llmOnline ? llm.model : `Offline engine${llm.state === 'cooldown' ? ' · cooldown' : ''}`) : 'Connecting…'}
              </span>
            </>
          )}
          <span className={`flex items-center gap-2 rounded-full border px-3 py-1 tracking-wide ${clock.open ? 'border-up/35 text-up' : 'border-line-strong text-muted'}`}>
            <span className={`relative h-1.5 w-1.5 rounded-full ${clock.open ? 'bg-up' : 'bg-dim'}`}>
              {clock.open && <span className="absolute inset-0 animate-ping rounded-full bg-up" />}
            </span>
            NSE {clock.open ? 'open' : 'closed'}
          </span>
          <span className="tabular rounded-full border border-line-strong px-3 py-1 text-fg">{clock.time} IST</span>
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="mt-12">
      <div className="hairline" />
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[12px] text-dim">
        <span className="flex items-center gap-2">
          <Crest size={22} />
          <span className="gold-text font-serif text-[15px] font-semibold tracking-[0.25em]">QUORUM</span>
        </span>
        <span className="rounded-full border border-warn/30 bg-warn/[0.06] px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-warn uppercase">
          Educational simulation · not financial advice
        </span>
        <span className="max-w-3xl leading-relaxed">
          A college mini-project on multi-agent AI. Decisions come from language models and simple rules on public data and trade a virtual
          ₹1,00,000 portfolio only. Do not use them for real investment decisions.
        </span>
        <span className="ml-auto text-[11px]">Data · Yahoo Finance · Google News RSS · Charts by TradingView Lightweight Charts</span>
      </div>
    </footer>
  )
}
