import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'

const Plus = ({ size = 19 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const ArrowRight = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
const Upload = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>

const Book = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>

interface LandingPageProps {
  onNewGame: () => void
  onLoadPGN: () => void
  onLearnRepertoire: () => void
}

export default function LandingPage({ onNewGame, onLoadPGN, onLearnRepertoire }: LandingPageProps) {
  return (
    <main className="landing">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="landing-header">
        <div className="brand">
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </div>
        <span className="beta">BETA</span>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <h1>Jogue melhor.<br /><em>Entenda</em> mais.</h1>
          <p>Treine xadrez com feedback em tempo real. Cada lance é uma oportunidade de aprender.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={onNewGame}>
              <Plus /> Novo jogo <ArrowRight />
            </button>
            <button className="secondary-action" onClick={onLoadPGN}>
              <Upload /> Carregar PGN
            </button>
            <button className="secondary-action" onClick={onLearnRepertoire}>
              <Book /> Aprender repertório
            </button>
          </div>
        </div>
        <div className="hero-board">
          <div className="board-glow" />
          <div style={{ 
            position: 'relative',
            width: '100%',
            aspectRatio: '1',
            boxShadow: '0 15px 60px rgba(0,0,0,0.6)',
            border: '10px solid #29271f',
            overflow: 'hidden'
          }}>
            <Chessboard
              options={{
                position: new Chess().fen(),
                boardOrientation: 'white'
              }}
            />
          </div>
          <div className="board-caption">
            <span><span className="live-dot" /> Análise ao vivo </span>
            <span>com Stockfish e LLM</span>
          </div>
        </div>
      </section>
    </main>
  )
}
