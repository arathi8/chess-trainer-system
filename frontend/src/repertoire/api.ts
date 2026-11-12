import { API_BASE_URL } from '../api'

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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail ?? `HTTP error: ${response.status}`)
  }
  return data as T
}

export async function fetchRepertoireCatalog(): Promise<RepertoireFamily[]> {
  const data = await getJson<{ families: RepertoireFamily[] }>('/repertoire/catalog')
  return data.families
}

export function fetchRepertoireTree(name: string): Promise<RepertoireTree> {
  return getJson<RepertoireTree>(`/repertoire/tree?name=${encodeURIComponent(name)}`)
}
