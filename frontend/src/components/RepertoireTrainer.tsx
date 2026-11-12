import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import type { Arrow } from 'react-chessboard'
import Modal from './Modal'
import type { GameStats } from './GameReport'
import { fetchEngineMove, fetchGameStats, fetchMoveAnalysis, fetchRepertoireTree } from '../repertoire/api'
import type { AnalysedMove, MoveAnalysis, RepertoireNode, RepertoireTree } from '../repertoire/api'
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
import { cloneGame, moveNumberLabel, moveToUci, plyFromFen } from '../chess/utils'
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

const COUNT_ROWS: { key: string; label: string; className: string }[] = [
  { key: 'Best Move', label: 'Melhor lance', className: 'great' },
  { key: 'Good Move', label: 'Bom lance', className: 'best' },
  { key: 'Inaccuracy', label: 'Imprecisão', className: 'inaccuracy' },
  { key: 'Mistake', label: 'Erro', className: 'mistake' },
  { key: 'Blunder', label: 'Erro grave', className: 'blunder' }
]

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

// The game played against Stockfish once theory ends.
interface Playout {
  // Plies played inside theory; later moves are highlighted in the move list.
  theoryPlies: number
  finished: boolean
  result: string | null
  stats: GameStats | null
  statsLoading: boolean
  statsMessage: string | null
}

const emptyStats = (): SessionStats => ({ userMoves: 0, firstTry: 0, linesCompleted: 0, errors: {} })

const ucisOf = (path: RepertoireNode[]) => path.slice(1).map(node => node.uci as string)

const fmtEval = (evaluation: string) => evaluation.replace(' pawns', '').replace('Mate in', 'Mate em').replace(' moves', '')

function describeResult(game: Chess, color: 'white' | 'black', stopped: boolean): string {
  if (game.isCheckmate()) {
    const loserIsWhite = game.turn() === 'w'
    return loserIsWhite === (color === 'white') ? 'Xeque-mate: você perdeu' : 'Xeque-mate: você venceu!'
  }
  if (game.isStalemate()) return 'Empate por afogamento'
  if (game.isThreefoldRepetition()) return 'Empate por repetição'
  if (game.isInsufficientMaterial()) return 'Empate por material insuficiente'
  if (game.isDraw()) return 'Empate'
  return stopped ? 'Partida encerrada por você' : 'Partida encerrada'
}

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
  const [playout, setPlayout] = useState<Playout | null>(null)
  const [engineThinking, setEngineThinking] = useState(false)

  const evalRequestRef = useRef(0)
  // Latest position, read by async engine replies (state captured in their closures would be stale).
  const gameRef = useRef(game)
  // Bumped whenever a play-out starts or is abandoned, so replies and stats from an old one are dropped.
  const playoutRunRef = useRef(0)
  // Run id of the play-out that has ended; its late engine replies are ignored.
  const finishedRunRef = useRef(-1)
  const playoutAnalysesRef = useRef<Map<number, AnalysedMove>>(new Map())
  const pendingAnalysesRef = useRef<Set<Promise<void>>>(new Set())

  useEffect(() => {
    gameRef.current = game
  }, [game])

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
  const userToMoveInPlayout = (game.turn() === 'w') === (color === 'white')

  const startLine = (repeat: string[] | null) => {
    if (!tree) return
    playoutRunRef.current++
    setEngineThinking(false)
    setForcedLine(repeat)
    setGame(new Chess())
    setPath([tree.tree])
    setAttempts(0)
    setPending(null)
    setPendingEval(null)
    setDeviation(null)
    setPlayout(null)
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

  // --- play-out: the game against Stockfish after theory ---

  const storeAnalysis = (move: Move, analysis: MoveAnalysis) => {
    const ply = plyFromFen(move.before)
    playoutAnalysesRef.current.set(ply, { ...analysis, ply, san: move.san })
  }

  // Classifies one of the user's play-out moves without blocking the game.
  const analyseInBackground = (move: Move) => {
    const run = playoutRunRef.current
    const task = fetchMoveAnalysis(move.before, moveToUci(move))
      .then(analysis => {
        if (playoutRunRef.current === run) storeAnalysis(move, analysis)
      })
      .catch(err => console.error('Play-out analysis error:', err))
    pendingAnalysesRef.current.add(task)
    task.finally(() => pendingAnalysesRef.current.delete(task))
  }

  const finishPlayout = async (finalGame: Chess, stopped: boolean) => {
    const run = playoutRunRef.current
    finishedRunRef.current = run
    setEngineThinking(false)
    setPlayout(prev => prev && {
      ...prev,
      finished: true,
      result: describeResult(finalGame, color, stopped),
      statsLoading: true,
      statsMessage: null
    })

    await Promise.allSettled([...pendingAnalysesRef.current])
    if (playoutRunRef.current !== run) return

    const moves = [...playoutAnalysesRef.current.values()].sort((a, b) => a.ply - b.ply)
    if (moves.length === 0) {
      setPlayout(prev => prev && { ...prev, statsLoading: false, statsMessage: 'Nenhum lance seu fora da teoria foi analisado.' })
      return
    }
    try {
      // Only the user's moves after theory are analysed, so the accuracy covers exactly those.
      const gameStats = await fetchGameStats({
        user_color: color,
        pgn: finalGame.pgn(),
        moves,
        total_user_moves: moves.length
      })
      if (playoutRunRef.current !== run) return
      setPlayout(prev => prev && { ...prev, stats: gameStats, statsLoading: false })
    } catch (err) {
      console.error('Play-out stats error:', err)
      if (playoutRunRef.current === run) {
        setPlayout(prev => prev && { ...prev, statsLoading: false, statsMessage: 'Não foi possível calcular a precisão.' })
      }
    }
  }

  const requestEngineMove = async (fen: string) => {
    const run = playoutRunRef.current
    setEngineThinking(true)
    try {
      const { engine_move } = await fetchEngineMove(fen)
      // Dropped when the play-out was abandoned or ended ("Encerrar partida") while the engine thought.
      if (playoutRunRef.current !== run || finishedRunRef.current === run) return
      const next = cloneGame(gameRef.current)
      next.move({
        from: engine_move.slice(0, 2) as Square,
        to: engine_move.slice(2, 4) as Square,
        promotion: (engine_move[4] || 'q') as 'q' | 'r' | 'b' | 'n'
      })
      setGame(next)
      setEngineThinking(false)
      if (next.isGameOver()) finishPlayout(next, false)
    } catch (err) {
      console.error('Engine move error:', err)
      if (playoutRunRef.current === run) {
        setEngineThinking(false)
        setPlayout(prev => prev && { ...prev, statsMessage: 'O Stockfish não respondeu. Verifique o servidor e tente encerrar a partida.' })
      }
    }
  }

  // Starts the game against Stockfish from `fromGame`; the engine moves first when it is its turn.
  const enterPlayout = (fromGame: Chess, theoryPlies: number) => {
    playoutRunRef.current++
    playoutAnalysesRef.current = new Map()
    setPlayout({ theoryPlies, finished: false, result: null, stats: null, statsLoading: false, statsMessage: null })
    setPhase('playout')
    if (fromGame.isGameOver()) {
      finishPlayout(fromGame, false)
    } else if ((fromGame.turn() === 'w') !== (color === 'white')) {
      requestEngineMove(fromGame.fen())
    }
  }

  // --- drill input ---

  const onDrop = (from: Square, to: Square): boolean => {
    if (phase === 'playout') return onPlayoutDrop(from, to)
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

  const onPlayoutDrop = (from: Square, to: Square): boolean => {
    if (!playout || playout.finished || engineThinking || !userToMoveInPlayout) return false
    const next = cloneGame(game)
    let move: Move
    try {
      move = next.move({ from, to, promotion: 'q' })
    } catch {
      return false
    }
    setGame(next)
    analyseInBackground(move)
    if (next.isGameOver()) finishPlayout(next, false)
    else requestEngineMove(next.fen())
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

  // "Yes": keep the move and play on against Stockfish from there.
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
    gameRef.current = pending.game
    const theoryPlies = path.length - 1
    const doneEval = pendingEval?.status === 'done' ? pendingEval.analysis : null
    setPending(null)
    setPendingEval(null)
    enterPlayout(pending.game, theoryPlies)
    // The deviating move is the first play-out move: reuse its evaluation when it already arrived.
    if (doneEval) storeAnalysis(pending.move, doneEval)
    else analyseInBackground(pending.move)
  }

  const playFromHere = () => enterPlayout(game, path.length - 1)

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

  const shownGame = pending ? pending.game : game
  const linesSeen = completed.size
  const canDrag =
    (phase === 'drill' && userTurn && !pending) ||
    (phase === 'playout' && !!playout && !playout.finished && !engineThinking && userToMoveInPlayout)

  // Move list of the current game, two plies per row; moves after theory are highlighted.
  const theoryPlies = playout?.theoryPlies ?? null
  const rows: { number: number; white?: { san: string; offBook: boolean }; black?: { san: string; offBook: boolean } }[] = []
  shownGame.history().forEach((san, i) => {
    const entry = { san, offBook: theoryPlies !== null ? i >= theoryPlies : pending !== null && i === shownGame.history().length - 1 }
    if (i % 2 === 0) rows.push({ number: i / 2 + 1, white: entry })
    else rows[rows.length - 1].black = entry
  })

  const errorsList = Object.values(stats.errors).sort((a, b) => b.count - a.count).slice(0, MAX_LISTED_ERRORS)
  const firstTryRate = stats.userMoves > 0 ? Math.round((stats.firstTry / stats.userMoves) * 100) : null

  const stageTitle = {
    drill: userTurn ? 'Sua vez: jogue o lance da teoria' : 'O oponente responde...',
    'line-complete': 'Fim da teoria: escolha como continuar',
    playout: playout?.finished
      ? playout.result ?? 'Partida encerrada'
      : engineThinking ? 'Stockfish pensando...' : 'Sua vez · partida contra o Stockfish',
    summary: 'Resumo do treino'
  }[phase]

  const playoutPanel = playout && (
    <div className="repertoire-coach">
      <span className="eyebrow small">PARTIDA CONTRA O STOCKFISH</span>
      {!playout.finished && (
        <>
          <p className="message">
            {deviation
              ? <>Você saiu da teoria com <b>{deviation.label}</b>. A partida segue a partir daqui: mova as peças no tabuleiro.</>
              : <>A teoria terminou. A partida segue a partir daqui: mova as peças no tabuleiro.</>}
          </p>
          <p className="message system">
            Os lances em dourado na lista estão fora da teoria. Ao encerrar, você vê a precisão desses lances.
          </p>
          {playout.statsMessage && <div className="report-error"><p>⚠️ {playout.statsMessage}</p></div>}
          <div className="repertoire-actions">
            <button className="outline-btn full" onClick={() => finishPlayout(gameRef.current, true)}>Encerrar partida</button>
            <button className="outline-btn full" onClick={() => startLine(null)}>Voltar ao treino de linhas</button>
          </div>
        </>
      )}
      {playout.finished && (
        <>
          <p className="message"><b>{playout.result}</b></p>
          {playout.statsLoading && <p className="message system">Calculando a precisão dos seus lances...</p>}
          {playout.statsMessage && <p className="message system">{playout.statsMessage}</p>}
          {playout.stats && (
            <>
              <div className="report-accuracy">
                <span>Precisão fora da teoria</span>
                <b>{playout.stats.accuracy !== null ? `${playout.stats.accuracy}%` : '—'}</b>
                <small>{playout.stats.analysed_moves} {playout.stats.analysed_moves === 1 ? 'lance seu analisado' : 'lances seus analisados'}</small>
              </div>
              <div className="report-counts">
                {COUNT_ROWS.map(row => (
                  <div key={row.key}>
                    <span className={`tag ${row.className}`}>{playout.stats?.classification_counts[row.key] ?? 0}</span>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="repertoire-actions">
            <button className="primary-action full" onClick={() => startLine(null)}>Voltar ao treino de linhas</button>
            <button className="outline-btn full" onClick={() => setPhase('summary')}>Ver resumo da sessão</button>
          </div>
        </>
      )}
    </div>
  )

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
                <button disabled className={row.white?.offBook ? 'offbook-move' : undefined}>
                  <b>{row.white?.san}</b>
                </button>
                <button disabled className={row.black?.offBook ? 'offbook-move' : undefined}>
                  {row.black && <b>{row.black.san}</b>}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="center-stage">
          <div className="stage-head">
            <div>
              <span className="eyebrow small">
                APRENDER REPERTÓRIO · {phase === 'playout' ? 'FORA DA TEORIA' : opening.eco}
              </span>
              <h1>{stageTitle}</h1>
            </div>
          </div>

          <div className="board-wrap">
            <div className="chessboard-container">
              <Chessboard
                options={{
                  position: shownGame.fen(),
                  boardOrientation: color,
                  allowDragging: canDrag,
                  squareStyles,
                  arrows,
                  onPieceDrop: ({ sourceSquare, targetSquare }) =>
                    Boolean(targetSquare) && onDrop(sourceSquare as Square, targetSquare as Square)
                }}
              />
            </div>
          </div>

          {phase === 'line-complete' && (
            <div className="repertoire-continue">
              <p>Você chegou ao fim da teoria conhecida{reached ? <> de <b>{reached.name}</b></> : null}. Como quer continuar?</p>
              <div>
                <button className="primary-action" onClick={playFromHere}>Jogar a partir daqui contra o Stockfish</button>
                <button className="outline-btn" onClick={() => startLine(null)}>Próxima linha</button>
                <button className="outline-btn" onClick={() => startLine(ucisOf(path))}>Repetir esta linha</button>
              </div>
            </div>
          )}

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
                  Linha concluída{reached ? <>: <b>{reached.name}</b></> : null}.
                </p>
                <p className="message system">
                  {linesSeen >= totalLines
                    ? `Você já percorreu todas as ${totalLines} linhas desta abertura. Continue repetindo para fixar.`
                    : `${linesSeen} de ${totalLines} linhas percorridas nesta sessão.`}
                </p>
                <p className="message system">Escolha abaixo do tabuleiro como continuar.</p>
              </div>
            )}

            {phase === 'playout' && playoutPanel}

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

                {playout?.finished && (
                  <div className="report-opening">
                    <span>PARTIDA FORA DA TEORIA</span>
                    <b>{playout.result}</b>
                    {playout.stats?.accuracy != null && <small>Precisão dos seus lances: {playout.stats.accuracy}%</small>}
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
          description={`${moveNumberLabel(node.ply)} ${pending.move.san} não faz parte da teoria de ${reached?.name ?? opening.name}. Quer sair da teoria e continuar a partida contra o Stockfish a partir daqui?`}
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
            <button className="outline-btn full" onClick={leaveTheory}>Sim, jogar contra o Stockfish daqui</button>
          </div>
        </Modal>
      )}
    </main>
  )
}
