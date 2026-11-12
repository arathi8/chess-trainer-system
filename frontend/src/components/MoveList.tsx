import { ROOT, lineFrom, mainline, moveNumberLabel, variationsAt } from '../moveTree'
import type { MoveNode, MoveTree } from '../moveTree'

// Once classified, a move's text takes the colour of its classification, followed by the usual
// annotation glyph ("Nd4?!"), so the class also reads without the colour.
const CLASSIFICATIONS: Record<string, { glyph: string; className: string }> = {
  'Best Move': { glyph: '!', className: 'move-best' },
  'Good Move': { glyph: '', className: 'move-good' },
  'Inaccuracy': { glyph: '?!', className: 'move-inaccuracy' },
  'Mistake': { glyph: '?', className: 'move-mistake' },
  'Blunder': { glyph: '??', className: 'move-blunder' }
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
  // Classifications stay hidden while a training game is running.
  const classification = (move: MoveNode) =>
    showBadges && move.analysis ? CLASSIFICATIONS[move.analysis.classification] : undefined

  const moveClass = (move: MoveNode) =>
    [classification(move)?.className, move.id === cursorId && 'selected-move'].filter(Boolean).join(' ') || undefined

  const moveTitle = (move: MoveNode) => (classification(move) ? move.analysis?.classification : undefined)

  const rowCell = (move: MoveNode | undefined, filler: boolean) => (
    <button className={move && moveClass(move)} title={move && moveTitle(move)} onClick={() => move && onSelect(move.id)}>
      {move ? <b>{move.san}{classification(move)?.glyph}</b> : filler && <span className="ellipsis">…</span>}
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
          <button className={moveClass(move)} title={moveTitle(move)} onClick={() => onSelect(move.id)}>
            {label}{move.san}{classification(move)?.glyph}
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
