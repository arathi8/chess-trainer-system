import { Chess } from 'chess.js'
import type { Move } from 'chess.js'

// Half-move index of the side to move in a FEN: 0 = White's first move.
export const plyFromFen = (fen: string): number => {
  const [, turn, , , , fullmove] = fen.split(' ')
  return (Number(fullmove) - 1) * 2 + (turn === 'b' ? 1 : 0)
}

// Copies a game with its move history (new Chess(fen) would keep only the position, so the
// final PGN would lose the opening moves and start from a FEN).
export function cloneGame(game: Chess): Chess {
  const copy = new Chess()
  copy.loadPgn(game.pgn())
  return copy
}

// UCI string of a chess.js move, the format the backend and the repertoire tree use.
export const moveToUci = (move: Move): string => `${move.from}${move.to}${move.promotion ?? ''}`

// '12.' for White's move at ply 22, '12...' for Black's at ply 23 (0-based ply of the move).
export const moveNumberLabel = (ply: number): string => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`

// ['Be3', 'e5', 'Nb3'] from ply 10 -> '6. Be3 e5 7. Nb3'; a line starting on Black's move gets '6... '.
export function formatMoves(sans: string[], firstPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = firstPly + i
      if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`
      return i === 0 ? `${moveNumberLabel(ply)} ${san}` : san
    })
    .join(' ')
}
