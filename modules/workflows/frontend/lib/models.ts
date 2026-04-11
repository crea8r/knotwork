/** Canonical list of supported LLM models. Keep in sync with backend runtime/validation.py. */

export interface ModelOption {
  value: string
  label: string
  provider: 'human'
}

export const SUPPORTED_MODELS: ModelOption[] = []

/** agent_ref values for the unified agent node (S7 format: "provider:model-id"). */
export const AGENT_REF_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  { value: 'human',                               label: 'Human (always ask)', group: 'Human' },
]

/** All valid model value strings (with and without provider prefix). */
export const VALID_MODEL_VALUES = new Set<string>([
  ...SUPPORTED_MODELS.map(m => m.value),
])
