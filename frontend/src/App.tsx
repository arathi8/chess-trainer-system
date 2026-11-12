import { useState } from 'react'
import { Chess } from 'chess.js'
import LandingPage from './components/LandingPage'
import LoadPGNPage from './components/LoadPGNPage'
import ColorSelector from './components/ColorSelector'
import GameBoard from './components/GameBoard'
import type { GameMode } from './components/GameBoard'
import { loadLLMConfig, saveLLMConfig } from './llmConfig'
import type { LLMConfig } from './llmConfig'

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
  const [gameMode, setGameMode] = useState<GameMode>('training')
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(loadLLMConfig)

  const handleLLMConfigChange = (config: LLMConfig | null) => {
    setLlmConfig(config)
    saveLLMConfig(config)
  }

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
      const newGame = new Chess()
      try {
        newGame.loadPgn(pendingPgn)
        
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
        setGameMode('review')
      } catch (err) {
        console.error('Invalid PGN:', err)
        alert('PGN inválido. Iniciando jogo novo.')
        setGame(new Chess())
        setMoveHistory([])
        setGameMode('training')
      }
      setPendingPgn(null)
    } else {
      setGame(new Chess())
      setMoveHistory([])
      setGameMode('training')
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
          importing={pendingPgn !== null}
          onSelectColor={handleColorSelected}
          onCancel={handleCancelColorSelection}
        />
      )}
      
      {screen === 'game' && (
        <GameBoard 
          initialGame={game}
          initialHistory={moveHistory}
          userColor={userColor}
          mode={gameMode}
          llmConfig={llmConfig}
          onLLMConfigChange={handleLLMConfigChange}
          onNewGame={handleNewGame}
          onBackHome={handleBackHome}
        />
      )}
    </>
  )
}

export default App