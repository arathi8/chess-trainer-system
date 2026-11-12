import { API_BASE_URL } from '../api'
import type { GameStats } from '../components/GameReport'
import type { LLMConfig } from '../llmConfig'

export type Color = 'white' | 'black'

// Mirrors RepertoireOpening / RepertoireFamily in chess_trainer_system_server.py.
export interface RepertoireOpening {
  name: string
  eco: string
  reference_line: string
  lines: number
  default_color: Color
}

export interface RepertoireFamily extends RepertoireOpening {
  variations: RepertoireOpening[]
}

// Mirrors RepertoireNode: san/uci are null only on the root (starting position).
export interface RepertoireNode {
  san: string | null
  uci: string | null
  fen: string
  ply: number
  popularity: number
  opening: { eco: string; name: string } | null
  // Most mainstream first; empty at the end of a line
  children: RepertoireNode[]
}

export interface RepertoireTree {
  name: string
  eco: string
  reference_line: string
  lines: number
  tree: RepertoireNode
}

// Mirrors EngineAnalysisResponse (/api/engine-analysis). Evaluations are from White's point of view.
export interface PositionAnalysis {
  fen: string
  best_move: string
  evaluation: string
  depth: number
  line: string
}

export interface MoveAnalysis {
  before_move_analysis: PositionAnalysis
  after_move_analysis: PositionAnalysis
  move_classification: string
  move_delta: number
}

async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail ?? `HTTP error: ${response.status}`)
  }
  return data as T
}

const getJson = <T>(path: string) => requestJson<T>(path)

// Stockfish evaluation of one move (two depth-20 searches, a few seconds).
export const fetchMoveAnalysis = (fen: string, move: string): Promise<MoveAnalysis> =>
  requestJson<MoveAnalysis>('/engine-analysis', { fen, move })

// Stockfish's reply. Training mode: varied replies and lenient on early mistakes (see engine_service).
export const fetchEngineMove = (fen: string): Promise<{ engine_move: string; grace_applied: boolean }> =>
  requestJson('/engine-move', { fen, training: true })

// One analysed user move, in the shape /api/game-stats expects (ply is 0-based: even = White).
export interface AnalysedMove extends MoveAnalysis {
  ply: number
  san: string
}

// --- LLM coach (BYOK settings travel with each request, as in the rest of the app) ---

export const fetchOpeningIntro = (name: string, color: Color, llm: LLMConfig | null): Promise<string> =>
  requestJson<{ intro: string }>('/repertoire/intro', { name, color, ...llm }).then(data => data.intro)

// `moves`: UCI moves from the starting position up to and including the move to explain.
export const fetchTheoryExplanation = (
  name: string,
  color: Color,
  moves: string[],
  llm: LLMConfig | null
): Promise<string> =>
  requestJson<{ explanation: string }>('/repertoire/explain-move', { name, color, moves, ...llm })
    .then(data => data.explanation)

export const fetchGameStats = (payload: {
  user_color: Color
  pgn: string
  moves: AnalysedMove[]
  total_user_moves: number
}): Promise<GameStats> => requestJson<{ stats: GameStats }>('/game-stats', payload).then(data => data.stats)

export async function fetchRepertoireCatalog(): Promise<RepertoireFamily[]> {
  const data = await getJson<{ families: RepertoireFamily[] }>('/repertoire/catalog')
  return data.families
}

export function fetchRepertoireTree(name: string): Promise<RepertoireTree> {
  return getJson<RepertoireTree>(`/repertoire/tree?name=${encodeURIComponent(name)}`)
}
