import { useState } from 'react'
import { Chess } from 'chess.js'

const ArrowRight = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
)

const ArrowLeft = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
)

const X = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

const FileUp = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="18" x2="12" y2="12"/>
    <line x1="9" y1="15" x2="12" y2="12"/>
    <line x1="15" y1="15" x2="12" y2="12"/>
  </svg>
)

interface LoadPGNPageProps {
  onPGNLoaded: (pgn: string) => void
  onBack: () => void
}

export default function LoadPGNPage({ onPGNLoaded, onBack }: LoadPGNPageProps) {
  const [pgnText, setPgnText] = useState('')
  const [error, setError] = useState('')
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setPgnText(content)
      setError('')
    }
    reader.onerror = () => {
      setError('Erro ao ler o arquivo')
    }
    reader.readAsText(file)
  }
  
  const handleLoadPgn = () => {
    if (!pgnText.trim()) {
      setError('Por favor, insira um PGN válido.')
      return
    }
    
    // Validar PGN antes de carregar
    try {
      const testGame = new Chess()
      testGame.loadPgn(pgnText)
      
      // Se chegou aqui, o PGN é válido
      setError('')
      onPGNLoaded(pgnText)
    } catch (err) {
      setError('PGN inválido. Verifique o formato e tente novamente.')
      console.error('PGN parse error:', err)
    }
  }

  return (
    <main className="loader-page">
      <header className="topbar">
        <button className="brand compact" onClick={onBack}>
          <span className="brand-mark">♞</span>
          <span>chess<span className="gold">trainer</span></span>
        </button>
        <button className="icon-btn" onClick={onBack} aria-label="Fechar">
          <X />
        </button>
      </header>
      <section className="loader-card">
        <div className="upload-icon">
          <FileUp />
        </div>
        <span className="eyebrow small">CONTINUAR PARTIDA</span>
        <h1>Carregue seu PGN</h1>
        <p>Cole a notação da sua partida abaixo ou faça upload de um arquivo para continuar a análise.</p>
        
        {/* Upload de arquivo */}
        <div style={{ marginBottom: '12px' }}>
          <input
            type="file"
            accept=".pgn,.txt"
            onChange={handleFileUpload}
            style={{
              width: '100%',
              padding: '12px',
              background: '#1a1e1a',
              border: '1px solid #394139',
              borderRadius: '7px',
              color: '#d7d7cc',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          />
        </div>
        
        <textarea 
          value={pgnText} 
          onChange={e => {
            setPgnText(e.target.value)
            setError('')
          }}
          placeholder={'[Event "Minha partida"]\n[White "Você"]\n[Black "Oponente"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5'}
        />
        
        {error && (
          <div style={{
            padding: '12px',
            background: '#3d2020',
            color: '#ff6b6b',
            borderRadius: '6px',
            marginTop: '12px',
            fontSize: '12px',
            border: '1px solid #5a2a2a'
          }}>
            ⚠️ {error}
          </div>
        )}
        
        <button 
          className="primary-action full" 
          onClick={handleLoadPgn}
          style={{ marginTop: '12px' }}
        >
          <ArrowRight /> Carregar e jogar
        </button>
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={15} /> Voltar ao início
        </button>
      </section>
    </main>
  )
}
