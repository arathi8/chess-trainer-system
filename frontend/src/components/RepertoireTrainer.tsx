import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { Arrow } from 'react-chessboard'
import Modal from './Modal'
import { fetchMoveAnalysis, fetchRepertoireTree } from '../repertoire/api'
import type { MoveAnalysis, RepertoireNode, RepertoireTree } from '../repertoire/api'
import {
  classifyUserMove,
  countLines,
  deepestOpening,
  expectedMoves,
  hintMove,
  isLineEnd,
  isUserTurn,
  pathKey,
  pickOpponentMove
} from '../repertoire/drill'
import { cloneGame, moveNumberLabel, moveToUci } from '../chess/utils'
import type { RepertoireSelection } from './RepertoirePicker'

type Phase = 'drill' | 'line-complete' | 'playout' | 'summary'

// Delay before the opponent's theoretical reply, so the user sees their own move land first.
const OPPONENT_DELAY_MS = 450
const MAX_LISTED_ERRORS = 5

const CLASSIFICATION_LABELS: Record<string, string> = {
  'Best Move': 'melhor lance',
  'Good Move': 'bom lance',
  Inaccuracy: 'imprecisão',
  Mistake: 'erro',
  Blunder: 'erro grave'
}

interface PendingOffBook {
  game: Chess
  move: Move
  // Identifies the evaluation request, so a late answer for an older move is ignored.
  id: number
}

type PendingEval =
  | { status: 'loading' }
  | { status: 'done'; analysis: MoveAnalysis }
  | { status: 'error' }

interface MoveError {
  label: string
  expected: string[]
  count: number
}

interface Deviation {
  label: string
  played: string
  theory: string[]
  opening: string | null
}

interface SessionStats {
  userMoves: number
  firstTry: number
  linesCompleted: number
  errors: Record<string, MoveError>
}

const emptyStats = (): SessionStats => ({ userMoves: 0, firstTry: 0, linesCompleted: 0, errors: {} })

const ucisOf = (path: RepertoireNode[]) => path.slice(1).map(node => node.uci as string)

const fmtEval = (evaluation: string) => evaluation.replace(' pawns', '').replace('Mate in', 'Mate em').replace(' moves', '')

interface RepertoireTrainerProps {
  selection: RepertoireSelection
  onChangeOpening: () => void
  onBackHome: () => void
}

export default function RepertoireTrainer({ selection, onChangeOpening, onBackHome }: RepertoireTrainerProps) {
  const { opening, color } = selection
  const [tree, setTree] = useState<RepertoireTree | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('drill')
  const [game, setGame] = useState(() => new Chess())
  const [path, setPath] = useState<RepertoireNode[]>([])
  // Wrong answers (or hints asked) at the current position: 1 highlights the piece, 2+ draws the arrow.
  const [attempts, setAttempts] = useState(0)
  const [completed, setCompleted] = useState<Set<string>>(() => new Set())
  // When repeating a line, the opponent replays these moves.
  const [forcedLine, setForcedLine] = useState<string[] | null>(null)
  const [pending, setPending] = useState<PendingOffBook | null>(null)
  const [pendingEval, setPendingEval] = useState<PendingEval | null>(null)
  const [stats, setStats] = useState<SessionStats>(emptyStats)
  const [deviation, setDeviation] = useState<Deviation | null>(null)

  const evalRequestRef = useRef(0)

  useEffect(() => {
    fetchRepertoireTree(opening.name)
      .then(data => {
        setTree(data)
        setPath([data.tree])
      })
      .catch(err => {
        console.error('Repertoire tree error:', err)
        setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar a teoria desta abertura.')
      })
  }, [opening.name])

  const node = path[path.length - 1] as RepertoireNode | undefined
  const key = pathKey(ucisOf(path))
  const totalLines = useMemo(() => (tree ? countLines(tree.tree) : 0), [tree])
  const reached = deepestOpening(path)
  const userTurn = Boolean(node && isUserTurn(node, color))

  const startLine = (repeat: string[] | null) => {
    if (!tree) return
    setForcedLine(repeat)
    setGame(new Chess())
    setPath([tree.tree])
    setAttempts(0)
    setPending(null)
    setPendingEval(null)
    setPhase('drill')
  }

  // Plays a theoretical move (either side's) and detects the end of the line.
  const advance = (child: RepertoireNode) => {
    const next = cloneGame(game)
    next.move(child.san as string)
    const nextPath = [...path, child]
    setGame(next)
    setPath(nextPath)
    setAttempts(0)

    if (isLineEnd(child)) {
      const leaf = pathKey(ucisOf(nextPath))
      setCompleted(prev => new Set(prev).add(leaf))
      setStats(prev => ({ ...prev, linesCompleted: prev.linesCompleted + 1 }))
      setPhase('line-complete')
    }
  }

  // The opponent replies with theory on its own turn.
  useEffect(() => {
    if (phase !== 'drill' || !node || pending || userTurn || isLineEnd(node)) return
    const timer = setTimeout(() => {
      const forced = forcedLine?.[path.length - 1] ?? null
      const reply = pickOpponentMove(node, key, completed, forced)
      if (reply) advance(reply)
    }, OPPONENT_DELAY_MS)
    return () => clearTimeout(timer)
    // advance reads the same state listed here; re-running on these changes is what schedules each reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, node, pending, userTurn, key, completed, forcedLine])

  const recordError = () => {
    if (!node) return
    const expected = expectedMoves(node).map(child => child.san as string)
    setStats(prev => {
      const current = prev.errors[key]
      return {
        ...prev,
        errors: {
          ...prev.errors,
          [key]: { label: moveNumberLabel(node.ply), expected, count: (current?.count ?? 0) + 1 }
        }
      }
    })
  }

  const onDrop = (from: Square, to: Square): boolean => {
    if (phase === 'playout') return false // phase 5: the game against Stockfish
    if (phase !== 'drill' || !node || pending || !userTurn || isLineEnd(node)) return false

    const next = cloneGame(game)
    let move: Move
    try {
      move = next.move({ from, to, promotion: 'q' })
    } catch {
      return false // illegal
    }

    const verdict = classifyUserMove(node, moveToUci(move))
    if (verdict.kind === 'theory') {
      setStats(prev => ({
        ...prev,
        userMoves: prev.userMoves + 1,
        firstTry: prev.firstTry + (attempts === 0 ? 1 : 0)
      }))
      advance(verdict.child)
      return true
    }

    // Off-book: keep the move on the board and ask before leaving theory.
    const id = ++evalRequestRef.current
    setPending({ game: next, move, id })
    setPendingEval({ status: 'loading' })
    fetchMoveAnalysis(game.fen(), moveToUci(move))
      .then(analysis => {
        if (evalRequestRef.current === id) setPendingEval({ status: 'done', analysis })
      })
      .catch(err => {
        console.error('Off-book evaluation error:', err)
        if (evalRequestRef.current === id) setPendingEval({ status: 'error' })
      })
    return true
  }

  // "No": undo the move and guide the user back to theory.
  const stayInTheory = () => {
    evalRequestRef.current++
    setPending(null)
    setPendingEval(null)
    setAttempts(a => a + 1)
    recordError()
  }

  // "Yes": keep the move and continue the game from there.
  const leaveTheory = () => {
    if (!pending || !node) return
    evalRequestRef.current++
    setDeviation({
      label: `${moveNumberLabel(node.ply)} ${pending.move.san}`,
      played: pending.move.san,
      theory: expectedMoves(node).map(child => child.san as string),
      opening: reached?.name ?? null
    })
    setStats(prev => ({ ...prev, userMoves: prev.userMoves + 1 }))
    setGame(pending.game)
    setPending(null)
    setPendingEval(null)
    setPhase('playout')
  }

  const askHint = () => {
    setAttempts(a => a + 1)
    recordError()
  }

  // Hint visuals for the user's turn in the drill.
  const hint = phase === 'drill' && node && userTurn && !pending && attempts > 0 ? hintMove(node, key, completed) : null
  const hintFrom = hint?.uci?.slice(0, 2)
  const squareStyles: Record<string, CSSProperties> =
    hint && hintFrom ? { [hintFrom]: { boxShadow: 'inset 0 0 0 4px #e8c887', background: '#e8c88740' } } : {}
  const arrows: Arrow[] =
    hint?.uci && attempts >= 2 ? [{ startSquare: hint.uci.slice(0, 2), endSquare: hint.uci.slice(2, 4), color: '#e8c887' }] : []

  const boardFen = pending ? pending.game.fen() : game.fen()
  const linesSeen = completed.size

  // Move list of the current line, two plies per row.
  const rows: { number: number; white?: string; black?: string }[] = []
  ;(pending ? [...path.slice(1).map(n => n.san as string), pending.move.san] : path.slice(1).map(n => n.san as string))
    .forEach((san, i) => {
      if (i % 2 === 0) rows.push({ number: i / 2 + 1, white: san })
      else rows[rows.length - 1].black = san
    })

  const errorsList = Object.values(stats.errors).sort((a, b) => b.count - a.count).slice(0, MAX_LISTED_ERRORS)
  const firstTryRate = stats.userMoves > 0 ? Math.round((stats.firstTry / stats.userMoves) * 100) : null

  const stageTitle = {
    drill: userTurn ? 'Sua vez: jogue o lance da teoria' : 'O oponente responde...',
    'line-complete': 'Linha concluída',
    playout: 'Fora da teoria',
    summary: 'Resumo do treino'
  }[phase]

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand compact" onClick={onBackHome}>
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </button>
        <div className="top-actions">
          {phase !== 'summary' && tree && (
            <button className="outline-btn" onClick={() => setPhase('summary')}>Encerrar treino</button>
          )}
          <button className="outline-btn" onClick={onChangeOpening}>Trocar abertura</button>
        </div>
      </header>

      <div className="game-layout">
        <aside className="history-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow small">LINHA ATUAL</span>
              <h2>{reached?.name ?? opening.name}</h2>
            </div>
          </div>
          <div className="moves">
            {rows.map(row => (
              <div className="move-row" key={row.number}>
                <span className="move-number">{String(row.number).padStart(2, '0')}</span>
                <button disabled><b>{row.white}</b></button>
                <button disabled>{row.black && <b>{row.black}</b>}</button>
              </div>
            ))}
          </div>
        </aside>

        <section className="center-stage">
          <div className="stage-head">
            <div>
              <span className="eyebrow small">APRENDER REPERTÓRIO · {opening.eco}</span>
              <h1>{stageTitle}</h1>
            </div>
          </div>

          <div className="board-wrap">
            <div className="chessboard-container">
              <Chessboard
                options={{
                  position: boardFen,
                  boardOrientation: color,
                  allowDragging: phase === 'drill' && userTurn && !pending,
                  squareStyles,
                  arrows,
                  onPieceDrop: ({ sourceSquare, targetSquare }) =>
                    Boolean(targetSquare) && onDrop(sourceSquare as Square, targetSquare as Square)
                }}
              />
            </div>
          </div>

          {loadError && <div className="report-error"><p>⚠️ {loadError}</p></div>}
          {!tree && !loadError && <p className="message system">Carregando a teoria...</p>}
        </section>

        <aside className="chat-panel">
          <div className="chat-head">
            <div className="bot-avatar">A</div>
            <div>
              <b>Treinador de repertório</b>
              <span>
                Você joga com as {color === 'white' ? 'brancas' : 'pretas'} · {linesSeen} de {totalLines} linhas
              </span>
            </div>
          </div>

          <div className="chat-content">
            {phase === 'drill' && node && (
              <div className="repertoire-coach">
                {userTurn ? (
                  <>
                    <p className="message">
                      {expectedMoves(node).length === 1
                        ? 'Há 1 lance teórico nesta posição.'
                        : `Há ${expectedMoves(node).length} lances teóricos nesta posição; qualquer um deles vale.`}
                    </p>
                    {attempts === 1 && hint && (
                      <p className="message system">Dica: a peça destacada é a que se move na linha principal.</p>
                    )}
                    {attempts >= 2 && hint && (
                      <p className="message system">A seta mostra o lance: {hint.san}. Jogue-o para continuar.</p>
                    )}
                    {attempts < 2 && (
                      <button className="outline-btn full" onClick={askHint}>
                        {attempts === 0 ? 'Mostrar dica' : 'Mostrar o lance'}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="message system">O oponente está escolhendo uma resposta teórica...</p>
                )}
              </div>
            )}

            {phase === 'line-complete' && (
              <div className="repertoire-coach">
                <p className="message">
                  Você chegou ao fim da linha{reached ? <> <b>{reached.name}</b></> : null}.
                </p>
                <p className="message system">
                  {linesSeen >= totalLines
                    ? `Você já percorreu todas as ${totalLines} linhas desta abertura. Continue repetindo para fixar.`
                    : `${linesSeen} de ${totalLines} linhas percorridas nesta sessão.`}
                </p>
                <div className="repertoire-actions">
                  <button className="primary-action full" onClick={() => startLine(null)}>Próxima linha</button>
                  <button className="outline-btn full" onClick={() => startLine(ucisOf(path))}>Repetir esta linha</button>
                  <button className="outline-btn full" onClick={() => setPhase('playout')}>Jogar a partir daqui</button>
                </div>
              </div>
            )}

            {phase === 'playout' && (
              <div className="repertoire-coach">
                <p className="message">
                  {deviation
                    ? <>Você saiu da teoria com <b>{deviation.label}</b>. A partida contra o Stockfish a partir desta posição chega na próxima etapa do desenvolvimento.</>
                    : 'A partida contra o Stockfish a partir desta posição chega na próxima etapa do desenvolvimento.'}
                </p>
                <div className="repertoire-actions">
                  <button className="primary-action full" onClick={() => startLine(null)}>Voltar ao treino de linhas</button>
                  <button className="outline-btn full" onClick={() => setPhase('summary')}>Ver resumo</button>
                </div>
              </div>
            )}

            {phase === 'summary' && (
              <div className="repertoire-coach">
                <span className="eyebrow small">RESUMO DA SESSÃO</span>
                <div className="report-accuracy">
                  <span>Acertos de primeira</span>
                  <b>{firstTryRate !== null ? `${firstTryRate}%` : '—'}</b>
                  <small>{stats.firstTry} de {stats.userMoves} lances seus · {stats.linesCompleted} linhas concluídas · {linesSeen} de {totalLines} linhas diferentes</small>
                </div>

                {errorsList.length > 0 && (
                  <div className="report-moments">
                    <span className="eyebrow small">ONDE VOCÊ MAIS ERROU</span>
                    {errorsList.map(error => (
                      <div key={error.label + error.expected.join()} className="repertoire-error">
                        <b>{error.label} {error.expected.join(' / ')}</b>
                        <span>{error.count} {error.count === 1 ? 'erro ou dica' : 'erros ou dicas'}</span>
                      </div>
                    ))}
                  </div>
                )}

                {deviation && (
                  <div className="report-opening">
                    <span>SAÍDA DA TEORIA</span>
                    <b>{deviation.label}</b>
                    <small>Teoria nesta posição: {deviation.theory.join(', ')}{deviation.opening ? ` (${deviation.opening})` : ''}.</small>
                  </div>
                )}

                <div className="repertoire-actions">
                  <button className="primary-action full" onClick={() => startLine(null)}>Continuar treinando</button>
                  <button className="outline-btn full" onClick={onChangeOpening}>Trocar abertura</button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {pending && node && (
        <Modal
          eyebrow="FORA DA TEORIA"
          title="Sair da teoria?"
          description={`${moveNumberLabel(node.ply)} ${pending.move.san} não faz parte da teoria de ${reached?.name ?? opening.name}. Quer sair da teoria e continuar a partida a partir daqui?`}
          onCancel={stayInTheory}
        >
          <div className="repertoire-offbook">
            <p>
              Teoria nesta posição: <b>{expectedMoves(node).map(child => child.san).join(', ')}</b>
            </p>
            {pendingEval?.status === 'loading' && <p className="message system">Stockfish avaliando seu lance...</p>}
            {pendingEval?.status === 'error' && <p className="message system">Avaliação do Stockfish indisponível.</p>}
            {pendingEval?.status === 'done' && (
              <p>
                Stockfish (ponto de vista das brancas): {fmtEval(pendingEval.analysis.before_move_analysis.evaluation)} antes,{' '}
                {fmtEval(pendingEval.analysis.after_move_analysis.evaluation)} depois do seu lance
                {' '}({CLASSIFICATION_LABELS[pendingEval.analysis.move_classification] ?? pendingEval.analysis.move_classification},
                {' '}−{pendingEval.analysis.move_delta}% de chance de vitória).
              </p>
            )}
          </div>
          <div className="repertoire-actions">
            <button className="primary-action full" onClick={stayInTheory}>Não, quero seguir a teoria</button>
            <button className="outline-btn full" onClick={leaveTheory}>Sim, sair da teoria</button>
          </div>
        </Modal>
      )}
    </main>
  )
}
