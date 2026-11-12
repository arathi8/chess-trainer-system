import { ROOT, lineFrom, mainline, moveNumberLabel, variationsAt } from '../moveTree'
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

type HistoryItem =
  | { kind: 'row'; turnNumber: number; white?: MoveNode; black?: MoveNode; interrupted?: boolean }
  | { kind: 'variations'; after: MoveNode; starts: MoveNode[] }

// Lays the mainline out in numbered rows, as lichess does. A move with variations closes its row,
// the variations follow as a block, and the line resumes on a new row ("…" fills the gaps).
function toHistoryItems(tree: MoveTree): HistoryItem[] {
  const items: HistoryItem[] = []
  let row: Extract<HistoryItem, { kind: 'row' }> | null = null

  for (const move of mainline(tree)) {
    const turnNumber = Math.floor(move.ply / 2) + 1
    if (move.ply % 2 === 1 && row && row.turnNumber === turnNumber && !row.black) {
      row.black = move
    } else {
      row = move.ply % 2 === 0 ? { kind: 'row', turnNumber, white: move } : { kind: 'row', turnNumber, black: move }
      items.push(row)
    }

    const starts = variationsAt(tree, move)
    if (starts.length > 0) {
      if (!row.black) row.interrupted = true
      items.push({ kind: 'variations', after: move, starts })
      row = null
    }
  }
  return items
}

interface MoveListProps {
  tree: MoveTree
  cursorId: string
  // Classifications stay hidden while a training game is running.
  showBadges: boolean
  onSelect: (id: string) => void
}

export default function MoveList({ tree, cursorId, showBadges, onSelect }: MoveListProps) {
  const isSelected = (move: MoveNode) => (move.id === cursorId ? 'selected-move' : undefined)
  const badge = (move: MoveNode) => showBadges && <MoveBadge classification={move.analysis?.classification} />

  const rowCell = (move: MoveNode | undefined, filler: boolean) => (
    <button className={move && isSelected(move)} onClick={() => move && onSelect(move.id)}>
      {move ? <><b>{move.san}</b>{badge(move)}</> : filler && <span className="ellipsis">…</span>}
    </button>
  )

  // One line of a variation, inline: "1... c5 2. Nf3 (2. c3 d5) 2... d6". White moves carry their
  // number; a Black move does too when it opens the line or follows a nested variation.
  const variationLine = (start: MoveNode) => {
    let numbered = true
    return lineFrom(tree, start.id).map(move => {
      const label = move.ply % 2 === 0 || numbered ? `${moveNumberLabel(move.ply)} ` : ''
      const nested = variationsAt(tree, move)
      numbered = nested.length > 0
      return (
        <span key={move.id} className="variation-move">
          <button className={isSelected(move)} onClick={() => onSelect(move.id)}>
            {label}{move.san}{badge(move)}
          </button>
          {nested.map(sub => (
            <span key={sub.id} className="variation-nested">({variationLine(sub)})</span>
          ))}
        </span>
      )
    })
  }

  return (
    <div className="moves">
      <button className={`start-move${cursorId === ROOT ? ' selected-move' : ''}`} onClick={() => onSelect(ROOT)}>
        JOGO INICIADO
      </button>

      {toHistoryItems(tree).map(item =>
        item.kind === 'row' ? (
          <div className="move-row" key={`row-${(item.white ?? item.black)!.id}`}>
            <span className="move-number">{String(item.turnNumber).padStart(2, '0')}</span>
            {rowCell(item.white, true)}
            {rowCell(item.black, Boolean(item.interrupted))}
          </div>
        ) : (
          <div className="variation" key={`variations-${item.after.id}`}>
            {item.starts.map(start => (
              <div className="variation-line" key={start.id}>{variationLine(start)}</div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
