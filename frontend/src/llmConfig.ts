// Mirrors PROVIDER_DEFAULTS in backend/services/llm_service.py
export const LLM_PROVIDERS = {
  gemini: {
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/'
  },
  ollama: {
    label: 'Ollama',
    model: 'llama3.2:3b',
    baseUrl: 'http://localhost:11434/v1'
  }
}

export type LLMProvider = keyof typeof LLM_PROVIDERS

// Field names match the BYOK fields of the /semantic-evaluation request.
export interface LLMConfig {
  provider: LLMProvider
  api_key: string
  model: string
  base_url: string
}

const STORAGE_KEY = 'chesstrainer.llm-config'

// sessionStorage keeps the API key off the disk: it survives a reload, not closing the tab.
export function loadLLMConfig(): LLMConfig | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function saveLLMConfig(config: LLMConfig | null) {
  try {
    if (config) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch (err) {
    console.error('Could not persist LLM settings:', err)
  }
}
