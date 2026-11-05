import type { ReactNode } from 'react'

const ArrowLeft = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
)

interface ModalProps {
  eyebrow: string
  title: string
  description: string
  onCancel: () => void
  children: ReactNode
}

export default function Modal({ eyebrow, title, description, onCancel, children }: ModalProps) {
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
        width: 'calc(100% - 32px)',
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
        textAlign: 'center'
      }}>
        <span className="eyebrow small">{eyebrow}</span>
        <h1 style={{
          fontSize: '32px',
          margin: '16px 0 12px',
          color: 'var(--cream)',
          fontWeight: 500
        }}>
          {title}
        </h1>
        <p style={{
          color: '#abb0a8',
          fontSize: '14px',
          marginBottom: '30px'
        }}>
          {description}
        </p>
        {children}
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
