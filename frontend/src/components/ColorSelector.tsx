const ArrowLeft = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
)

interface ColorSelectorProps {
  onSelectColor: (color: 'white' | 'black') => void
  onCancel: () => void
}

export default function ColorSelector({ onSelectColor, onCancel }: ColorSelectorProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: '12px',
        padding: '40px',
        maxWidth: '420px',
        textAlign: 'center'
      }}>
        <span className="eyebrow small">NOVO JOGO</span>
        <h1 style={{ 
          fontSize: '32px', 
          margin: '16px 0 12px', 
          color: 'var(--cream)',
          fontWeight: 500 
        }}>
          Escolha sua cor
        </h1>
        <p style={{ 
          color: '#abb0a8', 
          fontSize: '14px', 
          marginBottom: '30px' 
        }}>
          Selecione com qual cor você deseja jogar nesta partida.
        </p>
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px' 
        }}>
          <button 
            className="primary-action full" 
            onClick={() => onSelectColor('white')}
            style={{ padding: '16px' }}
          >
            ♙ Jogar com Brancas
          </button>
          <button 
            className="primary-action full" 
            onClick={() => onSelectColor('black')}
            style={{ padding: '16px' }}
          >
            ♟ Jogar com Pretas
          </button>
        </div>
        <button 
          className="back-link" 
          onClick={onCancel}
          style={{ marginTop: '24px' }}
        >
          <ArrowLeft size={15} /> Cancelar
        </button>
      </div>
    </div>
  )
}
