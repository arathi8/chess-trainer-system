import Modal from './Modal'

interface ColorSelectorProps {
  onSelectColor: (color: 'white' | 'black') => void
  onCancel: () => void
  // Choosing the side the user played in an imported PGN, rather than a new game
  importing?: boolean
}

export default function ColorSelector({ onSelectColor, onCancel, importing = false }: ColorSelectorProps) {
  return (
    <Modal
      eyebrow={importing ? 'PARTIDA IMPORTADA' : 'NOVO JOGO'}
      title={importing ? 'Com quais peças você jogou?' : 'Escolha sua cor'}
      description={
        importing
          ? 'Selecione o seu lado na partida: apenas os seus lances serão analisados.'
          : 'Selecione com qual cor você deseja jogar nesta partida.'
      }
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
          {importing ? '♙ Brancas' : '♙ Jogar com Brancas'}
        </button>
        <button
          className="primary-action full"
          onClick={() => onSelectColor('black')}
          style={{ padding: '16px' }}
        >
          {importing ? '♟ Pretas' : '♟ Jogar com Pretas'}
        </button>
      </div>
    </Modal>
  )
}
