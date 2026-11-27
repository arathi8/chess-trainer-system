import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import { ROOT, fenAt, mainline, plyFromFen } from './moveTree'
import type { MoveTree } from './moveTree'

// Moves the coach writes in PGN notation ("14. Nxe5 dxe5 15. Qh5", "14... Nf6") become links that
// play them on the board. This module finds those sequences in the text and resolves them against
// the game's move tree.

// One move of a sequence found in the text: the sequence starts at `startPly` (0-based, even = a
// White move) and the move is `sans[index]`.
export interface PgnMoveRef {
  startPly: number
  sans: string[]
  index: number
}

export type PgnSegment = { text: string; move?: PgnMoveRef }

const SAN = String.raw`(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?`
// "14." for White; "14...", "14…" or "14. ..." for Black.
const NUMBER = String.raw`(\d+)\s*(\.\s*\.\.\.|\.\s*…|\.\.\.|…|\.)`
// A sequence starts with a numbered move, not inside a word or a decimal number.
const SEQUENCE_START = new RegExp(String.raw`(?<![\w.])${NUMBER}\s*(${SAN})(?![\w-])`, 'g')
// Each next move, optionally preceded by its number; the previous one may carry an annotation ("!?").
const NEXT_MOVE = new RegExp(String.raw`[!?]{0,2}\s+(?:${NUMBER}\s*)?(${SAN})(?![\w-])`, 'y')

const plyOf = (moveNumber: string, dots: string) => (Number(moveNumber) - 1) * 2 + (dots === '.' ? 0 : 1)
const normalizeSan = (san: string) => san.replace(/0-0-0/, 'O-O-O').replace(/0-0/, 'O-O')

// Splits text into plain parts and the moves of the PGN sequences in it.
export function splitPgn(text: string): PgnSegment[] {
  const segments: PgnSegment[] = []
  let cursor = 0

  for (const start of text.matchAll(SEQUENCE_START)) {
    if (start.index < cursor) continue
    const startPly = plyOf(start[1], start[2])
    const moves: { san: string; from: number; to: number }[] = []
    const firstSan = start[3]
    const firstEnd = start.index + start[0].length
    moves.push({ san: firstSan, from: firstEnd - firstSan.length, to: firstEnd })

    // Extend the sequence while the next tokens are moves whose numbers (if any) fit the count.
    let end = firstEnd
    for (;;) {
      NEXT_MOVE.lastIndex = end
      const next = NEXT_MOVE.exec(text)
      if (!next) break
      if (next[1] && plyOf(next[1], next[2]) !== startPly + moves.length) break
      const nextEnd = next.index + next[0].length
      moves.push({ san: next[3], from: nextEnd - next[3].length, to: nextEnd })
      end = nextEnd
    }

    const sans = moves.map(move => normalizeSan(move.san))
    moves.forEach((move, index) => {
      if (move.from > cursor) segments.push({ text: text.slice(cursor, move.from) })
      segments.push({ text: text.slice(move.from, move.to), move: { startPly, sans, index } })
      cursor = move.to
    })
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

// Where a sequence starts in the tree, and its moves that are legal from there.
export interface ResolvedLine {
  parentId: string
  moves: Move[]
}

function pathTo(tree: MoveTree, id: string | undefined): string[] {
  const path: string[] = []
  for (let current = id; current && current !== ROOT; current = tree.nodes[current]?.parentId) path.push(current)
  return path
}

function legalPrefix(fen: string, sans: string[]): Move[] {
  const game = new Chess(fen)
  const moves: Move[] = []
  for (const san of sans) {
    try {
      moves.push(game.move(san))
    } catch {
      break
    }
  }
  return moves
}

// Finds the position a sequence starts from: one reached at `startPly`, looked for first on the line
// leading to `contextId` (the move being discussed), then on the mainline, then anywhere in the tree.
// The position where most of the sequence is legal wins; null if not even its first move is.
export function resolvePgnLine(tree: MoveTree, startPly: number, sans: string[], contextId?: string): ResolvedLine | null {
  const reachesStart = (id: string) =>
    id === ROOT ? plyFromFen(tree.startFen) === startPly : tree.nodes[id].ply + 1 === startPly

  const ordered = [...pathTo(tree, contextId), ...mainline(tree).map(node => node.id), ROOT, ...Object.keys(tree.nodes)]
  const candidates = [...new Set(ordered)].filter(reachesStart)

  let best: ResolvedLine | null = null
  for (const parentId of candidates) {
    const moves = legalPrefix(fenAt(tree, parentId), sans)
    if (moves.length > (best?.moves.length ?? 0)) best = { parentId, moves }
    if (moves.length === sans.length) break
  }
  return best
}

// How many moves of a sequence the tree can play, for deciding which moves become links. Rendering
// asks for every move of every sequence, so the answers are kept per tree (trees are immutable: a
// change makes a new one, and the old cache goes with it).
const playableCache = new WeakMap<MoveTree, Map<string, number>>()

export function playableMoves(tree: MoveTree, startPly: number, sans: string[], contextId?: string): number {
  let cache = playableCache.get(tree)
  if (!cache) playableCache.set(tree, (cache = new Map()))
  const key = `${contextId ?? ''}|${startPly}|${sans.join(' ')}`
  let count = cache.get(key)
  if (count === undefined) {
    count = resolvePgnLine(tree, startPly, sans, contextId)?.moves.length ?? 0
    cache.set(key, count)
  }
  return count
}
