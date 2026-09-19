import { useState } from 'react'
import { Chess } from 'chess.js'
import LandingPage from './components/LandingPage'
import LoadPGNPage from './components/LoadPGNPage'
import ColorSelector from './components/ColorSelector'
import GameBoard from './components/GameBoard'

type Screen = 'home' | 'pgn-loader' | 'color-selection' | 'game'
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

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [userColor, setUserColor] = useState<PlayerColor>('white')
  const [game, setGame] = useState<Chess>(new Chess())
  const [moveHistory, setMoveHistory] = useState<MoveRow[]>([])
  const [pendingPgn, setPendingPgn] = useState<string | null>(null)

  const handleNewGame = () => {
    setScreen('color-selection')
    setPendingPgn(null)
  }

  const handleLoadPGN = () => {
    setScreen('pgn-loader')
  }

  const handlePGNLoaded = (pgn: string) => {
    setPendingPgn(pgn)
    setScreen('color-selection')
  }

  const handleColorSelected = (color: PlayerColor) => {
    setUserColor(color)
    
    if (pendingPgn) {
      // Carregar PGN e reconstruir histórico
      const newGame = new Chess()
      try {
        newGame.loadPgn(pendingPgn)
        
        // Reconstruir histórico com FENs
        const tempGame = new Chess()
        const history = newGame.history({ verbose: true })
        const reconstructedHistory: MoveRow[] = []
        
        for (let i = 0; i < history.length; i++) {
          const move = history[i]
          tempGame.move(move.san)
          const currentFen = tempGame.fen()
          const turnNumber = Math.floor(i / 2) + 1
          const isWhite = i % 2 === 0
          
          if (isWhite) {
            reconstructedHistory.push({
              turnNumber,
              white: { san: move.san, fen: currentFen }
            })
          } else {
            const lastRow = reconstructedHistory[reconstructedHistory.length - 1]
            if (lastRow) {
              lastRow.black = { san: move.san, fen: currentFen }
            }
          }
        }
        
        setGame(newGame)
        setMoveHistory(reconstructedHistory)
      } catch (err) {
        console.error('Invalid PGN:', err)
        alert('PGN inválido. Iniciando jogo novo.')
        setGame(new Chess())
        setMoveHistory([])
      }
      setPendingPgn(null)
    } else {
      // Novo jogo vazio
      setGame(new Chess())
      setMoveHistory([])
    }
    
    setScreen('game')
  }

  const handleCancelColorSelection = () => {
    setScreen('home')
    setPendingPgn(null)
  }

  const handleBackHome = () => {
    setScreen('home')
  }

  return (
    <>
      {screen === 'home' && (
        <LandingPage 
          onNewGame={handleNewGame} 
          onLoadPGN={handleLoadPGN} 
        />
      )}
      
      {screen === 'pgn-loader' && (
        <LoadPGNPage 
          onPGNLoaded={handlePGNLoaded}
          onBack={handleBackHome}
        />
      )}
      
      {screen === 'color-selection' && (
        <ColorSelector 
          onSelectColor={handleColorSelected}
          onCancel={handleCancelColorSelection}
        />
      )}
      
      {screen === 'game' && (
        <GameBoard 
          initialGame={game}
          initialHistory={moveHistory}
          userColor={userColor}
          onNewGame={handleNewGame}
          onBackHome={handleBackHome}
        />
      )}
    </>
  )
}

export default App