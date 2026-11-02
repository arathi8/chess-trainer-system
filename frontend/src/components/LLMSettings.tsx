import { useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'
import { LLM_PROVIDERS } from '../llmConfig'
import type { LLMConfig, LLMProvider } from '../llmConfig'

const emptyConfig = (provider: LLMProvider): LLMConfig => ({
  provider,
  api_key: '',
  model: '',
  base_url: ''
})

interface LLMSettingsProps {
  config: LLMConfig | null
  onSave: (config: LLMConfig | null) => void
  onCancel: () => void
}

export default function LLMSettings({ config, onSave, onCancel }: LLMSettingsProps) {
  const [draft, setDraft] = useState<LLMConfig>(config ?? emptyConfig('gemini'))
  const defaults = LLM_PROVIDERS[draft.provider]

  const updateField = (field: 'api_key' | 'model' | 'base_url', value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      provider: draft.provider,
      api_key: draft.api_key.trim(),
      model: draft.model.trim(),
      base_url: draft.base_url.trim()
    })
  }

  return (
    <Modal
      eyebrow="TREINADOR"
      title="Configurar LLM"
      description="Use sua própria chave para gerar o feedback do treinador. Campos em branco usam a configuração do servidor."
      onCancel={onCancel}
    >
      <form className="settings-form" onSubmit={handleSubmit}>
        <label>
          Provedor
          <select
            value={draft.provider}
            // Key, model and URL belong to one provider: never carry them over to another.
            onChange={e => setDraft(emptyConfig(e.target.value as LLMProvider))}
          >
            {Object.entries(LLM_PROVIDERS).map(([id, { label }]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          Chave de API
          <input
            type="password"
            autoComplete="off"
            value={draft.api_key}
            onChange={e => updateField('api_key', e.target.value)}
            placeholder={draft.provider === 'ollama' ? 'Não necessária' : 'Chave do servidor'}
          />
        </label>

        <label>
          Modelo
          <input
            value={draft.model}
            onChange={e => updateField('model', e.target.value)}
            placeholder={defaults.model}
          />
        </label>

        <label>
          URL base
          <input
            type="url"
            value={draft.base_url}
            onChange={e => updateField('base_url', e.target.value)}
            placeholder={defaults.baseUrl}
          />
        </label>

        <button type="submit" className="primary-action full">
          Salvar
        </button>
        <button
          type="button"
          className="outline-btn full"
          onClick={() => onSave(null)}
        >
          Restaurar padrão do servidor
        </button>
      </form>
    </Modal>
  )
}
