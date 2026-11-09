import { AnimatePresence, motion } from 'framer-motion'
import { Crown, Search, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TICKERS } from '../data/tickers'
import { EASE, Magnetic, RoyalButton } from './ui'

interface Props {
  running: boolean
  onSubmit: (symbol: string) => void
  onPreview: (symbol: string) => void
  onStop: () => void
  initial?: string
}

const QUICK = ['INFY', 'TATAMOTORS', 'RELIANCE', 'TCS', 'HDFCBANK', 'ITC']

export function TickerSearch({ running, onSubmit, onPreview, onStop, initial = '' }: Props) {
  const [query, setQuery] = useState(initial)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase()
    if (!q) return TICKERS.slice(0, 8)
    const starts = TICKERS.filter((t) => t.symbol.startsWith(q))
    const contains = TICKERS.filter((t) => !t.symbol.startsWith(q) && (t.symbol.includes(q) || t.name.toUpperCase().includes(q)))
    return [...starts, ...contains].slice(0, 8)
  }, [query])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (symbol: string) => {
    setQuery(symbol)
    setOpen(false)
    onPreview(symbol)
  }

  const submit = (symbol?: string) => {
    const s = (symbol ?? query).trim().toUpperCase().replace(/\.(NS|BO)$/, '')
    if (!s || running) return
    setQuery(s)
    setOpen(false)
    onSubmit(s)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && matches[active] && query.trim().toUpperCase() !== matches[active].symbol) choose(matches[active].symbol)
      else submit()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div ref={boxRef} className="relative min-w-[280px] flex-1">
          <motion.div
            animate={{
              boxShadow: focused
                ? '0 0 0 1px rgba(220,183,108,0.55), 0 0 0 6px rgba(220,183,108,0.08), 0 18px 50px -24px rgba(220,183,108,0.45)'
                : '0 0 0 1px rgba(220,183,108,0.16), 0 0 0 0 rgba(0,0,0,0), 0 18px 40px -30px rgba(0,0,0,0.8)',
            }}
            transition={{ duration: 0.35, ease: EASE }}
            className="flex h-[58px] items-center gap-3 rounded-2xl bg-ink-900/90 px-5"
          >
            <Search size={18} className={`transition-colors duration-300 ${focused ? 'text-gold' : 'text-dim'}`} aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.toUpperCase())
                setOpen(true)
                setActive(0)
              }}
              onFocus={() => {
                setFocused(true)
                setOpen(true)
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              placeholder="Search an NSE stock — INFY, TATAMOTORS, RELIANCE…"
              className="h-full flex-1 bg-transparent font-mono text-[16px] tracking-[0.08em] text-fg uppercase outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-dim placeholder:normal-case"
              aria-label="NSE ticker"
              role="combobox"
              aria-expanded={open}
              aria-controls="ticker-listbox"
              aria-autocomplete="list"
              spellCheck={false}
              autoComplete="off"
            />
            <kbd className="hidden rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-dim sm:inline">/</kbd>
          </motion.div>
          <AnimatePresence>
            {open && matches.length > 0 && (
              <motion.ul
                id="ticker-listbox"
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.15 } }}
                transition={{ duration: 0.25, ease: EASE }}
                className="absolute top-[66px] right-0 left-0 z-30 max-h-[340px] origin-top overflow-auto rounded-2xl border border-gold/20 bg-ink-850/95 p-1.5 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl"
              >
                {matches.map((t, i) => (
                  <li
                    key={t.symbol}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(t.symbol)
                    }}
                    className="relative flex cursor-pointer items-center gap-4 rounded-xl px-3.5 py-2"
                  >
                    {i === active && (
                      <motion.span
                        layoutId="ticker-hl"
                        className="absolute inset-0 rounded-xl border border-gold/25 bg-gold/[0.08]"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span className={`relative w-28 font-mono text-[13.5px] tracking-wider ${i === active ? 'text-gold-bright' : 'text-fg'}`}>{t.symbol}</span>
                    <span className="relative truncate text-[12.5px] text-muted">{t.name}</span>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {running ? (
          <Magnetic>
            <button onClick={onStop} className="btn-session h-[58px] px-6 text-[13px] font-bold tracking-wide">
              <span className="relative grid h-7 w-7 place-items-center">
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-down/25 border-t-down" />
                <Square size={10} className="fill-current text-down" />
              </span>
              Council in session
              <span className="text-[11px] font-semibold text-down/80">Stop</span>
            </button>
          </Magnetic>
        ) : (
          <RoyalButton onClick={() => submit()} disabled={!query.trim()} className="h-[58px] pr-7 pl-2.5 text-[13.5px]">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-ink-950/90 text-gold shadow-inner">
              <Crown size={17} />
            </span>
            CONVENE THE COUNCIL
          </RoyalButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">Quick picks</span>
        {QUICK.map((s) => (
          <motion.button
            key={s}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            disabled={running}
            onClick={() => {
              setQuery(s)
              submit(s)
            }}
            className="btn-ghost px-3 py-1 font-mono text-[11.5px] tracking-wider disabled:pointer-events-none disabled:opacity-40"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
