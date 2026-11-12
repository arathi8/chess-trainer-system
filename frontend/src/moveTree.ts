import type { Chess, Move } from 'chess.js'

// Engine evaluation of one position, as returned by /api/engine-analysis.
export interface PositionAnalysis {
  fen: string
  best_move: string
  evaluation: string
  depth: number
  line: string
}

export interface MoveAnalysis {
  classification: string
  delta: number
  before: PositionAnalysis
  after: PositionAnalysis
}

export interface MoveNode {
  id: string
  parentId: string
  // 0-based half-move index: even = a White move.
  ply: number
  san: string
  uci: string
  from: string
  to: string
  fenBefore: string
  fen: string
  analysis?: MoveAnalysis
}

// The game as a tree of moves. children[id][0] continues the line `id` belongs to (the mainline,
// from the root); later children are variations branching off at that point.
export interface MoveTree {
  startFen: string
  nodes: Record<string, MoveNode>
  children: Record<string, string[]>
  nextId: number
}

// Id of the starting position, before any move.
export const ROOT = 'root'

export function createTree(startFen: string): MoveTree {
  return { startFen, nodes: {}, children: { [ROOT]: [] }, nextId: 1 }
}

export function plyFromFen(fen: string): number {
  const [, turn, , , , fullmove] = fen.split(' ')
  return (Number(fullmove) - 1) * 2 + (turn === 'b' ? 1 : 0)
}

export function moveUci(move: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

// Adds `move` after `parentId`, or returns the existing child when that move was already played there.
export function addMove(tree: MoveTree, parentId: string, move: Move): { tree: MoveTree; id: string } {
  const uci = moveUci(move)
  const siblings = tree.children[parentId] ?? []
  const existing = siblings.find(id => tree.nodes[id].uci === uci)
  if (existing) return { tree, id: existing }

  const id = String(tree.nextId)
  const node: MoveNode = {
    id,
    parentId,
    ply: plyFromFen(move.before),
    san: move.san,
    uci,
    from: move.from,
    to: move.to,
    fenBefore: move.before,
    fen: move.after
  }
  return {
    id,
    tree: {
      ...tree,
      nodes: { ...tree.nodes, [id]: node },
      children: { ...tree.children, [parentId]: [...siblings, id], [id]: [] },
      nextId: tree.nextId + 1
    }
  }
}

export function treeFromGame(game: Chess): MoveTree {
  const moves = game.history({ verbose: true })
  let tree = createTree(moves[0]?.before ?? game.fen())
  let parentId = ROOT
  for (const move of moves) {
    ;({ tree, id: parentId } = addMove(tree, parentId, move))
  }
  return tree
}

export function setAnalysis(tree: MoveTree, id: string, analysis: MoveAnalysis): MoveTree {
  const node = tree.nodes[id]
  if (!node) return tree
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...node, analysis } } }
}

export function fenAt(tree: MoveTree, id: string): string {
  return id === ROOT ? tree.startFen : tree.nodes[id].fen
}

export function parentOf(tree: MoveTree, id: string): string | null {
  return id === ROOT ? null : tree.nodes[id].parentId
}

export function firstChild(tree: MoveTree, id: string): string | null {
  return tree.children[id]?.[0] ?? null
}

// Follows the main continuation from `id` to the end of its line.
export function lineEnd(tree: MoveTree, id: string): string {
  let current = id
  for (let next = firstChild(tree, current); next; next = firstChild(tree, current)) {
    current = next
  }
  return current
}

// The moves of the main continuation starting at `id` (inclusive).
export function lineFrom(tree: MoveTree, id: string): MoveNode[] {
  const line: MoveNode[] = []
  for (let current: string | null = id; current; current = firstChild(tree, current)) {
    line.push(tree.nodes[current])
  }
  return line
}

export function mainline(tree: MoveTree): MoveNode[] {
  const first = firstChild(tree, ROOT)
  return first ? lineFrom(tree, first) : []
}

export function moveNumberLabel(ply: number): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`
}

export type Navigation = 'first' | 'previous' | 'next' | 'last'

// Where each navigation control leads from `id`. "last" ends the current line, so in a variation
// it stays in the variation; on the mainline it is the latest move.
export function navigate(tree: MoveTree, id: string, action: Navigation): string {
  switch (action) {
    case 'first':
      return ROOT
    case 'previous':
      return parentOf(tree, id) ?? id
    case 'next':
      return firstChild(tree, id) ?? id
    case 'last':
      return lineEnd(tree, id)
  }
}
