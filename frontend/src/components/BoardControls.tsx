import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Navigation } from '../moveTree'

const icon = (points: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {points.split('|').map(p => <polyline key={p} points={p} />)}
  </svg>
)

const CONTROLS: { action: Navigation; title: string; icon: ReactNode }[] = [
  { action: 'first', title: 'Início (↑ / Home)', icon: icon('11 17 6 12 11 7|18 17 13 12 18 7') },
  { action: 'previous', title: 'Lance anterior (←)', icon: icon('15 18 9 12 15 6') },
  { action: 'next', title: 'Próximo lance (→)', icon: icon('9 18 15 12 9 6') },
  { action: 'last', title: 'Último lance (↓ / End)', icon: icon('13 17 18 12 13 7|6 17 11 12 6 7') }
]

const KEYS: Record<string, Navigation> = {
  ArrowLeft: 'previous',
  ArrowRight: 'next',
  ArrowUp: 'first',
  Home: 'first',
  ArrowDown: 'last',
  End: 'last'
}

interface BoardControlsProps {
  canGoBack: boolean
  canGoForward: boolean
  // Off while a dialog is open, so its inputs keep the arrow keys.
  keyboard: boolean
  onNavigate: (action: Navigation) => void
}

export default function BoardControls({ canGoBack, canGoForward, keyboard, onNavigate }: BoardControlsProps) {
  useEffect(() => {
    if (!keyboard) return

    const onKeyDown = (event: KeyboardEvent) => {
      const action = KEYS[event.key]
      const target = event.target as HTMLElement
      if (!action || event.altKey || event.ctrlKey || event.metaKey || target.closest('input, textarea, select')) return
      event.preventDefault()
      onNavigate(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboard, onNavigate])

  const enabled = (action: Navigation) => (action === 'first' || action === 'previous' ? canGoBack : canGoForward)

  return (
    <div className="board-controls">
      {CONTROLS.map(control => (
        <button
          key={control.action}
          className="outline-btn"
          title={control.title}
          aria-label={control.title}
          disabled={!enabled(control.action)}
          onClick={() => onNavigate(control.action)}
        >
          {control.icon}
        </button>
      ))}
    </div>
  )
}
