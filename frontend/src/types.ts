export type AgentKey = 'market' | 'news' | 'fundamentals' | 'bull' | 'bear' | 'risk' | 'pm'
export type AgentStatus = 'idle' | 'thinking' | 'waiting' | 'done' | 'error' | 'skipped'
export type Decision = 'BUY' | 'HOLD' | 'SELL'
export type Lean = 'bullish' | 'bearish' | 'neutral'
export type LlmSource = 'gemini' | 'offline' | 'none'

export interface LlmStatus {
  provider: string
  model: string
  state: 'online' | 'offline' | 'cooldown'
  reason: string | null
}

export interface Health {
  status: string
  demo_mode: boolean
  llm: LlmStatus
  knowledge_cutoff: string
  debate_rounds: number
  initial_cash: number
  disclaimer: string
}

export interface Indicators {
  as_of: string
  last_close: number
  prev_close: number
  change_pct: number
  rsi14: number | null
  sma20: number | null
  sma50: number | null
  sma20_above_sma50: boolean
  price_trend: string
  macd: number | null
  macd_signal: number | null
  macd_hist: number | null
  macd_recent_cross: string
  volume_last: number | null
  volume_avg20: number | null
  volume_spike_ratio: number | null
  high_52w: number | null
  low_52w: number | null
  pct_from_52w_high: number | null
  pct_from_52w_low: number | null
  return_1m_pct: number | null
  return_6m_pct: number | null
  volatility_ann_pct: number | null
  sessions_analysed: number
}

export interface ChartPoint {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  sma20: number | null
  sma50: number | null
}

export interface ChartData {
  ticker: string
  yahoo: string
  company: string
  source: string
  series: ChartPoint[]
  indicators: Indicators
}

export interface Headline {
  title: string
  source: string
  published: string | null
  link?: string | null
  score?: number
  reason?: string
}

export interface NewsOutput {
  headlines: Headline[]
  aggregate: { score: number; label: string; count: number; positive: number; negative: number; neutral: number }
  summary: string
  query: string
  data_source: string
  llm: LlmSource
}

export interface FundamentalsOutput {
  name: string | null
  sector: string | null
  industry: string | null
  metrics: Record<string, number | null>
  missing: string[]
  judgement: { valuation: 'cheap' | 'fair' | 'expensive'; reasons: string[]; summary: string }
  data_source: string
  llm: LlmSource
}

export interface MarketOutput {
  indicators: Indicators
  interpretation: string
  data_source: string
  llm: LlmSource
}

export interface Evidence {
  id: string
  source: 'market' | 'news' | 'fundamentals'
  label: string
  detail: string
  lean: Lean
  weight: number
}

export interface Turn {
  id: string
  round: number
  side: 'bull' | 'bear'
  text: string
  citations: string[]
  invalid_citations: string[]
  llm?: LlmSource
  streaming: boolean
}

export interface RiskFlag {
  round: number
  side: 'bull' | 'bear'
  issue: string
  severity: 'low' | 'medium' | 'high'
  origin: 'auto' | 'llm'
}

export interface RiskOutput {
  flags: RiskFlag[]
  max_position_pct: number
  volatility_cap_pct: number
  volatility_ann_pct: number | null
  risk_level: 'low' | 'medium' | 'high'
  notes: string
  llm: LlmSource
}

export interface Verdict {
  decision: Decision
  confidence: number
  position_size_pct: number
  rationale: string[]
  adjustments: string[]
  max_position_pct: number
  price: number
  price_date: string
  held_qty: number
  llm: LlmSource
}

export interface TradeRecord {
  id: number
  ts: string
  trade_date: string
  ticker: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  value: number
  run_id: string | null
  confidence: number | null
  note: string
}

export interface TradeResult {
  executed: boolean
  reason?: string
  trade?: TradeRecord
  portfolio?: PortfolioSnapshot
}

export interface Holding {
  ticker: string
  qty: number
  avg_cost: number
  last_price: number
  market_value: number
  unrealised_pnl: number
  unrealised_pct: number
  weight_pct: number
}

export interface PortfolioSnapshot {
  initial_cash: number
  cash: number
  invested: number
  total_value: number
  pnl: number
  pnl_pct: number
  realised_pnl: number
  holdings: Holding[]
  trade_count: number
}

export interface HistoryPoint {
  date: string
  portfolio: number
  nifty: number
  value: number
}

export interface ToolCall {
  agent: string
  tool: string
  args: Record<string, unknown>
  result: unknown
  ms: number
  t: number
}

export interface NodeSpan {
  node: string
  start: number
  end: number | null
  ms: number | null
}

export interface Notice {
  level: 'info' | 'warn' | 'error'
  message: string
  t: number
}

export interface AgentState {
  status: AgentStatus
  text: string
  llm?: LlmSource
  output?: unknown
  data?: Record<string, unknown>
  message?: string
  startedAt?: number
  endedAt?: number
  round?: number
}

export interface RunMeta {
  run_id: string
  ticker: string
  yahoo: string
  company: string
  mode: string
  rounds: number
  price: number
  price_date: string
  data_source: string
  llm: LlmStatus
  demo_mode: boolean
}

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error'
  ticker: string | null
  meta: RunMeta | null
  agents: Record<AgentKey, AgentState>
  turns: Turn[]
  ledger: Evidence[]
  risk: RiskOutput | null
  verdict: Verdict | null
  trade: TradeResult | null
  nodes: NodeSpan[]
  tools: ToolCall[]
  notices: Notice[]
  eventCount: number
  tokenCount: number
  totalMs: number | null
  llmMode: string | null
  error: string | null
  elapsed: number
}

// SSE event (loosely typed: the reducer narrows on `type`)
export interface QuorumEvent {
  type: string
  agent?: string
  t?: number
  [key: string]: unknown
}

export interface StrategyResult {
  key: string
  name: string
  n: number
  hit_rate: number | null
  avg_return_pct: number | null
  counts: Record<Decision, number> | null
  hit_rate_p5?: number
  hit_rate_p95?: number
}

export interface EvalRow {
  ticker: string
  as_of?: string
  exit_date?: string
  entry?: number
  exit?: number
  fwd_return: number | null
  agent: Decision | null
  confidence?: number
  rsi?: number | null
  rsi_rule?: Decision
  llm_mode?: string
  note: string | null
}

export interface EvalParams {
  as_of: string
  horizon: number
  tickers: string[]
  knowledge_cutoff: string
  include_fundamentals: boolean
  debate_rounds: number
  hold_band_pct: number
  llm: LlmStatus
}

export interface EvalResults {
  id?: number
  ts?: string
  params: EvalParams
  strategies: StrategyResult[]
  rows: EvalRow[]
}

export interface EvalConfig {
  knowledge_cutoff: string
  min_as_of: string
  max_as_of: string | null
  default_as_of: string | null
  default_horizon: number
  tickers: string[]
  debate_rounds: number
  hold_band_pct: number
  llm: LlmStatus
  demo_mode: boolean
}
