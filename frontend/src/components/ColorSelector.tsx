import Modal from './Modal'

interface ColorSelectorProps {
  onSelectColor: (color: 'white' | 'black') => void
  onCancel: () => void
}

export default function ColorSelector({ onSelectColor, onCancel }: ColorSelectorProps) {
  return (
    <Modal
      eyebrow="NOVO JOGO"
      title="Escolha sua cor"
      description="Selecione com qual cor você deseja jogar nesta partida."
      onCancel={onCancel}
    >
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
    </Modal>
  )
}
