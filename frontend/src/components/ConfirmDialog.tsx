import Modal from './Modal'

interface ConfirmDialogProps {
  eyebrow: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

// Asks the user to confirm an action, in the app's own modal instead of the browser's confirm().
export default function ConfirmDialog({ eyebrow, title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal eyebrow={eyebrow} title={title} description={description} onCancel={onCancel}>
      <button className="primary-action full" onClick={onConfirm} autoFocus style={{ padding: '16px' }}>
        {confirmLabel}
      </button>
    </Modal>
  )
}
