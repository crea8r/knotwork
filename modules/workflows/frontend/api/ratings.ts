import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@sdk'

export interface RatingCreate {
  score: number
  comment?: string
}

export interface RatingOut {
  id: string
  run_id: string
  run_node_state_id: string
  workspace_id: string
  score: number
  comment: string | null
  created_at: string
}

export function useSubmitRating(workspaceId: string, runId: string, nodeStateId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RatingCreate) =>
      api
        .post<RatingOut>(
          `/workspaces/${workspaceId}/runs/${runId}/nodes/${nodeStateId}/rating`,
          data,
        )
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-nodes', runId] })
    },
  })
}
