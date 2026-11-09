import type {
  AgentKey,
  AgentState,
  AgentStatus,
  Evidence,
  LlmSource,
  Notice,
  QuorumEvent,
  RiskOutput,
  RunMeta,
  RunState,
  ToolCall,
  TradeResult,
  Turn,
  Verdict,
} from '../types'

export const AGENT_KEYS: AgentKey[] = ['market', 'news', 'fundamentals', 'bull', 'bear', 'risk', 'pm']

const freshAgents = (): Record<AgentKey, AgentState> =>
  Object.fromEntries(AGENT_KEYS.map((k) => [k, { status: 'idle', text: '' }])) as Record<AgentKey, AgentState>

export const initialRun: RunState = {
  status: 'idle',
  ticker: null,
  meta: null,
  agents: freshAgents(),
  turns: [],
  ledger: [],
  risk: null,
  verdict: null,
  trade: null,
  nodes: [],
  tools: [],
  notices: [],
  eventCount: 0,
  tokenCount: 0,
  totalMs: null,
  llmMode: null,
  error: null,
  elapsed: 0,
}

export type RunAction =
  | { kind: 'start'; ticker: string }
  | { kind: 'event'; ev: QuorumEvent }
  | { kind: 'fail'; message: string }
  | { kind: 'tick'; elapsed: number }

const isAgent = (a: unknown): a is AgentKey => typeof a === 'string' && (AGENT_KEYS as string[]).includes(a)

function patchAgent(s: RunState, key: AgentKey, patch: Partial<AgentState>): RunState {
  return { ...s, agents: { ...s.agents, [key]: { ...s.agents[key], ...patch } } }
}

function patchTurn(s: RunState, id: string, fn: (t: Turn) => Turn): RunState {
  return { ...s, turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) }
}

function applyEvent(prev: RunState, ev: QuorumEvent): RunState {
  const s: RunState = { ...prev, eventCount: prev.eventCount + 1 }
  const t = typeof ev.t === 'number' ? ev.t : 0
  const agent = ev.agent

  switch (ev.type) {
    case 'run_start':
      return { ...s, meta: ev as unknown as RunMeta }

    case 'agent_status': {
      if (!isAgent(agent)) return s
      const status = ev.status as AgentStatus
      const cur = s.agents[agent]
      const patch: Partial<AgentState> = { status, message: (ev.message as string) ?? cur.message }
      if (ev.llm) patch.llm = ev.llm as LlmSource
      if (typeof ev.round === 'number') patch.round = ev.round
      if (status === 'thinking' && cur.startedAt == null) patch.startedAt = t
      if (status === 'done' || status === 'error' || status === 'skipped') patch.endedAt = t
      // a debater starting a new round clears its card text
      if (status === 'thinking' && (agent === 'bull' || agent === 'bear')) patch.text = ''
      return patchAgent(s, agent, patch)
    }

    case 'token': {
      const text = String(ev.text ?? '')
      const next = { ...s, tokenCount: s.tokenCount + 1 }
      if (!isAgent(agent)) return next
      const withAgent = patchAgent(next, agent, { text: next.agents[agent].text + text })
      if (typeof ev.turn === 'string' && (agent === 'bull' || agent === 'bear')) {
        return patchTurn(withAgent, ev.turn, (turn) => ({ ...turn, text: turn.text + text }))
      }
      return withAgent
    }

    case 'token_reset': {
      if (!isAgent(agent)) return s
      const cleared = patchAgent(s, agent, { text: '' })
      if (typeof ev.turn === 'string') return patchTurn(cleared, ev.turn, (turn) => ({ ...turn, text: '' }))
      return cleared
    }

    case 'agent_data':
      if (!isAgent(agent)) return s
      return patchAgent(s, agent, { data: { ...(s.agents[agent].data ?? {}), ...(ev.data as Record<string, unknown>) } })

    case 'agent_output': {
      const data = ev.data as Record<string, unknown>
      if (agent === 'evidence') return { ...s, ledger: (data.ledger as Evidence[]) ?? [] }
      if (agent === 'risk') return patchAgent({ ...s, risk: data as unknown as RiskOutput }, 'risk', { output: data })
      if (!isAgent(agent)) return s
      return patchAgent(s, agent, { output: data })
    }

    case 'debate_turn_start': {
      const turn: Turn = {
        id: String(ev.turn),
        round: Number(ev.round),
        side: ev.side as 'bull' | 'bear',
        text: '',
        citations: [],
        invalid_citations: [],
        streaming: true,
      }
      return { ...s, turns: [...s.turns.filter((x) => x.id !== turn.id), turn] }
    }

    case 'debate_turn_end': {
      const done = ev.turn as Omit<Turn, 'streaming'>
      return patchTurn(s, done.id, () => ({ ...done, streaming: false }))
    }

    case 'verdict':
      return { ...s, verdict: ev.decision as Verdict }

    case 'trade':
      return { ...s, trade: ev.result as TradeResult }

    case 'node': {
      const node = String(ev.node)
      if (ev.phase === 'start') return { ...s, nodes: [...s.nodes, { node, start: t, end: null, ms: null }] }
      const idx = s.nodes.map((n) => n.node === node && n.end == null).lastIndexOf(true)
      if (idx < 0) return s
      const nodes = s.nodes.slice()
      nodes[idx] = { ...nodes[idx], end: t, ms: typeof ev.ms === 'number' ? ev.ms : null }
      return { ...s, nodes }
    }

    case 'tool_call': {
      const call: ToolCall = {
        agent: String(agent ?? ''),
        tool: String(ev.tool),
        args: (ev.args as Record<string, unknown>) ?? {},
        result: ev.result,
        ms: Number(ev.ms ?? 0),
        t,
      }
      return { ...s, tools: [...s.tools, call] }
    }

    case 'notice': {
      const n: Notice = { level: (ev.level as Notice['level']) ?? 'info', message: String(ev.message), t }
      return { ...s, notices: [...s.notices, n] }
    }

    case 'error':
      return { ...s, status: 'error', error: String(ev.message ?? 'Unknown error') }

    case 'done':
      return {
        ...s,
        status: ev.status === 'ok' ? 'done' : 'error',
        totalMs: typeof ev.total_ms === 'number' ? ev.total_ms : s.totalMs,
        llmMode: (ev.llm_mode as string) ?? s.llmMode,
        elapsed: typeof ev.total_ms === 'number' ? ev.total_ms / 1000 : s.elapsed,
      }

    default:
      return s
  }
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.kind) {
    case 'start':
      return { ...initialRun, agents: freshAgents(), status: 'running', ticker: action.ticker }
    case 'event':
      return applyEvent(state, action.ev)
    case 'fail':
      return { ...state, status: 'error', error: action.message }
    case 'tick':
      return state.status === 'running' ? { ...state, elapsed: action.elapsed } : state
  }
}
