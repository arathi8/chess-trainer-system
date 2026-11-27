import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import type { MouseEvent } from 'react'
import { splitPgn } from '../pgnLinks'
import type { PgnMoveRef } from '../pgnLinks'

// How many moves of a sequence can be played on the game's tree (0: none, shown as plain text).
export type PgnPlayable = (startPly: number, sans: string[]) => number

// Minimal shape of the HTML tree (hast) react-markdown builds, for the plugin below.
interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

// Left as written: code blocks (the prompt shown by the prompt-only provider) and headings, where a
// link would clash with the heading's own style.
const PLAIN_TAGS = new Set(['pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

// Wraps each move of the PGN sequences found in text nodes in a <span data-pgn-*>, rendered as a link
// by the `span` component below.
function rehypePgnMoves() {
  const visit = (node: HastNode) => {
    if (!node.children || PLAIN_TAGS.has(node.tagName ?? '')) return
    node.children = node.children.flatMap(child => {
      if (child.type !== 'text') {
        visit(child)
        return [child]
      }
      return splitPgn(child.value ?? '').map((segment): HastNode =>
        segment.move
          ? {
              type: 'element',
              tagName: 'span',
              properties: {
                dataPgnPly: segment.move.startPly,
                dataPgnLine: segment.move.sans.join(' '),
                dataPgnIndex: segment.move.index
              },
              children: [{ type: 'text', value: segment.text }]
            }
          : { type: 'text', value: segment.text }
      )
    })
  }
  return (tree: HastNode) => visit(tree)
}

// A click does not leave the link focused: Enter would replay it while the arrow keys navigate.
const keepFocusOff = (event: MouseEvent) => event.preventDefault()

interface CoachMarkdownProps {
  text: string
  playable: PgnPlayable
  // Plays the sequence up to the clicked move and shows that position.
  onPlayMove: (move: PgnMoveRef) => void
}

// The coach's Markdown, with the moves it cites in PGN notation as links to their positions.
export default function CoachMarkdown({ text, playable, onPlayMove }: CoachMarkdownProps) {
  const components: Components = {
    span: ({ node, children, ...props }) => {
      const line = node?.properties?.dataPgnLine
      if (typeof line !== 'string') return <span {...props}>{children}</span>

      const move: PgnMoveRef = {
        startPly: Number(node?.properties?.dataPgnPly),
        sans: line.split(' '),
        index: Number(node?.properties?.dataPgnIndex)
      }
      // A move past what the game's tree can play stays plain text.
      if (move.index >= playable(move.startPly, move.sans)) return <span>{children}</span>

      return (
        <button
          type="button"
          className="pgn-move"
          title="Ver esta posição no tabuleiro"
          onMouseDown={keepFocusOff}
          onClick={() => onPlayMove(move)}
        >
          {children}
        </button>
      )
    }
  }

  return (
    <ReactMarkdown rehypePlugins={[rehypePgnMoves]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
