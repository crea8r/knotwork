/** Canonical list of supported LLM models. Keep in sync with backend runtime/validation.py. */

export interface ModelOption {
  value: string
  label: string
  provider: 'openai' | 'anthropic'
}

export const SUPPORTED_MODELS: ModelOption[] = [
  // OpenAI
  { value: 'openai/gpt-4o',       label: 'GPT-4o',           provider: 'openai' },
  { value: 'openai/gpt-4o-mini',  label: 'GPT-4o mini',      provider: 'openai' },
  { value: 'openai/gpt-4-turbo',  label: 'GPT-4 Turbo',      provider: 'openai' },
  { value: 'openai/gpt-3.5-turbo',label: 'GPT-3.5 Turbo',    provider: 'openai' },
  // Anthropic
  { value: 'anthropic/claude-opus-4-6',           label: 'Claude Opus 4.6',   provider: 'anthropic' },
  { value: 'anthropic/claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { value: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  provider: 'anthropic' },
]

/** agent_ref values for the unified agent node (S7 format: "provider:model-id"). */
export const AGENT_REF_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  { value: 'anthropic:claude-opus-4-6',           label: 'Claude Opus 4.6',   group: 'Anthropic' },
  { value: 'anthropic:claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', group: 'Anthropic' },
  { value: 'anthropic:claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  group: 'Anthropic' },
  { value: 'openai:gpt-4o',                       label: 'GPT-4o',            group: 'OpenAI' },
  { value: 'openai:gpt-4o-mini',                  label: 'GPT-4o mini',       group: 'OpenAI' },
  { value: 'human',                               label: 'Human (always ask)', group: 'Human' },
]

/** All valid model value strings (with and without provider prefix). */
export const VALID_MODEL_VALUES = new Set<string>([
  ...SUPPORTED_MODELS.map(m => m.value),
  // Also accept without prefix (e.g. "gpt-4o", "claude-sonnet-4-6")
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
  'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
])
