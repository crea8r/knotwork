import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '')
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

export interface SetupRunState {
  operation: 'install' | 'uninstall'
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  exit_code: number | null
  logs: string[]
}

export interface SetupStatus {
  repo_root: string
  installed: boolean
  install_markers?: string[]
  running: boolean
  current: SetupRunState | null
}

export interface InstallDetection {
  install_dir: string
  installed: boolean
  install_markers: string[]
  runtime_profile?: 'dev' | 'prod' | 'local' | null
  distribution_code?: string | null
  distribution_label?: string | null
  frontend_surfaces?: Array<{
    key?: string
    label?: string
    description?: string
    url?: string
  }>
}

export interface SetupInstallRequest {
  install_mode: 'dev' | 'prod'
  install_dir: string
  owner_name: string
  owner_email: string
  owner_password: string
  domain: string
  distribution_choice: 'chimera' | 'manticore' | 'both'
  storage_adapter: string
  local_fs_root: string
  default_model: string
  jwt_secret: string
  backend_port: number
  frontend_port: number
  frontend_url: string
  backend_url: string
  restore_backup_path: string
  openclaw_in_docker: boolean
  plugin_url: string
  resend_api: string
  email_from: string
}

export interface SetupUninstallRequest {
  install_dir: string
  skip_backup: boolean
  backup_dir: string
  assume_yes: boolean
}

export interface BackupFile {
  name: string
  path: string
  created_at: string
  size_bytes: number
  stale: boolean
  stale_reason: string
  metadata?: Record<string, unknown>
}

export function useSetupStatus() {
  return useQuery<SetupStatus>({
    queryKey: ['setup-status'],
    queryFn: () => api.get('/setup/status').then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : 5000),
    staleTime: 1000,
    retry: false,
  })
}

export function useDetectInstall(installDir: string) {
  return useQuery<InstallDetection>({
    queryKey: ['setup-detect-install', installDir],
    queryFn: () =>
      api.get('/setup/detect-install', { params: { install_dir: installDir } }).then((r) => r.data),
    enabled: Boolean(installDir.trim()),
    staleTime: 1000,
    retry: false,
  })
}

export function useBackups(backupDir: string) {
  return useQuery<{ backups: BackupFile[] }>({
    queryKey: ['setup-backups', backupDir],
    queryFn: () => api.get('/setup/backups', { params: { backup_dir: backupDir } }).then((r) => r.data),
    enabled: Boolean(backupDir.trim()),
    staleTime: 1000,
    retry: false,
  })
}

export function useDeleteBackups() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (paths: string[]) => api.post('/setup/backups/delete', { paths }).then((r) => r.data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['setup-backups'] })
    },
  })
}

export function useStartInstall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SetupInstallRequest) => api.post('/setup/install', payload).then((r) => r.data as SetupStatus),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      await queryClient.invalidateQueries({ queryKey: ['setup-detect-install', variables.install_dir] })
    },
  })
}

export function useStartUninstall() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SetupUninstallRequest) => api.post('/setup/uninstall', payload).then((r) => r.data as SetupStatus),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      await queryClient.invalidateQueries({ queryKey: ['setup-detect-install', variables.install_dir] })
    },
  })
}

export function useCancelSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/setup/cancel').then((r) => r.data as SetupStatus),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      await queryClient.invalidateQueries({ queryKey: ['setup-detect-install'] })
    },
  })
}
