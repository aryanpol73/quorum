import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Level = 'info' | 'warn' | 'error' | 'success'
interface Toast {
  id: number
  level: Level
  message: string
}

const ToastCtx = createContext<(level: Level, message: string) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

const STYLE: Record<Level, string> = {
  info: 'border-info/40 text-info',
  success: 'border-up/40 text-up',
  warn: 'border-warn/40 text-warn',
  error: 'border-down/50 text-down',
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
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-ink-850/95 px-3 py-2.5 shadow-xl backdrop-blur ${STYLE[t.level]}`}
              role={t.level === 'error' ? 'alert' : 'status'}
            >
              {t.level === 'error' ? (
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
              ) : t.level === 'warn' ? (
                <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              ) : (
                <Info size={16} className="mt-0.5 shrink-0" />
              )}
              <p className="flex-1 text-[13px] leading-snug text-fg">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="text-dim transition hover:text-fg"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
