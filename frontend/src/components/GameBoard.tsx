import { useState, useRef } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'

const API_BASE_URL = 'http://localhost:8000/api'

type PlayerColor = 'white' | 'black'

interface MoveDetail {
  san: string
  fen: string
  classification?: string
  winPercentLoss?: number
}

interface MoveRow {
  turnNumber: number
  white: MoveDetail
  black?: MoveDetail
}

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  'Great Move (!)': { label: '!', className: 'great' },
  'Best Move': { label: '★', className: 'best' },
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
  onNewGame: () => void
  onBackHome: () => void
}

export default function GameBoard({ 
  initialGame, 
  initialHistory = [], 
  userColor,
  onNewGame,
  onBackHome 
}: GameBoardProps) {
  const [game, setGame] = useState<Chess>(initialGame || new Chess())
  const [moveHistory, setMoveHistory] = useState<MoveRow[]>(initialHistory)
  const [analysis, setAnalysis] = useState<string>('')
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [isEngineThinking, setIsEngineThinking] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [reviewFen, setReviewFen] = useState<string | null>(null)
  const [assistEnabled, setAssistEnabled] = useState(true)
  const gameRef = useRef<Chess>(game)
  gameRef.current = game
  const lastMoveRef = useRef<{ fenBefore: string; moveUci: string } | null>(null)

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

  const attachClassification = (
    turnNumber: number,
    isWhite: boolean,
    classification: string,
    winPercentLoss: number
  ) => {
    setMoveHistory(prev =>
      prev.map(row => {
        if (row.turnNumber !== turnNumber) return row

        if (isWhite) {
          return { ...row, white: { ...row.white, classification, winPercentLoss } }
        } else if (row.black) {
          return { ...row, black: { ...row.black, classification, winPercentLoss } }
        }
        return row
      })
    )
  }

  const requestClassification = async (
    fenBefore: string,
    moveUci: string,
    turnNumber: number,
    isWhite: boolean
  ) => {
    try {
      const response = await fetch(`${API_BASE_URL}/evaluate-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: fenBefore, move_uci: moveUci })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      if (data.classification) {
        attachClassification(turnNumber, isWhite, data.classification, data.win_percent_loss)
      }
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
        body: JSON.stringify({ fen: currentFen })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()

      if (data.engine_move_uci) {
        const gameCopy = new Chess(gameRef.current.fen())
        const move = gameCopy.move({
          from: data.engine_move_uci.slice(0, 2) as Square,
          to: data.engine_move_uci.slice(2, 4) as Square,
          promotion: (data.engine_move_uci[4] || 'q') as 'n' | 'b' | 'r' | 'q'
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

  const onDrop = (sourceSquare: Square, targetSquare: Square): boolean => {
    if (reviewMode) return false
    
    const currentTurn: PlayerColor = game.turn() === 'w' ? 'white' : 'black'
    if (currentTurn !== userColor || isEngineThinking || game.isGameOver()) {
      return false
    }

    const fenBefore = game.fen()
    const isWhite = game.turn() === 'w'

    try {
      const gameCopy = new Chess(game.fen())
      const move = gameCopy.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })

      if (!move) return false

      setGame(gameCopy)
      const { turnNumber } = recordMove(move.san, gameCopy.fen())

      const moveUci = `${sourceSquare}${targetSquare}${move.promotion || ''}`
      requestClassification(fenBefore, moveUci, turnNumber, isWhite)
      lastMoveRef.current = { fenBefore, moveUci }

      // Análise automática se assist estiver ligado
      // Julgamos o lance que o usuário acabou de jogar (fen ANTES + lance)
      if (assistEnabled && !gameCopy.isGameOver()) {
        handleRequestAnalysis(fenBefore, moveUci)
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

  const handleRequestAnalysis = async (fenBeforeMove?: string, moveUci?: string) => {
    // Precisamos da posição ANTES do lance e do lance jogado para julgar a jogada
    const targetFen = fenBeforeMove ?? lastMoveRef.current?.fenBefore
    const targetMoveUci = moveUci ?? lastMoveRef.current?.moveUci

    if (!targetFen || !targetMoveUci) {
      setAnalysis('Faça um movimento para receber a análise da sua jogada.')
      return
    }

    setLoadingAnalysis(true)
    try {
      const response = await fetch(`${API_BASE_URL}/analyze-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: targetFen,
          move_uci: targetMoveUci,
          prompt: ''
        })
      })

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`)

      const data = await response.json()
      
      const feedbackMessage = data.prompt || 'Análise não disponível.'
      
      setAnalysis(feedbackMessage)
    } catch (err) {
      console.error('Analysis error:', err)
      setAnalysis('Não foi possível obter análise no momento.')
    } finally {
      setLoadingAnalysis(false)
    }
  }

  const handleMoveClick = (fen: string) => {
    setReviewMode(true)
    setReviewFen(fen)
  }

  const exitReviewMode = () => {
    setReviewMode(false)
    setReviewFen(null)
  }

  const displayFen = reviewMode && reviewFen ? reviewFen : game.fen()

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand compact" onClick={onBackHome}>
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </button>
        <div className="top-actions">
          <button className="outline-btn" onClick={onNewGame}>
            Novo jogo
          </button>
        </div>
      </header>
      <div className="game-layout">
        <aside className="history-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow small">NAVEGAÇÃO</span>
              <h2>Histórico da partida</h2>
            </div>
          </div>
          <div className="moves">
            <button 
              className="start-move"
              onClick={() => {
                setReviewMode(true)
                setReviewFen(new Chess().fen())
              }}
            >
              PARTIDA INICIADA
            </button>
            {moveHistory.map(item => (
              <div className="move-row" key={item.turnNumber}>
                <span className="move-number">{String(item.turnNumber).padStart(2, '0')}</span>
                <button onClick={() => handleMoveClick(item.white.fen)}>
                  <b>{item.white.san}</b>
                  <MoveBadge classification={item.white.classification} />
                </button>
                <button onClick={() => item.black && handleMoveClick(item.black.fen)}>
                  {item.black && (
                    <>
                      <b>{item.black.san}</b>
                      <MoveBadge classification={item.black.classification} />
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
                {reviewMode ? 'MODO REVISÃO' : 'ANÁLISE EM TEMPO REAL'}
              </span>
              <h1>
                {reviewMode 
                  ? 'Revisando posição' 
                  : game.turn() === (userColor === 'white' ? 'w' : 'b') 
                    ? 'Seu turno' 
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
                Voltar ao jogo
              </button>
            </div>
          )}
          <div className="players">
            <div>
              <span className="player-piece">{userColor === 'white' ? '♟' : '♙'}</span>
              <div>
                <b>Stockfish</b>
                <small>Engine</small>
              </div>
            </div>
          </div>
          <div className="board-wrap">
            <div className="rank-labels">
              {(userColor === 'white' ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8]).map(r => <span key={r}>{r}</span>)}
            </div>
            <div className="chessboard-container">
              <Chessboard
                options={{
                  position: displayFen,
                  boardOrientation: userColor,
                  onPieceDrop: ({ sourceSquare, targetSquare }) => {
                    if (!sourceSquare || !targetSquare) return false
                    return onDrop(sourceSquare as Square, targetSquare as Square)
                  }
                }}
              />
            </div>
            <div className="file-labels">
              {(userColor === 'white' ? ['a','b','c','d','e','f','g','h'] : ['h','g','f','e','d','c','b','a']).map(f => <span key={f}>{f}</span>)}
            </div>
          </div>
          {isEngineThinking && !reviewMode && (
            <p style={{ textAlign: 'center', color: '#8b9487', marginTop: 12 }}>
              Engine pensando...
            </p>
          )}
          <div className="players bottom">
            <div>
              <span className="player-piece">{userColor === 'white' ? '♙' : '♟'}</span>
              <div>
                <b>Você</b>
                <small>Jogador</small>
              </div>
            </div>
          </div>
        </section>
        <aside className="chat-panel">
          <div className="chat-head">
            <div className="bot-avatar">A</div>
            <div>
              <b>Análise Stockfish</b>
              <span>
                <span className="live-dot" /> 
                {assistEnabled ? 'Assist ligado' : 'Assist desligado'}
              </span>
            </div>
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
              aria-label={assistEnabled ? 'Desligar assist' : 'Ligar assist'}
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
          </div>
          <div className="chat-content">
            {!assistEnabled && (
              <p className="message system">
                O assist está desligado. Ative-o para receber feedback automático após cada jogada.
              </p>
            )}
            {assistEnabled && !analysis && !loadingAnalysis && (
              <p className="message system">
                Faça um movimento para receber feedback automático sobre sua jogada.
              </p>
            )}
            {loadingAnalysis && (
              <p className="message system" style={{ color: '#d0af68' }}>
                🤔 Analisando sua jogada...
              </p>
            )}
            {analysis && assistEnabled && <p className="message">{analysis}</p>}
          </div>
          <div style={{ padding: '0 18px 18px' }}>
            <button
              className="outline-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => handleRequestAnalysis()}
              disabled={loadingAnalysis}
            >
              {loadingAnalysis ? 'Analisando...' : 'Analisar novamente'}
            </button>
          </div>
        </aside>
      </div>
    </main>
  )
}
