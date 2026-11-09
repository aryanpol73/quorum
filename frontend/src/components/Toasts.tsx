import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Level = 'info' | 'warn' | 'error' | 'success'
interface Toast {
  id: number
  level: Level
  message: string
}

const ToastCtx = createContext<(level: Level, message: string) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

const STYLE: Record<Level, { color: string; icon: ReactNode; title: string }> = {
  info: { color: 'var(--color-info)', icon: <Info size={15} />, title: 'Notice' },
  success: { color: 'var(--color-up)', icon: <CircleCheck size={15} />, title: 'Done' },
  warn: { color: 'var(--color-warn)', icon: <TriangleAlert size={15} />, title: 'Heads up' },
  error: { color: 'var(--color-down)', icon: <CircleAlert size={15} />, title: 'Error' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (level: Level, message: string) => {
      const id = nextId.current++
      setToasts((all) => [...all.filter((t) => t.message !== message), { id, level, message }].slice(-4))
      window.setTimeout(() => dismiss(id), level === 'error' ? 9000 : 5500)
    },
    [dismiss],
  )

  const value = useMemo(() => push, [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[min(400px,calc(100vw-2.5rem))] flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const s = STYLE[t.level]
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border border-gold/15 bg-ink-850/95 px-4 py-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
                role={t.level === 'error' ? 'alert' : 'status'}
              >
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.color, boxShadow: `0 0 16px ${s.color}` }} />
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}>
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: s.color }}>
                    {s.title}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-fg/90">{t.message}</p>
                </div>
                <button onClick={() => dismiss(t.id)} className="text-dim transition hover:text-fg" aria-label="Dismiss notification">
                  <X size={14} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
