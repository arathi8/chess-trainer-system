import { useState, useRef, useEffect, useCallback } from 'react'
import type { Move } from 'chess.js'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import LLMSettings from './LLMSettings'
import GameReport from './GameReport'
import MoveList from './MoveList'
import BoardControls from './BoardControls'
import type { CoachReport, GameStats } from './GameReport'
import { API_BASE_URL } from '../api'
import type { LLMConfig } from '../llmConfig'
import ReactMarkdown from 'react-markdown'
import { ROOT, addMove, fenAt, lineEnd, mainline, moveNumberLabel, navigate, plyFromFen, setAnalysis, treeFromGame } from '../moveTree'
import type { MoveAnalysis, MoveNode, MoveTree, Navigation } from '../moveTree'

type PlayerColor = 'white' | 'black'
// training: play Stockfish with feedback hidden until the end; review: analyse an imported PGN
export type GameMode = 'training' | 'review'

// Engine analyses running at once when analysing an imported game.
const IMPORT_ANALYSIS_CONCURRENCY = 2

interface GameBoardProps {
  initialGame?: Chess
  userColor: PlayerColor
  mode?: GameMode
  llmConfig: LLMConfig | null
  onLLMConfigChange: (config: LLMConfig | null) => void
  onNewGame: () => void
  onBackHome: () => void
}

type AnalysedNode = MoveNode & { analysis: MoveAnalysis }

const isAnalysed = (node: MoveNode): node is AnalysedNode => Boolean(node.analysis)

// The engine analysis of a move, in the shape /api/move-evaluation and /api/game-stats expect.
function toAnalysisPayload(node: AnalysedNode) {
  return {
    move_classification: node.analysis.classification,
    move_delta: node.analysis.delta,
    before_move_analysis: node.analysis.before,
    after_move_analysis: node.analysis.after
  }
}

// One analysed user move, in the shape /api/game-stats expects.
type ReportMove = { ply: number; san: string } & ReturnType<typeof toAnalysisPayload>

// What /api/game-report needs besides the BYOK settings; kept to retry the coach's report.
interface ReportContext {
  stats: GameStats
  result: string
  termination: string
  pgn: string
  lenient_plies: number[]
  imported: boolean
}

const MIN_MOVES_FOR_REPORT = 3

// Tints the origin and destination squares of the move on the board, as lichess does.
const LAST_MOVE_STYLE = { backgroundColor: 'rgba(155, 199, 0, 0.41)' }

const lastMoveStyles = (move?: MoveNode) =>
  move ? { [move.from]: LAST_MOVE_STYLE, [move.to]: LAST_MOVE_STYLE } : {}

function describeResult(game: Chess, termination: string, userColor: PlayerColor): { result: string; label: string } {
  if (termination === 'resignation') {
    return { result: userColor === 'white' ? '0-1' : '1-0', label: 'Você abandonou a partida' }
  }
  if (termination === 'checkmate') {
    const userLost = (game.turn() === 'w') === (userColor === 'white')
    return { result: game.turn() === 'w' ? '0-1' : '1-0', label: userLost ? 'Xeque-mate: você perdeu' : 'Xeque-mate: você venceu!' }
  }
  const drawLabels: Record<string, string> = {
    stalemate: 'Empate por afogamento',
    threefold_repetition: 'Empate por repetição',
    insufficient_material: 'Empate por material insuficiente',
    draw: 'Empate'
  }
  return { result: '1/2-1/2', label: drawLabels[termination] ?? 'Empate' }
}

function describeImportedResult(result?: string): string {
  const labels: Record<string, string> = {
    '1-0': 'Partida importada: vitória das brancas',
    '0-1': 'Partida importada: vitória das pretas',
    '1/2-1/2': 'Partida importada: empate'
  }
  return (result && labels[result]) || 'Partida importada'
}

// Player name from the PGN headers, ignoring the "?" placeholder.
function importedName(game: Chess, header: 'White' | 'Black', fallback: string): string {
  const name = game.getHeaders()[header]
  return name && name !== '?' ? name : fallback
}

// Copies a game with its move history (new Chess(fen) would keep only the position, so the
// final PGN would lose the opening moves and start from a FEN).
function cloneGame(game: Chess): Chess {
  const copy = new Chess()
  copy.loadPgn(game.pgn())
  return copy
}

function detectTermination(game: Chess): string {
  if (game.isCheckmate()) return 'checkmate'
  if (game.isStalemate()) return 'stalemate'
  if (game.isThreefoldRepetition()) return 'threefold_repetition'
  if (game.isInsufficientMaterial()) return 'insufficient_material'
  return 'draw'
}

export default function GameBoard({
  initialGame,
  userColor,
  mode = 'training',
  llmConfig,
  onLLMConfigChange,
  onNewGame,
  onBackHome
}: GameBoardProps) {
  const [game, setGame] = useState<Chess>(initialGame || new Chess())
  const [isEngineThinking, setIsEngineThinking] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)

  const isReview = mode === 'review'

  // Training game: feedback stays hidden until the game ends, then the report is shown.
  // An imported game starts in that post-game state.
  const [gameFinished, setGameFinished] = useState(isReview)
  const [resultLabel, setResultLabel] = useState(() =>
    isReview ? describeImportedResult(initialGame?.getHeaders().Result) : ''
  )
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  // Opponent moves still unclassified after the game (imported games, or failed analyses in training).
  const [opponentAnalysing, setOpponentAnalysing] = useState(false)
  const [stats, setStats] = useState<GameStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [coachReport, setCoachReport] = useState<CoachReport>({ text: null, error: null, loading: false })
  // Whether the user picked a move after the game ended: the coach does not open on the move
  // selected by default.
  const [movePicked, setMovePicked] = useState(false)
  const [reportMessage, setReportMessage] = useState<string | null>(null)

  // The game's moves, and the one shown on the board. The tree also lives in a ref: async work
  // (analyses, the report) must read its latest state, not the one of the render that started it.
  const [tree, setTree] = useState<MoveTree>(() => treeFromGame(initialGame ?? new Chess()))
  const treeRef = useRef(tree)
  const [cursorId, setCursorId] = useState(() => lineEnd(tree, ROOT))

  // The coach's explanations, per move; explainingId is the move being explained.
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explainingId, setExplainingId] = useState<string | null>(null)

  const gameRef = useRef<Chess>(game)
  gameRef.current = game

  const updateTree = (update: (current: MoveTree) => MoveTree) => {
    treeRef.current = update(treeRef.current)
    setTree(treeRef.current)
  }

  // The moves of the game itself: the start of the mainline. After the game, moves played past its
  // end extend the mainline for analysis, but take no part in the report.
  const gameMoves = () => mainline(treeRef.current).slice(0, gameRef.current.history().length)

  // Refs, not state: the report is assembled after async work, where state would be stale.
  const finishedRef = useRef(isReview)
  const pendingAnalysesRef = useRef<Set<Promise<void>>>(new Set())
  const lenientPliesRef = useRef<number[]>([])
  const reportContextRef = useRef<ReportContext | null>(null)
  const autoAnalysisStartedRef = useRef(false)
  const gameStartedRef = useRef(false)
  const moveCoachRef = useRef<HTMLDivElement>(null)
  // Set by a pick in the history: the coach is scrolled into view once the render has placed it.
  const scrollToCoachRef = useRef(false)

  // Plies are 0-based half-moves: even = White's moves.
  const isUserPly = (ply: number) => (ply % 2 === 0) === (userColor === 'white')

  // Appends a move of the running game; the board follows it unless the user is looking at an earlier move.
  const playMainlineMove = (move: Move): string => {
    const tip = lineEnd(treeRef.current, ROOT)
    let id = tip
    updateTree(current => {
      const added = addMove(current, tip, move)
      id = added.id
      return added.tree
    })
    setCursorId(cursor => (cursor === tip ? id : cursor))
    return id
  }

  // Classifies one move (either side's); the history badges stay hidden until the game ends.
  const requestEngineAnalysis = async (nodeId: string) => {
    const node = treeRef.current.nodes[nodeId]

    try {
      const response = await fetch(`${API_BASE_URL}/engine-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: node.fenBefore, move: node.uci })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      updateTree(current => setAnalysis(current, nodeId, {
        classification: data.move_classification,
        delta: data.move_delta,
        before: data.before_move_analysis,
        after: data.after_move_analysis
      }))
    } catch (err) {
      console.error('Classification error:', err)
    }
  }

  // Training game: each move is analysed while the game goes on, so the report only waits for the last ones.
  const analyseInBackground = (nodeId: string) => {
    const analysis = requestEngineAnalysis(nodeId)
    pendingAnalysesRef.current.add(analysis)
    analysis.finally(() => pendingAnalysesRef.current.delete(analysis))
  }

  const requestEngineMove = async (currentFen: string) => {
    setIsEngineThinking(true)

    try {
      const response = await fetch(`${API_BASE_URL}/engine-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: currentFen, training: true })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      // The player resigned while the engine was thinking.
      if (finishedRef.current) return

      // The engine went easy on the user's previous move: the report still counts it as an error.
      if (data.grace_applied) {
        lenientPliesRef.current.push(plyFromFen(currentFen) - 1)
      }

      if (data.engine_move) {
        const engineMove = data.engine_move
        const gameCopy = cloneGame(gameRef.current)
        const move = gameCopy.move({
          from: engineMove.slice(0, 2) as Square,
          to: engineMove.slice(2, 4) as Square,
          promotion: (engineMove[4] || 'q') as 'n' | 'b' | 'r' | 'q'
        })

        if (move) {
          setGame(gameCopy)
          analyseInBackground(playMainlineMove(move))
        }
      }

    } catch (err) {
      console.error('Engine move error:', err)
    } finally {
      setIsEngineThinking(false)
    }
  }

  const startGame = async () => {
    const currentGame = gameRef.current

    if (currentGame.isGameOver()) return

    const currentTurn: PlayerColor =
      currentGame.turn() === 'w' ? 'white' : 'black'

    // If it is not the player's turn, the engine must make the first move.
    if (currentTurn !== userColor) {
      await requestEngineMove(currentGame.fen())
    }
  }

  useEffect(() => {
    // Guard: StrictMode runs effects twice in dev, which would request two opening engine moves.
    if (isReview || gameStartedRef.current) return
    gameStartedRef.current = true
    startGame()
  }, [])

  // After the game the board is for analysis: a move played from any position opens a variation
  // there (or follows the one already played), and is classified like the game's moves.
  const playAnalysisMove = (sourceSquare: Square, targetSquare: Square): boolean => {
    let move: Move
    try {
      move = new Chess(fenAt(treeRef.current, cursorId)).move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
    } catch {
      return false
    }

    const parentId = cursorId
    let id = parentId
    let isNew = false
    updateTree(current => {
      const added = addMove(current, parentId, move)
      id = added.id
      isNew = added.tree !== current
      return added.tree
    })
    setCursorId(id)
    if (isNew) requestEngineAnalysis(id)
    return true
  }

  const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    if (gameFinished) return playAnalysisMove(sourceSquare, targetSquare)

    // During the game, moves are played from the current position only, not while looking at an earlier one.
    if (cursorId !== lineEnd(tree, ROOT)) return false

    const currentTurn: PlayerColor = game.turn() === 'w' ? 'white' : 'black'

    if (currentTurn !== userColor || isEngineThinking || game.isGameOver()) {
      return false
    }

    try {
      const gameCopy = cloneGame(game)

      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q'
      })

      if (!move) return false

      setGame(gameCopy)
      analyseInBackground(playMainlineMove(move))

      if (!gameCopy.isGameOver()) {
        requestEngineMove(gameCopy.fen())
      }

      return true

    } catch (err) {
      console.error('Invalid move:', err)
      return false
    }
  }

  // The coach explains one analysed move (either side's), anchored on its engine analysis.
  const explainMove = async (node: MoveNode) => {
    if (!isAnalysed(node)) return
    const explain = (text: string) => setExplanations(prev => ({ ...prev, [node.id]: text }))

    setExplainingId(node.id)
    try {
      const response = await fetch(`${API_BASE_URL}/move-evaluation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          move_analysis: toAnalysisPayload(node),
          mover: isUserPly(node.ply) ? 'user' : 'opponent',
          ...llmConfig
        })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        explain(data?.detail ?? `Não foi possível obter a análise: erro HTTP ${response.status}`)
        return
      }
      explain(data?.evaluation || 'Avaliação semântica indisponível.')
    } catch (err) {
      console.error('Move evaluation error:', err)
      explain('Não foi possível obter a análise no momento.')
    } finally {
      setExplainingId(null)
    }
  }

  // Deterministic part of the report: fast, shown as soon as the game's analyses are in.
  const requestGameStats = async (finalGame: Chess, moves: ReportMove[]): Promise<GameStats | null> => {
    const userColorCode = userColor === 'white' ? 'w' : 'b'
    const totalUserMoves = finalGame.history({ verbose: true }).filter(m => m.color === userColorCode).length

    try {
      const response = await fetch(`${API_BASE_URL}/game-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_color: userColor, pgn: finalGame.pgn(), moves, total_user_moves: totalUserMoves })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        setReportMessage(data?.detail ?? `Não foi possível calcular as estatísticas: erro HTTP ${response.status}`)
        return null
      }
      return data.stats
    } catch (err) {
      console.error('Game stats error:', err)
      setReportMessage('Não foi possível calcular as estatísticas no momento.')
      return null
    }
  }

  // The coach's narrative, written by the LLM from the stats. Also the "retry" action.
  const requestCoachReport = async () => {
    const context = reportContextRef.current
    if (!context) return

    setCoachReport({ text: null, error: null, loading: true })
    try {
      const response = await fetch(`${API_BASE_URL}/game-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ...llmConfig })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = data?.detail ?? `Não foi possível gerar o relatório: erro HTTP ${response.status}`
        setCoachReport({ text: null, error, loading: false })
        return
      }
      setCoachReport({ text: data.report, error: null, loading: false })
    } catch (err) {
      console.error('Game report error:', err)
      setCoachReport({ text: null, error: 'Não foi possível gerar o relatório no momento.', loading: false })
    }
  }

  const submitReport = async (finalGame: Chess, result: string, termination: string, imported: boolean) => {
    const moves: ReportMove[] = gameMoves()
      .filter(node => isUserPly(node.ply))
      .filter(isAnalysed)
      .map(node => ({ ply: node.ply, san: node.san, ...toAnalysisPayload(node) }))

    if (moves.length < MIN_MOVES_FOR_REPORT) {
      setStatsLoading(false)
      setReportMessage(
        `Lances insuficientes para avaliar: são necessários pelo menos ${MIN_MOVES_FOR_REPORT} lances analisados.`
      )
      return
    }

    setStatsLoading(true)
    const gameStats = await requestGameStats(finalGame, moves)
    setStatsLoading(false)
    if (!gameStats) return

    setStats(gameStats)
    reportContextRef.current = {
      stats: gameStats,
      result,
      termination,
      pgn: finalGame.pgn(),
      lenient_plies: lenientPliesRef.current,
      imported
    }
    await requestCoachReport()
  }

  // Classifies every move of one side of the game that has no analysis yet, a few at a time.
  // Imported games are analysed this way; training games only use it to retry failed analyses.
  const analyseMoves = async (side: 'user' | 'opponent', onProgress?: (done: number, total: number) => void) => {
    const queue = gameMoves()
      .filter(node => isUserPly(node.ply) === (side === 'user') && !node.analysis)
      .map(node => node.id)

    const total = queue.length
    let done = 0
    onProgress?.(done, total)

    const worker = async () => {
      for (let nodeId = queue.shift(); nodeId; nodeId = queue.shift()) {
        await requestEngineAnalysis(nodeId)
        done += 1
        onProgress?.(done, total)
      }
    }
    await Promise.all(Array.from({ length: IMPORT_ANALYSIS_CONCURRENCY }, worker))
  }

  const analyseOpponentMoves = async () => {
    setOpponentAnalysing(true)
    try {
      await analyseMoves('opponent')
    } finally {
      setOpponentAnalysing(false)
    }
  }

  const finishGame = async (termination: string) => {
    if (finishedRef.current) return
    finishedRef.current = true

    const finalGame = gameRef.current
    const { result, label } = describeResult(finalGame, termination, userColor)
    setGameFinished(true)
    setMovePicked(false)
    setResultLabel(label)
    setIsEngineThinking(false)
    setStatsLoading(true)

    // Moves were analysed during the game: wait for the last ones, then retry any that failed.
    // The badges appear now, with the stats, while the coach's report is generated.
    await Promise.allSettled([...pendingAnalysesRef.current])
    await analyseMoves('user')

    analyseOpponentMoves()
    await submitReport(finalGame, result, termination, false)
  }

  // Analyses every user move of an imported PGN, then builds the same report as a training game.
  const analyseImportedGame = async () => {
    const importedGame = gameRef.current
    setReportMessage(null)

    // The user's moves first: the report needs them. The opponent's follow, while the report is generated.
    await analyseMoves('user', (done, total) => setImportProgress({ done, total }))
    setImportProgress(null)

    analyseOpponentMoves()
    const termination = importedGame.isGameOver() ? detectTermination(importedGame) : 'imported game'
    await submitReport(importedGame, importedGame.getHeaders().Result ?? '*', termination, true)
  }

  // A loaded game goes straight to analysis and the report.
  useEffect(() => {
    if (!isReview || autoAnalysisStartedRef.current) return
    autoAnalysisStartedRef.current = true
    analyseImportedGame()
  }, [])

  const handleResign = () => {
    if (gameFinished) return
    if (window.confirm('Encerrar a partida e ver o relatório?')) {
      finishGame('resignation')
    }
  }

  useEffect(() => {
    if (game.isGameOver()) {
      finishGame(detectTermination(game))
    }
  }, [game])

  const tipId = lineEnd(tree, ROOT)
  const viewingPast = cursorId !== tipId

  // Reads the tree from its ref: stable, so the keyboard listener is not re-attached on every move.
  const onNavigate = useCallback(
    (action: Navigation) => setCursorId(cursor => navigate(treeRef.current, cursor, action)),
    []
  )

  // After the game, picking a move in the history brings the per-move coach into view.
  const selectMove = (id: string) => {
    setCursorId(id)
    setMovePicked(id !== ROOT)
    scrollToCoachRef.current = gameFinished && id !== ROOT
  }

  useEffect(() => {
    if (!scrollToCoachRef.current) return
    scrollToCoachRef.current = false
    moveCoachRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [cursorId])

  // The move on the board: its squares are highlighted, and after the game the coach explains it (either side's).
  const selectedNode = cursorId !== ROOT ? tree.nodes[cursorId] : undefined
  const explaining = explainingId !== null

  const displayFen = fenAt(tree, cursorId)

  // The per-move coach, above the report: shown when the user picks a move that is already
  // classified, whether or not the report is ready.
  const coachNode = gameFinished && movePicked && selectedNode?.analysis ? selectedNode : undefined
  const explanation = coachNode && explanations[coachNode.id]
  const moveCoach = coachNode && (
    <div className="move-coach" ref={moveCoachRef}>
      <span className="eyebrow small">ANÁLISE POR LANCE</span>

      <p className="move-coach-target">
        Lance selecionado: <b>{moveNumberLabel(coachNode.ply)} {coachNode.san}</b>
        {' '}({isUserPly(coachNode.ply) ? 'seu' : 'do oponente'})
      </p>

      <button
        className="outline-btn move-coach-btn"
        onClick={() => explainMove(coachNode)}
        disabled={explaining}
      >
        {explaining ? 'Analisando...' : 'Avaliar lance selecionado'}
      </button>

      {opponentAnalysing && (
        <p className="message system">Classificando os lances do oponente...</p>
      )}

      {explainingId === coachNode.id && (
        <p className="message system" style={{ color: '#d0af68' }}>
          🤔 Analisando o lance...
        </p>
      )}

      {explanation && explainingId !== coachNode.id && (
        <div className="message markdown-body">
          <ReactMarkdown>{explanation}</ReactMarkdown>
        </div>
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
          {!gameFinished && (
            <button className="outline-btn" onClick={handleResign}>
              Encerrar partida
            </button>
          )}
          <button className="outline-btn" onClick={onNewGame}>
            Novo jogo
          </button>
          <button className="outline-btn" onClick={() => setLlmSettingsOpen(true)}>
            Configurar LLM
          </button>
        </div>
      </header>

      <div className={`game-layout${gameFinished ? ' finished' : ''}`}>
        <aside className="history-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow small">NAVEGAÇÃO</span>
              <h2>Histórico do jogo</h2>
            </div>
          </div>

          <MoveList tree={tree} cursorId={cursorId} showBadges={gameFinished} onSelect={selectMove} />
        </aside>

        <section className="center-stage">
          <div className="stage-head">
            <div>
              <span className="eyebrow small">
                {viewingPast ? 'MODO DE REVISÃO' : gameFinished ? 'PARTIDA ENCERRADA' : 'PARTIDA DE TREINO'}
              </span>

              <h1>
                {viewingPast
                  ? 'Revendo posição'
                  : gameFinished
                    ? resultLabel
                    : game.turn() === (userColor === 'white' ? 'w' : 'b')
                      ? 'Sua vez'
                      : 'Oponente'}
              </h1>
            </div>
          </div>

          <div className="players">
            <div>
              <span className="player-piece">
                {userColor === 'white' ? '♟' : '♙'}
              </span>

              <div>
                <b>{isReview ? importedName(game, userColor === 'white' ? 'Black' : 'White', 'Oponente') : 'Stockfish'}</b>
                <small>{isReview ? 'Oponente' : 'Engine'}</small>
              </div>
            </div>
          </div>

          <div className="board-wrap">
            <div className="rank-labels">
              {(userColor === 'white'
                ? [8, 7, 6, 5, 4, 3, 2, 1]
                : [1, 2, 3, 4, 5, 6, 7, 8]
              ).map(r => (
                <span key={r}>{r}</span>
              ))}
            </div>

            <div className="chessboard-container">
              <Chessboard
                options={{
                  position: displayFen,
                  squareStyles: lastMoveStyles(selectedNode),
                  boardOrientation: userColor,
                  onPieceDrop: ({ sourceSquare, targetSquare }) => {
                    if (!sourceSquare || !targetSquare) return false

                    return onDrop(
                      sourceSquare as Square,
                      targetSquare as Square
                    )
                  }
                }}
              />
            </div>

            <div className="file-labels">
              {(userColor === 'white'
                ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
                : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
              ).map(f => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </div>

          <BoardControls
            canGoBack={cursorId !== ROOT}
            canGoForward={cursorId !== lineEnd(tree, cursorId)}
            keyboard={!llmSettingsOpen}
            onNavigate={onNavigate}
          />

          {isEngineThinking && !viewingPast && (
            <p style={{
              textAlign: 'center',
              color: '#8b9487',
              marginTop: 12
            }}>
              Engine pensando...
            </p>
          )}

          <div className="players bottom">
            <div>
              <span className="player-piece">
                {userColor === 'white' ? '♙' : '♟'}
              </span>

              <div>
                <b>{isReview ? importedName(game, userColor === 'white' ? 'White' : 'Black', 'Você') : 'You'}</b>
                <small>Jogador</small>
              </div>
            </div>
          </div>
        </section>

        <aside className="chat-panel">
          <div className="chat-head">
            <div className="bot-avatar">A</div>

            <div>
              <b>{gameFinished ? 'Treinador' : 'Partida de treino'}</b>

              <span>
                <span className="live-dot" />
                {gameFinished ? 'Relatório e análise por lance' : 'Feedback oculto até o fim da partida'}
              </span>
            </div>
          </div>

          <div className="chat-content">
            {!gameFinished && (
              <p className="message system">
                Partida de treino em andamento. Jogue normalmente: o sistema está avaliando
                seu nível. Os lances, a precisão e as recomendações aparecerão ao final da
                partida (ou ao clicar em "Encerrar partida").
              </p>
            )}

            {importProgress && (
              <p className="message system" style={{ color: '#d0af68' }}>
                🔍 Analisando seus lances: {importProgress.done} de {importProgress.total}...
              </p>
            )}

            {moveCoach}

            {gameFinished && !importProgress && (
              <GameReport
                result={resultLabel}
                stats={stats}
                statsLoading={statsLoading}
                coach={coachReport}
                message={reportMessage}
                onSelectMoment={(_fen, ply) => {
                  const node = mainline(tree).find(move => move.ply === ply)
                  if (node) selectMove(node.id)
                }}
                onRetry={requestCoachReport}
                onConfigureLLM={() => setLlmSettingsOpen(true)}
              />
            )}
          </div>
        </aside>
      </div>

      {llmSettingsOpen && (
        <LLMSettings
          config={llmConfig}
          onSave={config => {
            onLLMConfigChange(config)
            setLlmSettingsOpen(false)
          }}
          onCancel={() => setLlmSettingsOpen(false)}
        />
      )}
    </main>
  )
}