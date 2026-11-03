import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'
import { fetchLLMProviders } from '../llmConfig'
import type { LLMConfig, LLMProviderCatalog } from '../llmConfig'

const emptyConfig = (provider: string): LLMConfig => ({
  provider,
  api_key: '',
  model: '',
  base_url: ''
})

interface LLMSettingsFormProps {
  catalog: LLMProviderCatalog
  config: LLMConfig | null
  onSave: (config: LLMConfig | null) => void
}

function LLMSettingsForm({ catalog, config, onSave }: LLMSettingsFormProps) {
  const [draft, setDraft] = useState<LLMConfig>(
    config && catalog.providers[config.provider]
      ? config
      : emptyConfig(catalog.default_provider)
  )
  const defaults = catalog.providers[draft.provider]

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
    <form className="settings-form" onSubmit={handleSubmit}>
      <label>
        Provedor
        <select
          value={draft.provider}
          // Key, model and URL belong to one provider: never carry them over to another.
          onChange={e => setDraft(emptyConfig(e.target.value))}
        >
          {Object.entries(catalog.providers).map(([id, { label }]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </label>

      {defaults.uses_llm ? (
        <>
          <label>
            Chave de API
            <input
              type="password"
              autoComplete="off"
              required={defaults.requires_api_key}
              value={draft.api_key}
              onChange={e => updateField('api_key', e.target.value)}
              placeholder={defaults.requires_api_key ? 'Sua chave de API' : 'Não necessária'}
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
              placeholder={defaults.base_url}
            />
          </label>
        </>
      ) : (
        <p className="message system">
          Nenhuma LLM será chamada: "Avaliar lance" exibirá o prompt gerado para você copiar.
        </p>
      )}

      <button type="submit" className="primary-action full">
        Salvar
      </button>
      <button
        type="button"
        className="outline-btn full"
        onClick={() => onSave(null)}
      >
        Remover configuração
      </button>
    </form>
  )
}

interface LLMSettingsProps {
  config: LLMConfig | null
  onSave: (config: LLMConfig | null) => void
  onCancel: () => void
}

export default function LLMSettings({ config, onSave, onCancel }: LLMSettingsProps) {
  const [catalog, setCatalog] = useState<LLMProviderCatalog | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    fetchLLMProviders()
      .then(setCatalog)
      .catch(err => {
        console.error('LLM providers error:', err)
        setLoadFailed(true)
      })
  }, [])

  return (
    <Modal
      eyebrow="TREINADOR"
      title="Configurar LLM"
      description="Use sua própria chave para gerar o feedback do treinador. Modelo e URL em branco usam o padrão do provedor."
      onCancel={onCancel}
    >
      {catalog ? (
        <LLMSettingsForm catalog={catalog} config={config} onSave={onSave} />
      ) : (
        <p className="message system">
          {loadFailed
            ? 'Não foi possível carregar os provedores do servidor.'
            : 'Carregando provedores...'}
        </p>
      )}
    </Modal>
  )
}
