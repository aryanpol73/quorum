import { LoaderCircle, Play, Search, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TICKERS } from '../data/tickers'

interface Props {
  running: boolean
  onSubmit: (symbol: string) => void
  onPreview: (symbol: string) => void
  onStop: () => void
  initial?: string
}

export function TickerSearch({ running, onSubmit, onPreview, onStop, initial = '' }: Props) {
  const [query, setQuery] = useState(initial)
  const [open, setOpen] = useState(false)
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
    // "/" focuses the command line, terminal-style
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
    <div className="flex flex-wrap items-stretch gap-2">
      <div ref={boxRef} className="relative min-w-[260px] flex-1">
        <div className="flex h-11 items-center gap-2 rounded-md border border-line-strong bg-ink-900 px-3 focus-within:border-amber">
          <span className="font-mono text-[13px] text-amber">&gt;</span>
          <Search size={15} className="text-dim" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase())
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Enter NSE ticker — INFY, TATAMOTORS, RELIANCE…  (press / to focus)"
            className="h-full flex-1 bg-transparent font-mono text-[14px] tracking-wide text-fg uppercase outline-none placeholder:text-dim placeholder:normal-case"
            aria-label="NSE ticker"
            role="combobox"
            aria-expanded={open}
            aria-controls="ticker-listbox"
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="hidden font-mono text-[10px] text-dim sm:inline">.NS</span>
        </div>
        {open && matches.length > 0 && (
          <ul
            id="ticker-listbox"
            role="listbox"
            className="absolute top-12 right-0 left-0 z-30 max-h-80 overflow-auto rounded-md border border-line-strong bg-ink-850 py-1 shadow-2xl"
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
                className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 ${i === active ? 'bg-amber/10' : ''}`}
              >
                <span className={`w-28 font-mono text-[13px] ${i === active ? 'text-amber' : 'text-fg'}`}>{t.symbol}</span>
                <span className="truncate text-[12px] text-muted">{t.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {running ? (
        <button
          onClick={onStop}
          className="flex h-11 items-center gap-2 rounded-md border border-down/60 bg-down/10 px-5 font-mono text-[12px] tracking-widest text-down uppercase transition hover:bg-down/20"
        >
          <LoaderCircle size={15} className="animate-spin" />
          In session
          <Square size={12} className="ml-1 fill-current" aria-label="Stop" />
        </button>
      ) : (
        <button
          onClick={() => submit()}
          disabled={!query.trim()}
          className="flex h-11 items-center gap-2 rounded-md bg-amber px-5 font-mono text-[12px] font-semibold tracking-widest text-ink-950 uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={14} className="fill-current" />
          Convene quorum
        </button>
      )}
    </div>
  )
}
