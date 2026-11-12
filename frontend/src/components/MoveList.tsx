import { ROOT, mainline } from '../moveTree'
import type { MoveNode, MoveTree } from '../moveTree'

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  'Best Move': { label: '!', className: 'great' },
  'Good Move': { label: '★', className: 'best' },
  'Inaccuracy': { label: '?!', className: 'inaccuracy' },
  'Mistake': { label: '?', className: 'mistake' },
  'Blunder': { label: '??', className: 'blunder' }
}

function MoveBadge({ classification }: { classification?: string }) {
  if (!classification || !BADGE_CONFIG[classification]) return null
  const { label, className } = BADGE_CONFIG[classification]
  return <span className={`tag ${className}`} title={classification}>{label}</span>
}

interface MoveRow {
  turnNumber: number
  white?: MoveNode
  black?: MoveNode
}

// Pairs consecutive moves into numbered rows; a line starting with Black leaves the first White cell empty.
function toRows(moves: MoveNode[]): MoveRow[] {
  const rows: MoveRow[] = []
  for (const move of moves) {
    const turnNumber = Math.floor(move.ply / 2) + 1
    const last = rows[rows.length - 1]
    if (move.ply % 2 === 0) {
      rows.push({ turnNumber, white: move })
    } else if (last && last.turnNumber === turnNumber && !last.black) {
      last.black = move
    } else {
      rows.push({ turnNumber, black: move })
    }
  }
  return rows
}

interface MoveListProps {
  tree: MoveTree
  cursorId: string
  // Classifications stay hidden while a training game is running.
  showBadges: boolean
  onSelect: (id: string) => void
}

export default function MoveList({ tree, cursorId, showBadges, onSelect }: MoveListProps) {
  const moveButton = (move?: MoveNode) => (
    <button
      className={move && move.id === cursorId ? 'selected-move' : undefined}
      onClick={() => move && onSelect(move.id)}
    >
      {move && (
        <>
          <b>{move.san}</b>
          {showBadges && <MoveBadge classification={move.analysis?.classification} />}
        </>
      )}
    </button>
  )

  return (
    <div className="moves">
      <button className="start-move" onClick={() => onSelect(ROOT)}>
        JOGO INICIADO
      </button>

      {toRows(mainline(tree)).map(row => (
        <div className="move-row" key={row.turnNumber}>
          <span className="move-number">{String(row.turnNumber).padStart(2, '0')}</span>
          {moveButton(row.white)}
          {moveButton(row.black)}
        </div>
      ))}
    </div>
  )
}
