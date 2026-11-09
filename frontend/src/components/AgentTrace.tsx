import { ChevronDown, GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getJSON } from '../lib/api'
import type { NodeSpan, RunState } from '../types'
import { Empty } from './ui'

type Pos = { x: number; y: number; label: string }
const NODES: Record<string, Pos> = {
  __start__: { x: 40, y: 110, label: 'START' },
  market_analyst: { x: 175, y: 40, label: 'market_analyst' },
  news_analyst: { x: 175, y: 110, label: 'news_analyst' },
  fundamentals_analyst: { x: 175, y: 180, label: 'fundamentals' },
  evidence_board: { x: 345, y: 110, label: 'evidence_board' },
  bull: { x: 490, y: 65, label: 'bull' },
  bear: { x: 490, y: 155, label: 'bear' },
  risk_manager: { x: 640, y: 110, label: 'risk_manager' },
  portfolio_manager: { x: 795, y: 110, label: 'portfolio_mgr' },
  paper_trade: { x: 935, y: 110, label: 'paper_trade' },
  __end__: { x: 1040, y: 110, label: 'END' },
}
const EDGES: [string, string, boolean?][] = [
  ['__start__', 'market_analyst'],
  ['__start__', 'news_analyst'],
  ['__start__', 'fundamentals_analyst'],
  ['market_analyst', 'evidence_board'],
  ['news_analyst', 'evidence_board'],
  ['fundamentals_analyst', 'evidence_board'],
  ['evidence_board', 'bull'],
  ['bull', 'bear'],
  ['bear', 'risk_manager', true],
  ['risk_manager', 'portfolio_manager'],
  ['portfolio_manager', 'paper_trade'],
  ['paper_trade', '__end__'],
]

function GraphDiagram({ nodes, status }: { nodes: NodeSpan[]; status: RunState['status'] }) {
  const state = (id: string) => {
    if (id === '__start__') return nodes.length ? 'done' : 'idle'
    if (id === '__end__') return status === 'done' ? 'done' : 'idle'
    const spans = nodes.filter((n) => n.node === id)
    if (spans.some((s) => s.end == null)) return 'active'
    return spans.length ? 'done' : 'idle'
  }
  const count = (id: string) => nodes.filter((n) => n.node === id).length
  const W = 112
  const H = 30
  return (
    <svg viewBox="0 0 1090 220" className="h-auto w-full" role="img" aria-label="LangGraph execution graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4a4078" />
        </marker>
      </defs>
      {EDGES.map(([a, b, cond]) => {
        const p = NODES[a]
        const q = NODES[b]
        const x1 = p.x + (a.startsWith('__') ? 22 : W / 2)
        const x2 = q.x - (b.startsWith('__') ? 22 : W / 2)
        if (a === 'bull' && b === 'bear') {
          return <line key={a + b} x1={p.x} y1={p.y + H / 2} x2={q.x} y2={q.y - H / 2} stroke="#4a4078" strokeWidth="1.3" markerEnd="url(#arrow)" />
        }
        return (
          <path
            key={a + b}
            d={`M${x1},${p.y} C${(x1 + x2) / 2},${p.y} ${(x1 + x2) / 2},${q.y} ${x2},${q.y}`}
            fill="none"
            stroke="#4a4078"
            strokeWidth="1.3"
            strokeDasharray={cond ? '4 3' : undefined}
            markerEnd="url(#arrow)"
          />
        )
      })}
      {/* conditional loop bear -> bull */}
      <path
        d={`M${NODES.bear.x - W / 2},${NODES.bear.y} C${NODES.bear.x - 95},${NODES.bear.y} ${NODES.bull.x - 95},${NODES.bull.y} ${NODES.bull.x - W / 2},${NODES.bull.y}`}
        fill="none"
        stroke="#4a4078"
        strokeWidth="1.3"
        strokeDasharray="4 3"
        markerEnd="url(#arrow)"
      />
      <text x={NODES.bull.x - 104} y={113} className="fill-dim font-mono" fontSize="9">
        rounds left?
      </text>
      <text x={NODES.bear.x + 62} y={NODES.bear.y + 26} className="fill-dim font-mono" fontSize="9">
        done → risk
      </text>
      {Object.entries(NODES).map(([id, p]) => {
        const st = state(id)
        const terminal = id.startsWith('__')
        const stroke = st === 'active' ? '#dcb76c' : st === 'done' ? '#3fd8a2' : '#3a3160'
        const fill = st === 'active' ? 'rgba(220,183,108,0.16)' : st === 'done' ? 'rgba(63,216,162,0.09)' : '#120e25'
        const n = count(id)
        return (
          <g key={id}>
            {terminal ? (
              <circle cx={p.x} cy={p.y} r="20" fill={fill} stroke={stroke} strokeWidth="1.4" />
            ) : (
              <rect x={p.x - W / 2} y={p.y - H / 2} width={W} height={H} rx="10" fill={fill} stroke={stroke} strokeWidth="1.4">
                {st === 'active' && <animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.1s" repeatCount="indefinite" />}
              </rect>
            )}
            <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={terminal ? 9 : 10.5} className="font-mono" fill={st === 'idle' ? '#6f6891' : '#f5eedd'}>
              {p.label}
            </text>
            {n > 1 && (
              <text x={p.x + W / 2 - 4} y={p.y - H / 2 - 4} textAnchor="end" fontSize="9" className="font-mono" fill="#dcb76c">
                ×{n}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Timeline({ nodes, now }: { nodes: NodeSpan[]; now: number }) {
  if (!nodes.length) return <Empty>Node timings appear here while the graph runs.</Empty>
  const t0 = Math.min(...nodes.map((n) => n.start))
  const t1 = Math.max(now, ...nodes.map((n) => n.end ?? now))
  const span = Math.max(0.001, t1 - t0)
  const color = (node: string) =>
    node.includes('analyst') ? '#8aaeff' : node === 'bull' ? '#3fd8a2' : node === 'bear' ? '#f25a7c' : node === 'risk_manager' ? '#f4c25c' : '#dcb76c'
  return (
    <div className="space-y-1">
      {nodes.map((n, i) => {
        const end = n.end ?? now
        const left = ((n.start - t0) / span) * 100
        const width = Math.max(0.6, ((end - n.start) / span) * 100)
        return (
          <div key={i} className="grid grid-cols-[130px_1fr_64px] items-center gap-2 font-mono text-[10.5px]">
            <span className="truncate text-muted">{n.node}</span>
            <div className="relative h-3 rounded-full bg-ink-800">
              <div
                className={`absolute top-0 h-full rounded-full transition-[width] duration-300 ${n.end == null ? 'animate-pulse' : ''}`}
                style={{ left: `${left}%`, width: `${width}%`, background: `linear-gradient(90deg, ${color(n.node)}99, ${color(n.node)})`, boxShadow: `0 0 10px -2px ${color(n.node)}` }}
              />
            </div>
            <span className="tabular text-right text-dim">{n.ms != null ? `${n.ms}ms` : '…'}</span>
          </div>
        )
      })}
      <div className="grid grid-cols-[130px_1fr_64px] gap-2 font-mono text-[9.5px] text-dim">
        <span />
        <div className="flex justify-between">
          <span>{t0.toFixed(2)}s</span>
          <span>{t1.toFixed(2)}s</span>
        </div>
        <span />
      </div>
    </div>
  )
}

export function AgentTrace({ run }: { run: RunState }) {
  const [open, setOpen] = useState(false)
  const [mermaid, setMermaid] = useState<string | null>(null)

  useEffect(() => {
    if (open && mermaid == null) {
      getJSON<{ mermaid: string }>('/api/graph')
        .then((g) => setMermaid(g.mermaid))
        .catch(() => setMermaid('Graph source unavailable (backend offline).'))
    }
  }, [open, mermaid])

  return (
    <section className="panel overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-colors duration-300 hover:bg-gold/[0.04]"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/25 bg-gold/[0.06] text-gold">
          <GitBranch size={14} />
        </span>
        <span className="leading-tight">
          <span className="eyebrow block">For the viva</span>
          <span className="title-serif block text-[19px]">Agent trace · LangGraph execution</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
          {run.meta && (
            <>
              <span>run {run.meta.run_id}</span>
              <span>{run.eventCount} events</span>
              <span>{run.tokenCount} token chunks</span>
              <span>{run.tools.length} tool calls</span>
              {run.totalMs != null && <span>{(run.totalMs / 1000).toFixed(1)}s</span>}
            </>
          )}
          <span className="grid h-7 w-7 place-items-center rounded-full border border-line-strong text-muted transition-all duration-300 group-hover:border-gold/40 group-hover:text-gold">
            <ChevronDown size={14} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </span>
        </span>
      </button>
      <div className="drawer" data-open={open} aria-hidden={!open} inert={!open}>
        <div>
            <div className="space-y-6 border-t border-gold/10 p-5">
              <div>
                <div className="eyebrow mb-2.5">Graph topology · live node state (dashed = conditional edge)</div>
                <div className="rounded-2xl border border-line/80 bg-ink-950/60 p-3">
                  <GraphDiagram nodes={run.nodes} status={run.status} />
                </div>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <div className="eyebrow mb-2.5">Node order & timings · overlapping bars = parallel execution</div>
                  <Timeline nodes={run.nodes} now={run.elapsed} />
                </div>
                <div>
                  <div className="eyebrow mb-2.5">Raw tool calls</div>
                  {run.tools.length === 0 ? (
                    <Empty>Tool calls (yfinance, Google News RSS, citation checks, paper broker) are logged here.</Empty>
                  ) : (
                    <ul className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
                      {run.tools.map((c, i) => (
                        <li key={i} className="rounded-xl border border-line/80 bg-ink-950/50 transition-colors hover:border-gold/25">
                          <details>
                            <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 font-mono text-[10.5px]">
                              <span className="tabular w-12 text-dim">{c.t.toFixed(2)}s</span>
                              <span className="w-20 truncate text-muted">{c.agent}</span>
                              <span className="flex-1 truncate text-gold">{c.tool}()</span>
                              <span className="tabular text-dim">{c.ms}ms</span>
                            </summary>
                            <pre className="max-h-56 overflow-auto border-t border-line px-2 py-1.5 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted">
                              {'args   '}
                              {JSON.stringify(c.args, null, 1)}
                              {'\nresult '}
                              {JSON.stringify(c.result, null, 1)}
                            </pre>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {run.notices.length > 0 && (
                <div>
                  <div className="eyebrow mb-1.5">Run notices</div>
                  <ul className="space-y-0.5 font-mono text-[10.5px]">
                    {run.notices.map((n, i) => (
                      <li key={i} className={n.level === 'error' ? 'text-down' : n.level === 'warn' ? 'text-warn' : 'text-muted'}>
                        [{n.t.toFixed(2)}s] {n.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="rounded-xl border border-line/80">
                <summary className="cursor-pointer px-2 py-1 font-mono text-[10.5px] text-muted">Mermaid source (generated by LangGraph `get_graph().draw_mermaid()`)</summary>
                <pre className="overflow-auto border-t border-line p-2 font-mono text-[10px] text-dim">{mermaid ?? 'loading…'}</pre>
              </details>
            </div>
        </div>
      </div>
    </section>
  )
}
