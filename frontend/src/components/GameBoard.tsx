import { useState, useRef, useEffect } from 'react'
import type { Move } from 'chess.js'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import LLMSettings from './LLMSettings'
import GameReport from './GameReport'
import type { CoachReport, GameStats } from './GameReport'
import { API_BASE_URL } from '../api'
import type { LLMConfig } from '../llmConfig'
import ReactMarkdown from 'react-markdown'

type PlayerColor = 'white' | 'black'
// training: play Stockfish with feedback hidden until the end; review: analyse an imported PGN
export type GameMode = 'training' | 'review'

// Engine analyses running at once when analysing an imported game.
const IMPORT_ANALYSIS_CONCURRENCY = 2

interface MoveDetail {
  san: string
  fen: string
  classification?: string
  delta?: number
  beforeAnalysis?: PositionAnalysis
  afterAnalysis?: PositionAnalysis
}

interface MoveRow {
  turnNumber: number
  white: MoveDetail
  black?: MoveDetail
}

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  'Best Move': { label: '!', className: 'great' },
  'Good Move': { label: '★', className: 'best' },
  'Inaccuracy': { label: '?!', className: 'inaccuracy' },
  'Mistake': { label: '?', className: 'mistake' },
  'Blunder': { label: '??', className: 'blunder' }
}

const MoveBadge = ({ classification }: { classification?: string }) => {
  if (!classification || !BADGE_CONFIG[classification]) return null
  const { label, className } = BADGE_CONFIG[classification]
  return <span className={`tag ${className}`} title={classification}>{label}</span>
}

interface GameBoardProps {
  initialGame?: Chess
  initialHistory?: MoveRow[]
  userColor: PlayerColor
  mode?: GameMode
  llmConfig: LLMConfig | null
  onLLMConfigChange: (config: LLMConfig | null) => void
  onNewGame: () => void
  onBackHome: () => void
}

interface PositionAnalysis {
  fen: string;
  best_move: string;
  evaluation: string;
  depth: number;
  line: string;
}

// One analysed user move, in the shape /api/game-stats expects.
interface MoveAnalysis {
  ply: number
  san: string
  move_classification: string
  move_delta: number
  before_move_analysis: PositionAnalysis
  after_move_analysis: PositionAnalysis
}

// What /api/game-report needs besides the BYOK settings; kept to retry the coach's report.
interface ReportContext {
  stats: GameStats
  result: string
  termination: string
  pgn: string
  lenient_plies: number[]
  imported: boolean
}

// Half-move index of the side to move in a FEN: 0 = White's first move.
const plyFromFen = (fen: string): number => {
  const [, turn, , , , fullmove] = fen.split(' ')
  return (Number(fullmove) - 1) * 2 + (turn === 'b' ? 1 : 0)
}

const MIN_MOVES_FOR_REPORT = 3

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
  initialHistory = [],
  userColor,
  mode = 'training',
  llmConfig,
  onLLMConfigChange,
  onNewGame,
  onBackHome
}: GameBoardProps) {
  const [game, setGame] = useState<Chess>(initialGame || new Chess())
  const [moveHistory, setMoveHistory] = useState<MoveRow[]>(initialHistory)
  const [analysis, setEvaluation] = useState<string>('')
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [isEngineThinking, setIsEngineThinking] = useState(false)
  const [semanticAnalysisReady, setSemanticAnalysisReady] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewFen, setReviewFen] = useState<string | null>(null)
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
  const [reportMessage, setReportMessage] = useState<string | null>(null)
  const [selectedMove, setSelectedMove] = useState<{ turnNumber: number; isWhite: boolean } | null>(null)

  const gameRef = useRef<Chess>(game)
  gameRef.current = game

  // Refs, not state: the report is assembled after async work, where state would be stale.
  const finishedRef = useRef(isReview)
  const analysisByPlyRef = useRef<Map<number, MoveAnalysis>>(new Map())
  const pendingAnalysesRef = useRef<Set<Promise<void>>>(new Set())
  const lenientPliesRef = useRef<number[]>([])
  const reportContextRef = useRef<ReportContext | null>(null)
  const autoAnalysisStartedRef = useRef(false)
  const gameStartedRef = useRef(false)
  const moveCoachRef = useRef<HTMLDivElement>(null)

  // Plies are 0-based half-moves: even = White's moves.
  const isUserPly = (ply: number) => (ply % 2 === 0) === (userColor === 'white')

  const recordMove = (san: string, fen: string) => {
    setMoveHistory(prev => {
      const nextHistory = [...prev]
      const row = nextHistory[nextHistory.length - 1]

      if (!row || (row.white && row.black)) {
        nextHistory.push({ turnNumber: nextHistory.length + 1, white: { san, fen } })
      } else {
        nextHistory[nextHistory.length - 1] = { ...row, black: { san, fen } }
      }

      return nextHistory
    })
  }

  const attachEngineAnalysis = (
    turnNumber: number,
    isWhite: boolean,
    moveClassification: string,
    moveDelta: number,
    beforeMoveAnalysis: PositionAnalysis,
    afterMoveAnlysis: PositionAnalysis,
  ) => {
    setMoveHistory(prev =>
      prev.map(row => {
        if (row.turnNumber !== turnNumber) return row

        const engineData = {
          classification: moveClassification,
          delta: moveDelta,
          beforeAnalysis: beforeMoveAnalysis,
          afterAnalysis: afterMoveAnlysis
        }

        if (isWhite) {
          return { ...row, white: { ...row.white, ...engineData } }
        } else if (row.black) {
          return { ...row, black: { ...row.black, ...engineData } }
        }

        return row
      })
    )
  }

  // Classifies one move (either side's); the history badges stay hidden until the game ends.
  const requestEngineAnalysis = async (move: Move) => {
    const ply = plyFromFen(move.before)
    const turnNumber = Math.floor(ply / 2) + 1
    const isWhite = move.color === 'w'

    try {
      const response = await fetch(`${API_BASE_URL}/engine-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: move.before, move: `${move.from}${move.to}${move.promotion ?? ''}` })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      analysisByPlyRef.current.set(ply, {
        ply,
        san: move.san,
        move_classification: data.move_classification,
        move_delta: data.move_delta,
        before_move_analysis: data.before_move_analysis,
        after_move_analysis: data.after_move_analysis
      })

      attachEngineAnalysis(
        turnNumber,
        isWhite,
        data.move_classification,
        data.move_delta,
        data.before_move_analysis,
        data.after_move_analysis
      )

      if (isUserPly(ply)) setSemanticAnalysisReady(true)

    } catch (err) {
      console.error('Classification error:', err)
    }
  }

  // Training game: each move is analysed while the game goes on, so the report only waits for the last ones.
  const analyseInBackground = (move: Move) => {
    const analysis = requestEngineAnalysis(move)
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
          recordMove(move.san, gameCopy.fen())
          analyseInBackground(move)
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

  const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    if (reviewMode || gameFinished) return false

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
      setSemanticAnalysisReady(false)
      setEvaluation(
          'Aguarde a classificação técnica do lance antes de solicitar o feedback do treinador.'
        )

      recordMove(move.san, gameCopy.fen())
      analyseInBackground(move)

      if (!gameCopy.isGameOver()) {
        requestEngineMove(gameCopy.fen())
      }

      return true

    } catch (err) {
      console.error('Invalid move:', err)
      return false
    }
  }

  const requestMoveEvaluation = async (
    targetTurnNumber?: number,
    targetIsWhite?: boolean,
    directPayload?: any
  ) => {
    let payload = directPayload

    if (!payload) {
      const isWhiteMove = targetIsWhite ?? (userColor === 'white')

      const row = targetTurnNumber !== undefined
        ? moveHistory.find(r => r.turnNumber === targetTurnNumber)
        : moveHistory.findLast(r => (isWhiteMove ? r.white : r.black))

      if (!row) {
        setEvaluation('Faça um lance para receber uma análise do seu movimento.')
        return
      }

      const moveData = isWhiteMove ? row.white : row.black

      if (!moveData || !moveData.beforeAnalysis || !moveData.afterAnalysis) {
        setEvaluation(
          'Aguarde a classificação técnica do lance antes de solicitar o feedback do treinador.'
        )
        return
      }

      payload = {
        move_analysis: {
          before_move_analysis: moveData.beforeAnalysis,
          after_move_analysis: moveData.afterAnalysis,
          move_classification: moveData.classification,
          move_delta: moveData.delta
        },
        mover: isWhiteMove === (userColor === 'white') ? 'user' : 'opponent'
      }
    }

    setLoadingAnalysis(true)

    try {
      const response = await fetch(`${API_BASE_URL}/move-evaluation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...llmConfig })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        setEvaluation(data?.detail ?? `Não foi possível obter a análise: erro HTTP ${response.status}`)
        return
      }

      setEvaluation(data?.evaluation || 'Avaliação semântica indisponível.')

    } catch (err) {
      console.error('Move evaluation error:', err)
      setEvaluation('Não foi possível obter a análise no momento.')

    } finally {
      setLoadingAnalysis(false)
    }
  }

  // Deterministic part of the report: fast, shown as soon as the game's analyses are in.
  const requestGameStats = async (finalGame: Chess, moves: MoveAnalysis[]): Promise<GameStats | null> => {
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
    const moves = [...analysisByPlyRef.current.values()]
      .filter(m => isUserPly(m.ply))
      .sort((a, b) => a.ply - b.ply)

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

  // Classifies every move of one side that has no analysis yet, a few at a time.
  // Imported games are analysed this way; training games only use it to retry failed analyses.
  const analyseMoves = async (
    targetGame: Chess,
    side: 'user' | 'opponent',
    onProgress?: (done: number, total: number) => void
  ) => {
    const queue: Move[] = targetGame
      .history({ verbose: true })
      .filter(move => {
        const ply = plyFromFen(move.before)
        return isUserPly(ply) === (side === 'user') && !analysisByPlyRef.current.has(ply)
      })

    const total = queue.length
    let done = 0
    onProgress?.(done, total)

    const worker = async () => {
      for (let move = queue.shift(); move; move = queue.shift()) {
        await requestEngineAnalysis(move)
        done += 1
        onProgress?.(done, total)
      }
    }
    await Promise.all(Array.from({ length: IMPORT_ANALYSIS_CONCURRENCY }, worker))
  }

  const analyseOpponentMoves = async (targetGame: Chess) => {
    setOpponentAnalysing(true)
    try {
      await analyseMoves(targetGame, 'opponent')
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
    setResultLabel(label)
    setIsEngineThinking(false)
    setStatsLoading(true)

    // Moves were analysed during the game: wait for the last ones, then retry any that failed.
    // The badges appear now, with the stats, while the coach's report is generated.
    await Promise.allSettled([...pendingAnalysesRef.current])
    await analyseMoves(finalGame, 'user')

    analyseOpponentMoves(finalGame)
    await submitReport(finalGame, result, termination, false)
  }

  // Analyses every user move of an imported PGN, then builds the same report as a training game.
  const analyseImportedGame = async () => {
    const importedGame = gameRef.current
    setReportMessage(null)

    // The user's moves first: the report needs them. The opponent's follow, while the report is generated.
    await analyseMoves(importedGame, 'user', (done, total) => setImportProgress({ done, total }))
    setImportProgress(null)

    analyseOpponentMoves(importedGame)
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

  const handleMoveClick = (fen: string, turnNumber?: number, isWhite?: boolean) => {
    setReviewMode(true)
    setReviewFen(fen)
    const next = turnNumber !== undefined && isWhite !== undefined ? { turnNumber, isWhite } : null
    if (next?.turnNumber !== selectedMove?.turnNumber || next?.isWhite !== selectedMove?.isWhite) {
      setEvaluation('') // the previous explanation was about another move
    }
    setSelectedMove(next)
  }

  const exitReviewMode = () => {
    setReviewMode(false)
    setReviewFen(null)
    setSelectedMove(null)
  }

  // After the game, selecting a move in the history brings the per-move coach into view.
  useEffect(() => {
    if (selectedMove && gameFinished) {
      moveCoachRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedMove, gameFinished])

  // After the game, the coach explains the selected move (either side's), or the user's last move by default.
  const selectedMoveData = selectedMove
    ? moveHistory.find(r => r.turnNumber === selectedMove.turnNumber)?.[selectedMove.isWhite ? 'white' : 'black']
    : undefined
  const selectedMoveIsUsers = selectedMove ? selectedMove.isWhite === (userColor === 'white') : true
  const canEvaluateSelected = selectedMove ? Boolean(selectedMoveData?.beforeAnalysis) : semanticAnalysisReady
  const isSelected = (turnNumber: number, isWhite: boolean) =>
    selectedMove?.turnNumber === turnNumber && selectedMove.isWhite === isWhite

  const displayFen = reviewMode && reviewFen ? reviewFen : game.fen()

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

          <div className="moves">
            <button
              className="start-move"
              onClick={() => {
                handleMoveClick(new Chess().fen())
              }}
            >
              JOGO INICIADO
            </button>

            {moveHistory.map(item => (
              <div className="move-row" key={item.turnNumber}>
                <span className="move-number">
                  {String(item.turnNumber).padStart(2, '0')}
                </span>

                <button
                  className={isSelected(item.turnNumber, true) ? 'selected-move' : undefined}
                  onClick={() => handleMoveClick(item.white.fen, item.turnNumber, true)}
                >
                  <b>{item.white.san}</b>
                  {gameFinished && <MoveBadge classification={item.white.classification} />}
                </button>

                <button
                  className={isSelected(item.turnNumber, false) ? 'selected-move' : undefined}
                  onClick={() => item.black && handleMoveClick(item.black.fen, item.turnNumber, false)}
                >
                  {item.black && (
                    <>
                      <b>{item.black.san}</b>
                      {gameFinished && <MoveBadge classification={item.black.classification} />}
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="center-stage">
          <div className="stage-head">
            <div>
              <span className="eyebrow small">
                {reviewMode ? 'MODO DE REVISÃO' : gameFinished ? 'PARTIDA ENCERRADA' : 'PARTIDA DE TREINO'}
              </span>

              <h1>
                {reviewMode
                  ? 'Revendo posição'
                  : gameFinished
                    ? resultLabel
                    : game.turn() === (userColor === 'white' ? 'w' : 'b')
                      ? 'Sua vez'
                      : 'Oponente'}
              </h1>
            </div>
          </div>

          {reviewMode && (
            <div style={{
              background: '#2d3327',
              padding: '12px',
              borderRadius: '6px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ color: '#d0af68', fontSize: '12px' }}>
                📋 Você está revisando um lance anterior
              </span>

              <button
                className="outline-btn"
                style={{ padding: '6px 12px', fontSize: '11px' }}
                onClick={exitReviewMode}
              >
                {gameFinished ? 'Posição final' : 'Voltar ao jogo'}
              </button>
            </div>
          )}

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

          {isEngineThinking && !reviewMode && (
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

            {gameFinished && !importProgress && (
              <GameReport
                result={resultLabel}
                stats={stats}
                statsLoading={statsLoading}
                coach={coachReport}
                message={reportMessage}
                onSelectMoment={(fen, ply) => handleMoveClick(fen, Math.floor(ply / 2) + 1, ply % 2 === 0)}
                onRetry={requestCoachReport}
                onConfigureLLM={() => setLlmSettingsOpen(true)}
              />
            )}

            {gameFinished && (
              <div className="move-coach" ref={moveCoachRef}>
                <span className="eyebrow small">ANÁLISE POR LANCE</span>

                <p className="move-coach-target">
                  {selectedMove && selectedMoveData
                    ? <>
                        Lance selecionado: <b>{selectedMove.turnNumber}{selectedMove.isWhite ? '.' : '...'} {selectedMoveData.san}</b>
                        {' '}({selectedMoveIsUsers ? 'seu' : 'do oponente'})
                      </>
                    : 'Selecione um lance no histórico (seu ou do oponente) para pedir a explicação do treinador.'}
                </p>

                <button
                  className="outline-btn move-coach-btn"
                  onClick={() => {
                    requestMoveEvaluation(selectedMove?.turnNumber, selectedMove?.isWhite)
                  }}
                  disabled={loadingAnalysis || !canEvaluateSelected}
                >
                  {loadingAnalysis
                    ? 'Analisando...'
                    : !canEvaluateSelected
                      ? selectedMove
                        ? (opponentAnalysing ? 'Classificando lance...' : 'Lance sem classificação')
                        : 'Selecione um lance'
                      : selectedMove
                        ? 'Avaliar lance selecionado'
                        : 'Avaliar seu último lance'}
                </button>

                {opponentAnalysing && (
                  <p className="message system">Classificando os lances do oponente...</p>
                )}

                {loadingAnalysis && (
                  <p className="message system" style={{ color: '#d0af68' }}>
                    🤔 Analisando o lance...
                  </p>
                )}

                {analysis && !loadingAnalysis && (
                  <div className="message markdown-body">
                    <ReactMarkdown>{analysis}</ReactMarkdown>
                  </div>
                )}
              </div>
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