import { API_BASE_URL } from './api'

export interface LLMProviderOption {
  label: string
  model: string
  base_url: string
  requires_api_key: boolean
  uses_llm: boolean
}

// Served by the backend, which owns the available providers and their defaults.
export interface LLMProviderCatalog {
  default_provider: string
  providers: Record<string, LLMProviderOption>
}

// Field names match the BYOK fields of the /semantic-evaluation request.
export interface LLMConfig {
  provider: string
  api_key: string
  model: string
  base_url: string
}

export async function fetchLLMProviders(): Promise<LLMProviderCatalog> {
  const response = await fetch(`${API_BASE_URL}/llm-providers`)
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
  return response.json()
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
