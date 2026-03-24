import { useQuery } from '@tanstack/react-query'
import { BACKEND_BASE_URL } from './client'

export interface WorkerStatus {
  alive: boolean | null       // null = Redis unreachable (unknown)
  last_seen_seconds_ago: number | null
}

export interface HealthStatus {
  status: 'ok' | 'degraded'
  version: string
  installation_id: string
  schema_version: string
  min_openclaw_version: string
  worker: WorkerStatus
}

export function useHealthStatus() {
  return useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_BASE_URL}/health`)
      if (!res.ok) throw new Error('health check failed')
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Don't throw on error — banner degrades gracefully when backend is unreachable
    retry: false,
  })
}
