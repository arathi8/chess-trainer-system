import { useState, useRef, useEffect } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import LLMSettings from './LLMSettings'
import GameReport from './GameReport'
import type { GameReportData } from './GameReport'
import { API_BASE_URL } from '../api'
import type { LLMConfig } from '../llmConfig'
import ReactMarkdown from 'react-markdown'

type PlayerColor = 'white' | 'black'

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

// One analysed user move, in the shape /api/game-report expects.
interface MoveAnalysis {
  ply: number
  san: string
  move_classification: string
  move_delta: number
  before_move_analysis: PositionAnalysis
  after_move_analysis: PositionAnalysis
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
  const [assistEnabled, setAssistEnabled] = useState(true)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)

  // Training game: feedback stays hidden until the game ends, then the report is shown.
  const [gameFinished, setGameFinished] = useState(false)
  const [resultLabel, setResultLabel] = useState('')
  const [report, setReport] = useState<GameReportData | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportMessage, setReportMessage] = useState<string | null>(null)
  const [selectedMove, setSelectedMove] = useState<{ turnNumber: number; isWhite: boolean } | null>(null)

  const gameRef = useRef<Chess>(game)
  gameRef.current = game

  const lastMoveRef = useRef<{ fenBefore: string; moveUci: string } | null>(null)

  // Refs, not state: the report is assembled after async work, where state would be stale.
  const finishedRef = useRef(false)
  const analysisByPlyRef = useRef<Map<number, MoveAnalysis>>(new Map())
  const pendingAnalysesRef = useRef<Set<Promise<void>>>(new Set())
  const lenientPliesRef = useRef<number[]>([])
  const reportPayloadRef = useRef<Record<string, unknown> | null>(null)
  const gameStartedRef = useRef(false)

  const recordMove = (san: string, fen: string): { turnNumber: number; isWhite: boolean } => {
    const lastRow = moveHistory[moveHistory.length - 1]
    const isNewTurn = !lastRow || Boolean(lastRow.white && lastRow.black)
    const turnNumber = isNewTurn ? moveHistory.length + 1 : lastRow.turnNumber
    const isWhite = isNewTurn

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

    return { turnNumber, isWhite }
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

  const requestEngineAnalysis = async (
    fen: string,
    move: string,
    san: string,
    turnNumber: number,
    isWhite: boolean
  ) => {
    try {

      const response = await fetch(`${API_BASE_URL}/engine-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: fen, move: move })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      const ply = plyFromFen(fen)
      analysisByPlyRef.current.set(ply, {
        ply,
        san,
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

      setSemanticAnalysisReady(true)

    } catch (err) {
      console.error('Classification error:', err)
    }
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
    if (gameStartedRef.current) return
    gameStartedRef.current = true
    startGame()
  }, [])

  const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    if (reviewMode || gameFinished) return false

    const currentTurn: PlayerColor = game.turn() === 'w' ? 'white' : 'black'

    if (currentTurn !== userColor || isEngineThinking || game.isGameOver()) {
      return false
    }

    const fenBefore = game.fen()
    const isWhite = game.turn() === 'w'

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

      const { turnNumber } = recordMove(
        move.san,
        gameCopy.fen()
      )

      const moveUci = `${sourceSquare}${targetSquare}${move.promotion || ''}`

      const analysisPromise = requestEngineAnalysis(
        fenBefore,
        moveUci,
        move.san,
        turnNumber,
        isWhite
      )
      pendingAnalysesRef.current.add(analysisPromise)
      analysisPromise.finally(() => pendingAnalysesRef.current.delete(analysisPromise))

      lastMoveRef.current = {
        fenBefore,
        moveUci
      }

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
        }
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

  const generateReport = async () => {
    const payload = reportPayloadRef.current
    if (!payload) return

    setReportLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/game-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...llmConfig })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        setReportMessage(data?.detail ?? `Não foi possível gerar o relatório: erro HTTP ${response.status}`)
        return
      }
      setReportMessage(null)
      setReport(data)
    } catch (err) {
      console.error('Game report error:', err)
      setReportMessage('Não foi possível gerar o relatório no momento.')
    } finally {
      setReportLoading(false)
    }
  }

  const submitReport = async (finalGame: Chess, result: string, termination: string) => {
    const moves = [...analysisByPlyRef.current.values()].sort((a, b) => a.ply - b.ply)
    const userColorCode = userColor === 'white' ? 'w' : 'b'
    const totalUserMoves = finalGame.history({ verbose: true }).filter(m => m.color === userColorCode).length

    if (moves.length < MIN_MOVES_FOR_REPORT) {
      setReportLoading(false)
      setReportMessage(
        `Lances insuficientes para avaliar: são necessários pelo menos ${MIN_MOVES_FOR_REPORT} lances analisados.`
      )
      return
    }

    reportPayloadRef.current = {
      user_color: userColor,
      result,
      termination,
      pgn: finalGame.pgn(),
      moves,
      total_user_moves: totalUserMoves,
      lenient_plies: lenientPliesRef.current
    }
    await generateReport()
  }

  const finishGame = async (termination: string) => {
    if (finishedRef.current) return
    finishedRef.current = true

    const finalGame = gameRef.current
    const { result, label } = describeResult(finalGame, termination, userColor)
    setGameFinished(true)
    setResultLabel(label)
    setIsEngineThinking(false)
    setReportLoading(true)

    // The last moves' analyses may still be running.
    await Promise.allSettled([...pendingAnalysesRef.current])

    await submitReport(finalGame, result, termination)
  }

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
    setSelectedMove(turnNumber !== undefined && isWhite !== undefined ? { turnNumber, isWhite } : null)
  }

  const exitReviewMode = () => {
    setReviewMode(false)
    setReviewFen(null)
    setSelectedMove(null)
  }

  // After the game, the coach explains the selected move, or the user's last move by default.
  const selectedMoveData = selectedMove
    ? moveHistory.find(r => r.turnNumber === selectedMove.turnNumber)?.[selectedMove.isWhite ? 'white' : 'black']
    : undefined
  const selectedMoveIsUsers = selectedMove ? selectedMove.isWhite === (userColor === 'white') : true
  const canEvaluateSelected = selectedMove
    ? selectedMoveIsUsers && Boolean(selectedMoveData?.beforeAnalysis)
    : semanticAnalysisReady

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

                <button onClick={() => handleMoveClick(item.white.fen, item.turnNumber, true)}>
                  <b>{item.white.san}</b>
                  {gameFinished && <MoveBadge classification={item.white.classification} />}
                </button>

                <button onClick={() => item.black && handleMoveClick(item.black.fen, item.turnNumber, false)}>
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
                <b>Stockfish</b>
                <small>Engine</small>
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
                <b>You</b>
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
                {!gameFinished
                  ? 'Feedback oculto até o fim da partida'
                  : assistEnabled ? 'Assistência ativada' : 'Assistência desativada'}
              </span>
            </div>

            {gameFinished && (
              <button
                onClick={() => setAssistEnabled(!assistEnabled)}
                style={{
                  background: assistEnabled ? 'var(--gold)' : '#3a4038',
                  border: 'none',
                  borderRadius: '12px',
                  width: '44px',
                  height: '24px',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.3s'
                }}
                aria-label={
                  assistEnabled
                    ? 'Desativar assistência'
                    : 'Ativar assistência'
                }
              >
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  left: assistEnabled ? '22px' : '2px',
                  width: '20px',
                  height: '20px',
                  background: assistEnabled ? '#1d211a' : '#8d958b',
                  borderRadius: '50%',
                  transition: 'left 0.3s'
                }} />
              </button>
            )}
          </div>

          <div className="chat-content">
            {!gameFinished && (
              <p className="message system">
                Partida de treino em andamento. Jogue normalmente: o sistema está avaliando
                seu nível. Os lances, a precisão e as recomendações aparecerão ao final da
                partida (ou ao clicar em "Encerrar partida").
              </p>
            )}

            {gameFinished && (
              <GameReport
                result={resultLabel}
                data={report}
                loading={reportLoading}
                message={reportMessage}
                onSelectMoment={fen => handleMoveClick(fen)}
                onRetry={generateReport}
                onConfigureLLM={() => setLlmSettingsOpen(true)}
              />
            )}

            {gameFinished && !assistEnabled && (
              <p className="message system">
                Assistência desativada. Ative-a para pedir explicações sobre lances específicos.
              </p>
            )}

            {gameFinished && assistEnabled && (
              <div className="move-coach">
                <span className="eyebrow small">ANÁLISE POR LANCE</span>

                {!analysis && !loadingAnalysis && (
                  <p className="message system">
                    Selecione um dos seus lances no histórico e peça a explicação do treinador.
                  </p>
                )}

                {loadingAnalysis && (
                  <p className="message system" style={{ color: '#d0af68' }}>
                    🤔 Analisando seu lance...
                  </p>
                )}

                {analysis && (
                  <div className="message markdown-body">
                    <ReactMarkdown>{analysis}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>

          {gameFinished && assistEnabled && (
            <div style={{ padding: '0 18px 18px' }}>
              <button
                className="outline-btn"
                style={{
                  width: '100%',
                  justifyContent: 'center'
                }}
                onClick={() => {
                  requestMoveEvaluation(selectedMove?.turnNumber, selectedMove?.isWhite)
                }}
                disabled={loadingAnalysis || !canEvaluateSelected}
              >
                {loadingAnalysis
                  ? 'Analisando...'
                  : !canEvaluateSelected
                    ? 'Selecione um lance seu'
                    : selectedMove
                      ? 'Avaliar lance selecionado'
                      : 'Avaliar último lance'}
              </button>
            </div>
          )}
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