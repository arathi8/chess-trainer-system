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

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [userColor, setUserColor] = useState<PlayerColor>('white')
  const [game, setGame] = useState<Chess>(new Chess())
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
        setGame(newGame)
        setGameMode('review')
      } catch (err) {
        console.error('Invalid PGN:', err)
        alert('PGN inválido. Iniciando jogo novo.')
        setGame(new Chess())
        setGameMode('training')
      }
      setPendingPgn(null)
    } else {
      setGame(new Chess())
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