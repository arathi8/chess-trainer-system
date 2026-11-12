import { useEffect, useState } from 'react'
import { DEFAULT_POSITION } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { fetchRepertoireTree } from '../repertoire/api'
import type { RepertoireNode, RepertoireTree } from '../repertoire/api'
import type { RepertoireSelection } from './RepertoirePicker'

interface RepertoireTrainerProps {
  selection: RepertoireSelection
  onChangeOpening: () => void
  onBackHome: () => void
}

const countPositions = (node: RepertoireNode): number =>
  node.children.reduce((sum, child) => sum + 1 + countPositions(child), 0)

// Loads the theory tree of the chosen opening. The drill itself (phase 3) builds on this screen.
export default function RepertoireTrainer({ selection, onChangeOpening, onBackHome }: RepertoireTrainerProps) {
  const { opening, color } = selection
  const [tree, setTree] = useState<RepertoireTree | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRepertoireTree(opening.name)
      .then(setTree)
      .catch(err => {
        console.error('Repertoire tree error:', err)
        setError(err instanceof Error ? err.message : 'Não foi possível carregar a teoria desta abertura.')
      })
  }, [opening.name])

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand compact" onClick={onBackHome}>
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </button>
        <div className="top-actions">
          <button className="outline-btn" onClick={onChangeOpening}>Trocar abertura</button>
        </div>
      </header>

      <section className="center-stage">
        <div className="stage-head">
          <div>
            <span className="eyebrow small">APRENDER REPERTÓRIO · {opening.eco}</span>
            <h1>{opening.name}</h1>
          </div>
        </div>

        <div className="board-wrap">
          <div className="chessboard-container">
            <Chessboard
              options={{
                position: tree?.tree.fen ?? DEFAULT_POSITION,
                boardOrientation: color,
                allowDragging: false
              }}
            />
          </div>
        </div>

        {error && <div className="report-error"><p>⚠️ {error}</p></div>}
        {!tree && !error && <p className="message system">Carregando a teoria...</p>}
        {tree && (
          <p className="message system">
            Teoria carregada: {tree.lines} {tree.lines === 1 ? 'linha' : 'linhas'}, {countPositions(tree.tree)} lances
            na árvore. Você joga com as {color === 'white' ? 'brancas' : 'pretas'}. O treino das linhas chega na próxima etapa.
          </p>
        )}
      </section>
    </main>
  )
}
