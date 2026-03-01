/**
 * All mock data in one place.
 * Each export is annotated with when it can be removed.
 */

// MOCK — remove when: POST /runs supports file attachments (S6)
export const MOCK_FILE_UPLOAD = true

// MOCK — remove when: run ETA computed from historical data (S6+)
export const MOCK_ETA = (nodeCount: number) => `~${nodeCount * 2} min`

// MOCK — remove when: Settings API implemented (S8)
export const MOCK_WORKSPACE = {
  name: 'Dev Workspace',
  slug: 'dev-workspace',
  plan: 'Pro',
  created_at: '2025-01-01T00:00:00Z',
}

// MOCK — remove when: Members API implemented (S8)
export const MOCK_MEMBERS = [
  { id: '1', name: 'Alice Chen', email: 'alice@example.com', role: 'owner' },
  { id: '2', name: 'Bob Ray', email: 'bob@example.com', role: 'operator' },
  { id: '3', name: 'Carol Wu', email: 'carol@example.com', role: 'operator' },
]


