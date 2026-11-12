// Pure drill logic over the repertoire theory tree: no React, no I/O.
import type { Color, RepertoireNode } from './api'

// Identifies a node by the UCI moves leading to it from the root ('' for the root).
export const pathKey = (ucis: string[]): string => ucis.join(' ')

const childKey = (key: string, child: RepertoireNode): string => (key ? `${key} ${child.uci}` : child.uci ?? '')

// Side to move at a node: node.ply counts the moves already played.
export const sideToMove = (node: RepertoireNode): Color => (node.ply % 2 === 0 ? 'white' : 'black')

export const isUserTurn = (node: RepertoireNode, color: Color): boolean => sideToMove(node) === color

// A node without children is the end of a theoretical line.
export const isLineEnd = (node: RepertoireNode): boolean => node.children.length === 0

// Any theoretical continuation counts as correct; children are sorted most mainstream first.
export const expectedMoves = (node: RepertoireNode): RepertoireNode[] => node.children

export type MoveVerdict = { kind: 'theory'; child: RepertoireNode } | { kind: 'off-book' }

export function classifyUserMove(node: RepertoireNode, uci: string): MoveVerdict {
  const child = node.children.find(c => c.uci === uci)
  return child ? { kind: 'theory', child } : { kind: 'off-book' }
}

// Keys of every line end under `node`.
export function leafKeys(node: RepertoireNode, key: string): string[] {
  if (isLineEnd(node)) return [key]
  return node.children.flatMap(child => leafKeys(child, childKey(key, child)))
}

export const countLines = (root: RepertoireNode): number => leafKeys(root, '').length

// Whether every line through this node has already been completed in the session.
export const isExhausted = (node: RepertoireNode, key: string, completed: ReadonlySet<string>): boolean =>
  leafKeys(node, key).every(leaf => completed.has(leaf))

// Children whose lines are not all completed yet, falling back to all children.
function freshChildren(node: RepertoireNode, key: string, completed: ReadonlySet<string>): RepertoireNode[] {
  const fresh = node.children.filter(child => !isExhausted(child, childKey(key, child), completed))
  return fresh.length > 0 ? fresh : node.children
}

/**
 * The opponent's reply: a forced move when repeating a line, otherwise a random theoretical move
 * weighted by popularity, preferring branches with lines not yet completed (session coverage).
 */
export function pickOpponentMove(
  node: RepertoireNode,
  key: string,
  completed: ReadonlySet<string>,
  forcedUci: string | null = null,
  rng: () => number = Math.random
): RepertoireNode | null {
  if (isLineEnd(node)) return null
  const forced = forcedUci ? node.children.find(c => c.uci === forcedUci) : undefined
  if (forced) return forced

  const pool = freshChildren(node, key, completed)
  const weights = pool.map(child => Math.max(1, child.popularity))
  let r = rng() * weights.reduce((sum, w) => sum + w, 0)
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r < 0) return pool[i]
  }
  return pool[pool.length - 1]
}

// The theoretical move a hint points to: the most popular one leading to lines not seen yet.
export const hintMove = (node: RepertoireNode, key: string, completed: ReadonlySet<string>): RepertoireNode | null =>
  freshChildren(node, key, completed)[0] ?? null

// One theoretical line of the tree, from the starting position to a line end.
export interface LineInfo {
  key: string
  ucis: string[]
  sans: string[]
  // Deepest named opening along the line (normally the name the line ends with)
  opening: { eco: string; name: string } | null
}

// Every line of the tree, in tree order (most mainstream first).
export function listLines(root: RepertoireNode): LineInfo[] {
  const lines: LineInfo[] = []
  const walk = (node: RepertoireNode, path: RepertoireNode[]) => {
    if (isLineEnd(node) && path.length > 0) {
      const ucis = path.map(n => n.uci as string)
      lines.push({ key: pathKey(ucis), ucis, sans: path.map(n => n.san as string), opening: deepestOpening(path) })
      return
    }
    node.children.forEach(child => walk(child, [...path, child]))
  }
  walk(root, [])
  return lines
}

export interface LineGroup {
  name: string
  lines: (LineInfo & { done: boolean })[]
  done: number
}

/**
 * The name one level below the trained opening, used to group its lines: under "Sicilian Defense",
 * "Sicilian Defense: Najdorf Variation, English Attack" groups as "Sicilian Defense: Najdorf Variation";
 * under the Najdorf, as "... Najdorf Variation, English Attack". The opening itself groups as itself.
 */
export function subOpeningName(name: string, openingName: string): string {
  if (!name.startsWith(openingName) || name === openingName) return name
  const rest = name.slice(openingName.length)
  return openingName + rest[0] + rest.slice(1).split(',')[0]
}

// Lines grouped one level below the trained opening, groups in order of their first (most mainstream) line.
export function groupLines(lines: LineInfo[], completed: ReadonlySet<string>, openingName: string): LineGroup[] {
  const groups = new Map<string, LineGroup>()
  for (const line of lines) {
    const name = subOpeningName(line.opening?.name ?? openingName, openingName)
    const group = groups.get(name) ?? { name, lines: [], done: 0 }
    const done = completed.has(line.key)
    group.lines.push({ ...line, done })
    if (done) group.done += 1
    groups.set(name, group)
  }
  return [...groups.values()]
}

// Name of the deepest named line reached along the path, e.g. "Sicilian Defense: Najdorf Variation".
export function deepestOpening(path: RepertoireNode[]): { eco: string; name: string } | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].opening) return path[i].opening
  }
  return null
}
