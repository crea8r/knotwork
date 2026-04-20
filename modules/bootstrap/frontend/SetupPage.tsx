import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, AlignJustify, CheckCircle2, ChevronDown, ChevronRight, FolderOpen, Maximize2, Minimize2, Play, RefreshCw, Rocket, Shield, SlidersHorizontal, Square, Trash2, Wrench, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  useCancelSetup,
  useBackups,
  useDeleteBackups,
  useDetectInstall,
  useSetupStatus,
  useStartInstall,
  useStartUninstall,
  type SetupInstallRequest,
} from '@modules/bootstrap/frontend/setup'
import { buildInstallPreflight, isValidDomain, isValidEmail, isValidPort } from '@modules/bootstrap/frontend/setupPlanner'
import Btn from '@ui/components/Btn'
import ConfirmDialog from '@ui/components/ConfirmDialog'
import Card from '@ui/components/Card'

type Mode = 'install' | 'uninstall'
type ModelChoice = 'human' | 'custom'
type DistributionChoice = 'chimera' | 'manticore' | 'both'

type InstallField =
  | 'installDir'
  | 'ownerName'
  | 'ownerEmail'
  | 'ownerPassword'
  | 'domain'
  | 'localFsRoot'
  | 'defaultModel'
  | 'customDefaultModel'
  | 'jwtSecret'
  | 'backendPort'
  | 'frontendPort'
  | 'frontendUrl'
  | 'backendUrl'
  | 'pluginUrl'
  | 'resendApi'
  | 'emailFrom'

type UninstallField = 'installDir' | 'backupDir'

type TouchedMap<K extends string> = Partial<Record<K, boolean>>

type DirectoryInputElement = HTMLInputElement & {
  webkitdirectory?: boolean
  directory?: boolean
}

type FieldAnchorMap = Partial<Record<InstallField | UninstallField, HTMLDivElement | null>>
const ADVANCED_INSTALL_FIELDS: InstallField[] = ['localFsRoot', 'defaultModel', 'customDefaultModel', 'jwtSecret']
const DEFAULT_INSTALL_DIR = '~/.knotwork'
const LAST_SUCCESSFUL_INSTALL_DIR_KEY = 'knotwork-bootstrap:last-successful-install-dir'

function readLastSuccessfulInstallDir() {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(LAST_SUCCESSFUL_INSTALL_DIR_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

function writeLastSuccessfulInstallDir(installDir: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_SUCCESSFUL_INSTALL_DIR_KEY, installDir)
  } catch {
    // ignore storage failures
  }
}

function isValidUrl(value: string) {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidSubdomainPart(value: string) {
  if (!value.trim()) return true
  return value
    .trim()
    .split('.')
    .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))
}

function buildPublicUrl(domain: string, subdomain: string) {
  const trimmedDomain = domain.trim()
  const trimmedSubdomain = subdomain.trim()
  if (!trimmedDomain) return ''
  return trimmedSubdomain ? `https://${trimmedSubdomain}.${trimmedDomain}` : `https://${trimmedDomain}`
}

function formatBackupDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function sanitizePort(value: string) {
  return value.replace(/\D/g, '').slice(0, 5)
}

function generateJwtSecret() {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function describeInstalledProfile(runtimeProfile?: 'dev' | 'prod' | 'local' | null, installed?: boolean) {
  if (!installed) {
    return {
      label: 'No instance',
      tone: 'text-amber-700',
    }
  }

  if (runtimeProfile === 'dev') {
    return {
      label: 'Dev install',
      tone: 'text-emerald-700',
    }
  }

  if (runtimeProfile === 'prod') {
    return {
      label: 'Production install',
      tone: 'text-emerald-700',
    }
  }

  return {
    label: 'Installed',
    tone: 'text-emerald-700',
  }
}

function describeDistributionChoice(choice: DistributionChoice, installMode: 'dev' | 'prod') {
  if (choice === 'chimera') {
    return {
      label: 'chimera',
      description: 'Full workspace with inbox, projects, channels, knowledge, and workflows.',
    }
  }
  if (choice === 'manticore') {
    return {
      label: 'manticore',
      description: 'Focused workspace for knowledge, workflow design, and runs.',
    }
  }
  return {
    label: installMode === 'dev' ? 'chimera + manticore' : 'dual workspace profile',
    description: 'Starts both local workspace distributions against the shared dev backend.',
  }
}

function replaceLastPathSegment(path: string, folderName: string) {
  const trimmed = path.trim()
  if (!trimmed) return folderName
  const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return folderName
  return `${normalized.slice(0, lastSlash + 1)}${folderName}`
}

type PickerTarget = 'install' | 'backup'

function FieldShell({
  label,
  required = false,
  error,
  help,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  help?: string
  children: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 flex min-h-[1.25rem] items-center gap-1 text-xs font-medium text-gray-700">
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </span>
      {children}
      <div className="mt-1 min-h-[1.125rem]">
        {error ? (
          <p className="text-[11px] text-red-600">{error}</p>
        ) : help ? (
          <p className="text-[11px] text-gray-400">{help}</p>
        ) : null}
      </div>
    </label>
  )
}

function TextField({
  label,
  required,
  value,
  onChange,
  onBlur,
  error,
  help,
  type = 'text',
  inputMode,
  maxLength,
  placeholder,
  action,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  error?: string
  help?: string
  type?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  placeholder?: string
  action?: ReactNode
}) {
  return (
    <FieldShell label={label} required={required} error={error} help={help}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          inputMode={inputMode}
          maxLength={maxLength}
          placeholder={placeholder}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            error
              ? 'border-red-300 focus:ring-red-200'
              : 'border-gray-200 focus:ring-brand-400'
          }`}
        />
        {action ? <div className="min-w-0 sm:shrink-0">{action}</div> : null}
      </div>
    </FieldShell>
  )
}

function SubdomainField({
  label,
  value,
  onChange,
  onBlur,
  error,
  help,
  rootDomain,
  placeholder,
  previewUrl,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  error?: string
  help?: string
  rootDomain: string
  placeholder?: string
  previewUrl: string
}) {
  const hasError = Boolean(error)
  const suffix = rootDomain ? `.${rootDomain}` : '.domain.com'
  const showSuffixOverflowHint = suffix.length > 20

  return (
    <FieldShell label={label} error={error} help={help}>
      <div className={`min-w-0 max-w-full overflow-hidden rounded-xl border bg-white ${
        hasError ? 'border-red-300' : 'border-slate-200'
      }`}>
        <div className="flex min-w-0 overflow-hidden">
          <div className={`flex shrink-0 items-center border-r px-2 text-xs md:px-3 md:text-sm ${
            hasError ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-500'
          }`}>
            https://
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            className="min-w-[4rem] flex-1 px-2 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none md:px-3"
          />
          <div
            className={`relative flex max-w-[46%] shrink items-center overflow-x-auto whitespace-nowrap border-l px-2 text-xs [scrollbar-width:none] md:max-w-[55%] md:px-3 md:text-sm [&::-webkit-scrollbar]:hidden ${
            hasError ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-500'
          }`}
            title={suffix}
          >
            <span className={showSuffixOverflowHint ? 'pr-5' : undefined}>{suffix}</span>
            {showSuffixOverflowHint ? (
              <span
                aria-hidden="true"
                className={`pointer-events-none sticky right-0 ml-1 flex h-full items-center pl-4 ${
                  hasError
                    ? 'bg-gradient-to-l from-red-50 via-red-50 to-transparent text-red-500'
                    : 'bg-gradient-to-l from-slate-50 via-slate-50 to-transparent text-slate-400'
                }`}
              >
                <ChevronRight size={13} />
              </span>
            ) : null}
          </div>
        </div>
        <div className={`border-t px-3 py-2 ${
          hasError ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-slate-50'
        }`}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Preview URL</p>
          <p className="mt-1 break-all font-mono text-sm text-slate-900">{previewUrl || 'https://domain.com'}</p>
        </div>
      </div>
    </FieldShell>
  )
}

function SelectField({
  label,
  required,
  value,
  onChange,
  onBlur,
  error,
  help,
  options,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  error?: string
  help?: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <FieldShell label={label} required={required} error={error} help={help}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-300 focus:ring-red-200'
            : 'border-gray-200 focus:ring-brand-400'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

function ToneChip({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'brand'
  children: ReactNode
}) {
  const styles = {
    neutral: 'border-gray-200 bg-white text-gray-700',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    brand: 'border-sky-200 bg-sky-50 text-sky-800',
  }[tone]

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>{children}</span>
}

function SectionCard({
  title,
  kicker,
  children,
}: {
  title: string
  kicker?: string
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        {kicker ? <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{kicker}</p> : null}
        <p className="mt-1 text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <div className="px-4 py-4">{children}</div>
    </Card>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

function DesktopStatusRail({
  open,
  onToggle,
  children,
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`fixed top-1/2 z-[55] hidden h-36 w-12 -translate-y-1/2 flex-col items-center justify-center gap-3 rounded-l-2xl bg-slate-950 text-white shadow-xl transition-[right] duration-300 lg:inline-flex ${
          open ? 'right-[26rem]' : 'right-0'
        }`}
        aria-label={open ? 'Hide status board' : 'Show status board'}
      >
        <Wrench size={18} />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-[0.24em]">
          Status
        </span>
      </button>
      <div className={`fixed inset-0 z-50 hidden lg:block ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-slate-950/28 backdrop-blur-[2px] transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onToggle}
        />
        <div
          className={`absolute inset-y-0 right-0 flex w-[26rem] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Quick Check</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">Status board</p>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-full border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50"
              aria-label="Close status board"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-auto px-5 py-5">
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

function StatusContent({
  installDetection,
  installDir,
  currentRun,
  activeMode,
  preflight,
  refetch,
  cancelSetup,
  isRunning,
}: {
  installDetection: {
    installed?: boolean
    install_dir?: string
    install_markers?: string[]
    runtime_profile?: 'dev' | 'prod' | 'local' | null
    distribution_code?: string | null
    distribution_label?: string | null
    frontend_surfaces?: Array<{ key?: string; label?: string; description?: string; url?: string }>
  } | undefined
  installDir: string
  currentRun: { operation: string; status: string } | null | undefined
  activeMode: Mode
  preflight: string[]
  refetch: () => void
  cancelSetup: { mutateAsync: () => Promise<unknown>; isPending: boolean }
  isRunning: boolean
}) {
  const installedProfile = describeInstalledProfile(installDetection?.runtime_profile, installDetection?.installed)
  const installedDistribution = installDetection?.distribution_code || installDetection?.distribution_label

  return (
    <div className="space-y-4">
      <SectionCard title="Status board" kicker="Quick Check">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Installed</p>
            <p className={`mt-1 text-lg font-semibold ${installedProfile.tone}`}>
              {installedProfile.label}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Task</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{currentRun?.status ?? 'idle'}</p>
          </div>
        </div>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Install target</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-800">{installDetection?.install_dir ?? installDir}</p>
        </div>
        {installedDistribution ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Distribution</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{installedDistribution}</p>
          </div>
        ) : null}
        {installDetection?.frontend_surfaces?.length ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Workspace entrypoints</p>
            <div className="mt-2 space-y-2">
              {installDetection.frontend_surfaces.map((surface, index) => (
                <div key={surface.key ?? surface.url ?? `${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{surface.label ?? 'Workspace'}</p>
                  {surface.description ? <p className="mt-1 text-xs text-slate-500">{surface.description}</p> : null}
                  {surface.url ? <p className="mt-1 break-all font-mono text-xs text-slate-700">{surface.url}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {installDetection?.install_markers?.length ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Markers</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {installDetection.install_markers.map((marker) => (
                <ToneChip key={marker} tone="warn">{marker}</ToneChip>
              ))}
            </div>
          </div>
        ) : null}
        {currentRun ? (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Current operation</p>
            <p className="mt-1 text-sm text-slate-800">{currentRun.operation}</p>
          </div>
        ) : null}
      </SectionCard>

      {activeMode === 'install' ? (
        <SectionCard title="Preflight" kicker="Before Run">
          <div className="grid gap-2">
            {preflight.map((item) => (
              <div key={item} className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-600" />
                <p className="text-xs text-gray-700">{item}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Controls" kicker="Task">
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={() => void refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => void cancelSetup.mutateAsync().then(() => refetch())} disabled={!isRunning} loading={cancelSetup.isPending}>
            <Square size={14} />
            Cancel
          </Btn>
        </div>
      </SectionCard>
    </div>
  )
}

export default function SetupPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeMode: Mode = searchParams.get('mode') === 'uninstall' ? 'uninstall' : 'install'

  const { data: status, refetch } = useSetupStatus()
  const startInstall = useStartInstall()
  const startUninstall = useStartUninstall()
  const cancelSetup = useCancelSetup()
  const deleteBackups = useDeleteBackups()

  const [installMode, setInstallMode] = useState<'dev' | 'prod'>('dev')
  const [distributionChoice, setDistributionChoice] = useState<DistributionChoice>('both')
  const initialInstallDir = searchParams.get('install_dir')?.trim() || readLastSuccessfulInstallDir() || DEFAULT_INSTALL_DIR
  const [installDir, setInstallDir] = useState(initialInstallDir)
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [domain, setDomain] = useState('localhost')
  const [frontendSubdomain, setFrontendSubdomain] = useState('')
  const [backendSubdomain, setBackendSubdomain] = useState('api')
  const [localFsRoot, setLocalFsRoot] = useState('/app/data/knowledge')
  const [modelChoice, setModelChoice] = useState<ModelChoice>('human')
  const [customDefaultModel, setCustomDefaultModel] = useState('')
  const [jwtSecret, setJwtSecret] = useState('')
  const [backendPort, setBackendPort] = useState('8000')
  const [frontendPort, setFrontendPort] = useState('3000')
  const [openclawInDocker, setOpenclawInDocker] = useState(true)
  const [pluginUrl, setPluginUrl] = useState('https://lab.crea8r.xyz/kw-plugin/latest')
  const [resendApi, setResendApi] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [installTouched, setInstallTouched] = useState<TouchedMap<InstallField>>({})
  const [installAttempted, setInstallAttempted] = useState(false)
  const [showInstalledPrompt, setShowInstalledPrompt] = useState(false)
  const installDirectoryInputRef = useRef<DirectoryInputElement | null>(null)
  const backupDirectoryInputRef = useRef<DirectoryInputElement | null>(null)
  const fieldRefs = useRef<FieldAnchorMap>({})
  const { data: installDetection, refetch: refetchInstallDetection } = useDetectInstall(installDir)

  const [createBackup, setCreateBackup] = useState(false)
  const [backupDir, setBackupDir] = useState('../knotwork-uninstall-backups')
  const { data: backupsData, refetch: refetchBackups } = useBackups(backupDir)
  const backups = backupsData?.backups ?? []
  const [restoreBackupPath, setRestoreBackupPath] = useState('')
  const [backupDeleteSelection, setBackupDeleteSelection] = useState<string[]>([])
  const [uninstallTouched, setUninstallTouched] = useState<TouchedMap<UninstallField>>({})
  const [uninstallAttempted, setUninstallAttempted] = useState(false)
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false)
  const [consoleExpanded, setConsoleExpanded] = useState(false)
  const [desktopStatusOpen, setDesktopStatusOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('install')
  const [headerHidden, setHeaderHidden] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [dockHeight, setDockHeight] = useState(0)
  const consoleLogRef = useRef<HTMLPreElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const bottomDockRef = useRef<HTMLDivElement | null>(null)
  const lastScrollYRef = useRef(0)
  const lastPersistedRunRef = useRef<string | null>(null)
  const lastCompletedRunRefreshRef = useRef<string | null>(null)

  const currentRun = status?.current
  const isRunning = status?.running ?? false
  const effectiveDomain = installMode === 'dev' ? 'localhost' : domain.trim()
  const effectiveBackendUrl = installMode === 'prod' && effectiveDomain !== 'localhost'
    ? buildPublicUrl(effectiveDomain, backendSubdomain)
    : `http://localhost:${backendPort}`
  const effectiveFrontendUrl = installMode === 'prod' && effectiveDomain !== 'localhost'
    ? buildPublicUrl(effectiveDomain, frontendSubdomain)
    : `http://localhost:${frontendPort}`
  const distributionChoiceMeta = describeDistributionChoice(distributionChoice, installMode)
  const resolvedStorageAdapter = 'local_fs'
  const resolvedDefaultModel = modelChoice === 'custom' ? customDefaultModel.trim() : 'human'
  const preflight = buildInstallPreflight(installMode === 'prod' && effectiveDomain !== 'localhost')

  useEffect(() => {
    const node = consoleLogRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [currentRun?.logs, consoleExpanded, activeMode])

  useEffect(() => {
    const measureHeader = () => {
      const nextHeight = headerRef.current?.offsetHeight ?? 0
      setHeaderHeight(nextHeight)
    }

    measureHeader()
    window.addEventListener('resize', measureHeader)

    if (typeof ResizeObserver !== 'undefined' && headerRef.current) {
      const observer = new ResizeObserver(() => measureHeader())
      observer.observe(headerRef.current)
      return () => {
        window.removeEventListener('resize', measureHeader)
        observer.disconnect()
      }
    }

    return () => window.removeEventListener('resize', measureHeader)
  }, [])

  useEffect(() => {
    const measureDock = () => {
      const nextHeight = bottomDockRef.current?.offsetHeight ?? 0
      setDockHeight(nextHeight)
    }

    measureDock()
    window.addEventListener('resize', measureDock)

    if (typeof ResizeObserver !== 'undefined' && bottomDockRef.current) {
      const observer = new ResizeObserver(() => measureDock())
      observer.observe(bottomDockRef.current)
      return () => {
        window.removeEventListener('resize', measureDock)
        observer.disconnect()
      }
    }

    return () => window.removeEventListener('resize', measureDock)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY
      const previousY = lastScrollYRef.current

      if (currentY <= 24) {
        setHeaderHidden(false)
      } else if (currentY > previousY + 8) {
        setHeaderHidden(true)
      } else if (currentY < previousY - 8) {
        setHeaderHidden(false)
      }

      lastScrollYRef.current = currentY
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (searchParams.get('install_dir')?.trim()) return
    if (activeMode !== 'uninstall') return
    if (installDir.trim() !== DEFAULT_INSTALL_DIR) return

    const remembered = readLastSuccessfulInstallDir()
    if (remembered) {
      setInstallDir(remembered)
    }
  }, [activeMode, installDir, searchParams])

  useEffect(() => {
    if (!currentRun) return
    if (currentRun.operation !== 'install' || currentRun.status !== 'completed' || currentRun.exit_code !== 0) return

    const signature = `${currentRun.operation}:${currentRun.started_at}:${currentRun.finished_at}:${currentRun.exit_code}`
    if (lastPersistedRunRef.current === signature) return

    const resolvedInstallDir = installDir.trim()
    if (resolvedInstallDir) {
      writeLastSuccessfulInstallDir(resolvedInstallDir)
    }
    lastPersistedRunRef.current = signature
  }, [currentRun, installDir])

  useEffect(() => {
    if (!currentRun) return
    if (currentRun.status === 'running') return

    const signature = `${currentRun.operation}:${currentRun.started_at}:${currentRun.finished_at}:${currentRun.exit_code}:${installDir.trim()}`
    if (lastCompletedRunRefreshRef.current === signature) return

    void refetchInstallDetection()
    lastCompletedRunRefreshRef.current = signature
  }, [currentRun, installDir, refetchInstallDetection])

  useEffect(() => {
    if (!restoreBackupPath) return
    if (!backupsData) return
    const selectedBackup = backups.find((backup) => backup.path === restoreBackupPath)
    if (!selectedBackup || selectedBackup.stale) {
      setRestoreBackupPath('')
    }
  }, [backups, backupsData, restoreBackupPath])

  const installErrors = useMemo(() => {
    const errors: Partial<Record<InstallField, string>> = {}

    if (!installDir.trim()) errors.installDir = 'Choose an installation directory.'
    if (!ownerName.trim()) errors.ownerName = 'Owner full name is required.'
    if (!ownerEmail.trim()) errors.ownerEmail = 'Owner email is required.'
    else if (!isValidEmail(ownerEmail)) errors.ownerEmail = 'Enter a valid email address.'

    if (installMode === 'prod') {
      if (!effectiveDomain) errors.domain = 'Domain is required.'
      else if (!isValidDomain(effectiveDomain)) errors.domain = 'Use `localhost` or a valid domain like `example.com`; no protocol, path, or leading/trailing dots.'
      if (effectiveDomain !== 'localhost') {
        if (!isValidSubdomainPart(frontendSubdomain)) errors.frontendUrl = 'Use only letters, numbers, hyphens, and dots for the frontend subdomain.'
        if (!isValidSubdomainPart(backendSubdomain)) errors.backendUrl = 'Use only letters, numbers, hyphens, and dots for the backend subdomain.'
        if (effectiveFrontendUrl && effectiveBackendUrl && effectiveFrontendUrl === effectiveBackendUrl) {
          errors.frontendUrl = 'Frontend and backend URLs must be different for this install mode.'
          errors.backendUrl = 'Frontend and backend URLs must be different for this install mode.'
        }
      }
    }

    if (!localFsRoot.trim()) {
      errors.localFsRoot = 'Container handbook path is required for local filesystem storage.'
    }

    if (!resolvedDefaultModel) errors.defaultModel = 'Choose a default model id.'
    if (modelChoice === 'custom' && !customDefaultModel.trim()) {
      errors.customDefaultModel = 'Enter the custom default model id.'
    }

    if (!backendPort) errors.backendPort = 'Backend port is required.'
    else if (!isValidPort(backendPort)) errors.backendPort = 'Use a number between 1 and 65535.'

    if (!frontendPort) errors.frontendPort = 'Frontend port is required.'
    else if (!isValidPort(frontendPort)) errors.frontendPort = 'Use a number between 1 and 65535.'

    if (backendPort && frontendPort && backendPort === frontendPort) {
      errors.backendPort = 'Backend and frontend ports must be different.'
      errors.frontendPort = 'Backend and frontend ports must be different.'
    }

    if (!pluginUrl.trim()) errors.pluginUrl = 'Plugin package URL is required.'
    else if (!isValidUrl(pluginUrl)) errors.pluginUrl = 'Enter a valid http:// or https:// URL.'

    if (installMode === 'prod' && effectiveDomain !== 'localhost') {
      if (!resendApi.trim()) errors.resendApi = 'Resend API key is required for public installs.'
      if (!emailFrom.trim()) errors.emailFrom = 'A verified from-address is required for public installs.'
      else if (!isValidEmail(emailFrom)) errors.emailFrom = 'Use a valid email address.'
    } else if (emailFrom.trim() && !isValidEmail(emailFrom)) {
      errors.emailFrom = 'Use a valid email address.'
    }

    return errors
  }, [
    backendPort,
    backendSubdomain,
    customDefaultModel,
    effectiveDomain,
    effectiveBackendUrl,
    effectiveFrontendUrl,
    emailFrom,
    frontendSubdomain,
    frontendPort,
    installDir,
    installMode,
    localFsRoot,
    modelChoice,
    ownerEmail,
    ownerName,
    pluginUrl,
    resendApi,
    resolvedDefaultModel,
    resolvedStorageAdapter,
  ])

  const uninstallErrors = useMemo(() => {
    const errors: Partial<Record<UninstallField, string>> = {}
    if (!installDir.trim()) errors.installDir = 'Choose the installation directory to uninstall.'
    if (createBackup && !backupDir.trim()) errors.backupDir = 'Backup directory is required.'
    return errors
  }, [backupDir, createBackup, installDir])

  const showInstallError = (field: InstallField) => Boolean((installAttempted || installTouched[field]) && installErrors[field])
  const showUninstallError = (field: UninstallField) => Boolean((uninstallAttempted || uninstallTouched[field]) && uninstallErrors[field])

  function registerFieldRef(field: InstallField | UninstallField, node: HTMLDivElement | null) {
    fieldRefs.current[field] = node
  }

  function scrollToField(field: InstallField | UninstallField) {
    const node = fieldRefs.current[field]
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function scrollToInstallError(field: InstallField) {
    if (ADVANCED_INSTALL_FIELDS.includes(field)) {
      setShowAdvanced(true)
      window.setTimeout(() => scrollToField(field), 180)
      return
    }
    scrollToField(field)
  }

  const installPayload: SetupInstallRequest = {
    install_mode: installMode,
    install_dir: installDir.trim(),
    owner_name: ownerName.trim(),
    owner_email: ownerEmail.trim(),
    owner_password: ownerPassword,
    domain: effectiveDomain,
    distribution_choice: distributionChoice,
    storage_adapter: resolvedStorageAdapter,
    local_fs_root: localFsRoot.trim(),
    default_model: resolvedDefaultModel,
    jwt_secret: jwtSecret.trim(),
    backend_port: Number(backendPort),
    frontend_port: Number(frontendPort),
    frontend_url: effectiveFrontendUrl,
    backend_url: effectiveBackendUrl,
    restore_backup_path: restoreBackupPath,
    openclaw_in_docker: openclawInDocker,
    plugin_url: pluginUrl.trim(),
    resend_api: resendApi.trim(),
    email_from: emailFrom.trim(),
  }

  function applyPickedFolderName(folderName: string, target: PickerTarget) {
    if (target === 'install') {
      setInstallDir((current) => replaceLastPathSegment(current, folderName))
      return
    }
    setBackupDir((current) => replaceLastPathSegment(current, folderName))
  }

  function handleDirectoryInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files || files.length === 0) return
    const firstFile = files[0] as File & { webkitRelativePath?: string }
    const relative = firstFile.webkitRelativePath ?? ''
    const folderName = relative.split('/')[0]?.trim()
    if (folderName) {
      applyPickedFolderName(folderName, pickerTarget)
    }
    event.target.value = ''
  }

  function handleDirectoryPick(target: PickerTarget) {
    setPickerTarget(target)
    const input = target === 'install' ? installDirectoryInputRef.current : backupDirectoryInputRef.current
    if (!input) return
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.click()
  }

  async function runInstall() {
    setInstallAttempted(true)
    if (Object.keys(installErrors).length > 0) {
      const order: InstallField[] = [
        'installDir',
        'ownerName',
        'ownerEmail',
        'ownerPassword',
        'domain',
        'localFsRoot',
        'defaultModel',
        'customDefaultModel',
        'jwtSecret',
        'backendPort',
        'frontendPort',
        'frontendUrl',
        'backendUrl',
        'pluginUrl',
        'resendApi',
        'emailFrom',
      ]
      const firstError = order.find((field) => installErrors[field])
      if (firstError) scrollToInstallError(firstError)
      return
    }
    if (installDetection?.installed) {
      setShowInstalledPrompt(true)
      return
    }
    await startInstall.mutateAsync(installPayload)
    await refetch()
  }

  async function runUninstall() {
    setUninstallAttempted(true)
    if (Object.keys(uninstallErrors).length > 0) {
      const firstError: UninstallField | undefined = uninstallErrors.installDir ? 'installDir' : uninstallErrors.backupDir ? 'backupDir' : undefined
      if (firstError) scrollToField(firstError)
      return
    }
    await startUninstall.mutateAsync({
      install_dir: installDir.trim(),
      skip_backup: !createBackup,
      backup_dir: backupDir.trim(),
      assume_yes: true,
    })
    await refetch()
    await refetchBackups()
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_30%),radial-gradient(circle_at_top_right,#fde68a,transparent_25%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div
        ref={headerRef}
        className={`fixed inset-x-0 top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur transition-transform duration-300 ${headerHidden ? '-translate-y-full' : 'translate-y-0'}`}
      >
        <div className="border-b border-slate-200 bg-[linear-gradient(90deg,#0f172a_0%,#1d4ed8_60%,#38bdf8_100%)] text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 md:px-6">
            <div className="min-w-0 flex items-center gap-2 md:gap-3">
              <p className="truncate text-sm font-semibold tracking-tight md:text-base">Knotwork setup</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-white/15 bg-white/10 px-3 py-1.5">
              <p className="truncate font-mono text-[11px] text-white/90">{status?.repo_root ?? 'Loading…'}</p>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-2.5 md:px-6">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between gap-3 text-slate-500">
                <div className="flex items-center gap-2">
                  <Rocket size={14} />
                  <span className="text-xs font-medium uppercase tracking-[0.18em]">Workspace</span>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSearchParams({ mode: 'install' })}
                    className={`min-w-0 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${activeMode === 'install' ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Play size={13} /> Install</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">Fresh setup</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchParams({ mode: 'uninstall' })}
                    className={`min-w-0 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${activeMode === 'uninstall' ? 'border-rose-300 bg-rose-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Trash2 size={13} /> Uninstall</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">Cleanup</p>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="mx-auto max-w-6xl overflow-x-hidden px-4 pb-52 md:px-6 md:pb-72"
        style={{ paddingTop: `${headerHeight + 24}px` }}
      >
        <Card className="min-w-0 overflow-hidden">
          <div className="grid min-w-0 gap-5 bg-white px-3 py-4 sm:px-6 sm:py-6">
            <div className="min-w-0 space-y-5">
              {activeMode === 'install' ? (
                <>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                    <div className="mb-2 flex items-center gap-2 text-slate-500">
                      <SlidersHorizontal size={14} />
                      <span className="text-xs font-medium uppercase tracking-[0.18em]">Install Mode</span>
                    </div>
                    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => {
                          setInstallMode('dev')
                          setDomain('localhost')
                          setEmailFrom('')
                          setDistributionChoice('both')
                          setFrontendSubdomain('')
                          setBackendSubdomain('api')
                        }}
                        className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${installMode === 'dev' ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Rocket size={13} /> Dev</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">localhost</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInstallMode('prod')
                          if (domain === 'localhost') setDomain('example.com')
                          if (distributionChoice === 'both') setDistributionChoice('chimera')
                          if (!backendSubdomain.trim()) setBackendSubdomain('api')
                        }}
                        className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${installMode === 'prod' ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Shield size={13} /> Prod</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">public domain</p>
                      </button>
                    </div>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Installed distribution</p>
                      <div className={`mt-2 grid gap-2 ${installMode === 'dev' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                        <button
                          type="button"
                          onClick={() => setDistributionChoice('chimera')}
                          className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${distributionChoice === 'chimera' ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        >
                          <p className="text-sm font-semibold text-slate-900">chimera</p>
                          <p className="mt-1 text-[10px] text-slate-500">Inbox, projects, channels, knowledge, and workflows.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDistributionChoice('manticore')}
                          className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${distributionChoice === 'manticore' ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        >
                          <p className="text-sm font-semibold text-slate-900">manticore</p>
                          <p className="mt-1 text-[10px] text-slate-500">Focused workspace for knowledge, workflow design, and runs.</p>
                        </button>
                        {installMode === 'dev' ? (
                          <button
                            type="button"
                            onClick={() => setDistributionChoice('both')}
                            className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors ${distributionChoice === 'both' ? 'border-sky-400 bg-sky-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                          >
                            <p className="text-sm font-semibold text-slate-900">chimera + manticore</p>
                            <p className="mt-1 text-[10px] text-slate-500">Starts both local frontends against the shared dev backend.</p>
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-3">
                        <p className="text-sm font-medium text-slate-900">{distributionChoiceMeta.label}</p>
                        <p className="mt-1 text-xs text-slate-600">{distributionChoiceMeta.description}</p>
                      </div>
                    </div>
                  </div>

                  {installDetection?.installed ? (
                    <div className="rounded-2xl border border-amber-200 bg-[linear-gradient(135deg,#fffbeb_0%,#fef3c7_100%)] p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-amber-900">Install already present</p>
                          <p className="text-sm text-amber-800">For a clean redo, switch to removal first.</p>
                          <Btn size="sm" variant="secondary" onClick={() => setSearchParams({ mode: 'uninstall' })}>
                            Go To Removal Workspace
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <FormSection
                    title="Installation directory"
                    description="Choose where this Knotwork instance should store its runtime files."
                  >
                    <div ref={(node) => registerFieldRef('installDir', node)}>
                      <TextField
                        label="Installation directory"
                        required
                        value={installDir}
                        onChange={setInstallDir}
                        onBlur={() => setInstallTouched((s) => ({ ...s, installDir: true }))}
                        error={showInstallError('installDir') ? installErrors.installDir : undefined}
                        action={
                          <>
                            <input
                              ref={installDirectoryInputRef}
                              type="file"
                              className="hidden"
                              onChange={handleDirectoryInputChange}
                            />
                            <Btn size="sm" variant="secondary" type="button" onClick={() => handleDirectoryPick('install')} className="w-full sm:w-auto">
                              <FolderOpen size={14} />
                              Choose Folder
                            </Btn>
                          </>
                        }
                      />
                    </div>
                  </FormSection>

                  <FormSection
                    title="Restore data"
                    description="Optionally restore database and handbook data from a compatible uninstall backup."
                  >
                    <div className="space-y-3">
                      <div ref={(node) => registerFieldRef('backupDir', node)}>
                        <TextField
                          label="Backup directory"
                          value={backupDir}
                          onChange={setBackupDir}
                          onBlur={() => setUninstallTouched((s) => ({ ...s, backupDir: true }))}
                          action={
                            <>
                              <input
                                ref={backupDirectoryInputRef}
                                type="file"
                                className="hidden"
                                onChange={handleDirectoryInputChange}
                              />
                              <Btn size="sm" variant="secondary" type="button" onClick={() => handleDirectoryPick('backup')} className="w-full sm:w-auto">
                                <FolderOpen size={14} />
                                Choose Folder
                              </Btn>
                            </>
                          }
                        />
                      </div>
                      {backups.length ? (
                        <div className="grid gap-2">
                          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
                            <input
                              type="radio"
                              name="restore-backup"
                              checked={!restoreBackupPath}
                              onChange={() => setRestoreBackupPath('')}
                              className="mt-1"
                            />
                            <span>
                              <span className="block font-medium text-slate-900">Fresh install</span>
                              <span className="mt-1 block text-xs text-slate-500">Do not restore data from a backup.</span>
                            </span>
                          </label>
                          {backups.map((backup) => (
                            <label
                              key={backup.path}
                              className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-sm ${
                                backup.stale ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-white'
                              }`}
                            >
                              <input
                                type="radio"
                                name="restore-backup"
                                checked={restoreBackupPath === backup.path}
                                onChange={() => setRestoreBackupPath(backup.path)}
                                disabled={backup.stale}
                                className="mt-1"
                              />
                              <span className="min-w-0">
                                <span className="block break-all font-medium text-slate-900">{backup.name}</span>
                                <span className="mt-1 block text-xs text-slate-500">Created {formatBackupDate(backup.created_at)}</span>
                                {backup.stale ? <span className="mt-1 block text-xs text-amber-700">{backup.stale_reason}</span> : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-xs text-slate-500">No backup zip files found in this directory.</p>
                        </div>
                      )}
                    </div>
                  </FormSection>

                  <FormSection
                    title="Owner account"
                    description="These details create the first administrator for the instance."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div ref={(node) => registerFieldRef('ownerName', node)}>
                        <TextField
                          label="Owner full name"
                          required
                          value={ownerName}
                          onChange={setOwnerName}
                          onBlur={() => setInstallTouched((s) => ({ ...s, ownerName: true }))}
                          error={showInstallError('ownerName') ? installErrors.ownerName : undefined}
                        />
                      </div>
                      <div ref={(node) => registerFieldRef('ownerEmail', node)}>
                        <TextField
                          label="Owner email"
                          required
                          value={ownerEmail}
                          onChange={setOwnerEmail}
                          onBlur={() => setInstallTouched((s) => ({ ...s, ownerEmail: true }))}
                          error={showInstallError('ownerEmail') ? installErrors.ownerEmail : undefined}
                        />
                      </div>
                      <div ref={(node) => registerFieldRef('ownerPassword', node)} className="md:col-span-2">
                        <TextField
                          label="Owner password"
                          value={ownerPassword}
                          onChange={setOwnerPassword}
                          onBlur={() => setInstallTouched((s) => ({ ...s, ownerPassword: true }))}
                          error={showInstallError('ownerPassword') ? installErrors.ownerPassword : undefined}
                          help="Leave blank to use the default password: `admin`."
                          type="password"
                        />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection
                    title="Host ports"
                    description="These ports are exposed on your machine for the backend API and frontend app."
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <div ref={(node) => registerFieldRef('backendPort', node)}>
                        <TextField
                          label={installMode === 'dev' ? 'Backend dev host port' : 'Backend host port'}
                          required
                          value={backendPort}
                          onChange={(value) => setBackendPort(sanitizePort(value))}
                          onBlur={() => setInstallTouched((s) => ({ ...s, backendPort: true }))}
                          error={showInstallError('backendPort') ? installErrors.backendPort : undefined}
                          inputMode="numeric"
                          maxLength={5}
                          help="Only digits are accepted. Valid port range is 1-65535."
                        />
                      </div>
                      <div ref={(node) => registerFieldRef('frontendPort', node)}>
                        <TextField
                          label={installMode === 'dev'
                            ? distributionChoice === 'manticore'
                              ? 'Knowledge and workflows host port'
                              : distributionChoice === 'both'
                              ? 'Primary dev workspace host port'
                              : 'Full workspace dev host port'
                            : 'Frontend host port'}
                          required
                          value={frontendPort}
                          onChange={(value) => setFrontendPort(sanitizePort(value))}
                          onBlur={() => setInstallTouched((s) => ({ ...s, frontendPort: true }))}
                          error={showInstallError('frontendPort') ? installErrors.frontendPort : undefined}
                          inputMode="numeric"
                          maxLength={5}
                          help="Only digits are accepted. Valid port range is 1-65535."
                        />
                      </div>
                    </div>
                    {installMode === 'dev' && distributionChoice === 'both' ? (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-medium text-slate-900">Secondary dev workspace port</p>
                        <p className="mt-1 text-xs text-slate-500">The focused knowledge-and-workflows workspace gets the next available port automatically so both local frontends can run at the same time.</p>
                      </div>
                    ) : null}
                  </FormSection>

                  {installMode === 'prod' ? (
                    <FormSection
                      title="Public access"
                      description="These settings control the public URLs and email delivery for a production-style install."
                    >
                      <div className="grid min-w-0 max-w-full gap-3 overflow-hidden md:grid-cols-2 md:gap-4">
                        {effectiveDomain !== 'localhost' ? (
                          <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-slate-50 via-white to-sky-50 shadow-[0_18px_60px_rgba(15,23,42,0.07)] md:col-span-2 md:rounded-3xl">
                            <div className="flex flex-col gap-2 border-b border-slate-200 bg-white/75 px-3 py-3 sm:flex-row sm:items-center sm:justify-between md:gap-3 md:px-4 md:py-4">
                              <div className="flex items-start gap-2 md:gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 shadow-[0_10px_30px_rgba(14,165,233,0.16)] md:h-11 md:w-11 md:rounded-2xl">
                                  <CheckCircle2 size={18} />
                                </span>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-700 md:text-sm md:tracking-[0.22em]">Public install checklist</p>
                                  <p className="mt-0.5 text-sm font-black leading-tight text-slate-950 md:mt-1 md:text-lg">Prepare DNS and network access</p>
                                </div>
                              </div>
                              <span className="w-fit rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-800 md:px-3 md:text-xs">
                                Required for real domains
                              </span>
                            </div>
                            <div className="grid gap-2 p-3 md:gap-3 md:p-4 lg:grid-cols-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-3 md:rounded-2xl md:p-4">
                                <div className="flex items-start gap-2 md:items-center">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 md:h-8 md:w-8 md:rounded-xl">
                                    <Rocket size={15} />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-black text-slate-950">DNS records</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-600 md:hidden">
                                      Point frontend and backend A records to this server IP.
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-3 hidden text-sm leading-6 text-slate-600 md:block">
                                  Create DNS A records for the frontend and backend hosts, pointing both to this server IP.
                                </p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-3 md:rounded-2xl md:p-4">
                                <div className="flex items-start gap-2 md:items-center">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 md:h-8 md:w-8 md:rounded-xl">
                                    <Shield size={15} />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-black text-slate-950">Firewall ports</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-600 md:hidden">
                                      Keep <span className="font-black text-slate-950">80</span> and <span className="font-black text-slate-950">443</span> open.
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-3 hidden text-sm leading-6 text-slate-600 md:block">
                                  Keep ports <span className="font-black text-slate-950">80</span> and <span className="font-black text-slate-950">443</span> open in your firewall or cloud security group.
                                </p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-3 md:rounded-2xl md:p-4">
                                <div className="flex items-start gap-2 md:items-center">
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 md:h-8 md:w-8 md:rounded-xl">
                                    <CheckCircle2 size={15} />
                                  </span>
                                  <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-950">Installer will handle</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-600 md:hidden">
                                      nginx/certbot checks, proxy config, and TLS request.
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-3 hidden text-sm leading-6 text-slate-600 md:block">
                                  No manual nginx/certbot setup is expected; the installer checks or installs them, configures reverse proxying, and requests TLS certificates.
                                </p>
                              </div>
                            </div>
                            <div className="border-t border-slate-200 bg-slate-950 px-3 py-2 text-xs font-semibold leading-5 text-white md:px-4 md:py-3 md:text-sm">
                              You provide DNS and open network ports; the installer handles the server-side setup.
                            </div>
                          </div>
                        ) : null}
                        <div ref={(node) => registerFieldRef('domain', node)} className="min-w-0 max-w-full">
                          <TextField
                            label="Domain"
                            required
                            value={domain}
                            onChange={setDomain}
                            onBlur={() => setInstallTouched((s) => ({ ...s, domain: true }))}
                            error={showInstallError('domain') ? installErrors.domain : undefined}
                            help="Use `localhost` for a local-only prod-style run, or a public hostname for nginx + TLS."
                          />
                        </div>
                        {effectiveDomain !== 'localhost' ? (
                          <>
                            <div ref={(node) => registerFieldRef('frontendUrl', node)} className="min-w-0 max-w-full">
                              <SubdomainField
                                label="Frontend subdomain"
                                value={frontendSubdomain}
                                onChange={setFrontendSubdomain}
                                onBlur={() => setInstallTouched((s) => ({ ...s, frontendUrl: true }))}
                                error={showInstallError('frontendUrl') ? installErrors.frontendUrl : undefined}
                                help="Leave blank to use the root domain."
                                rootDomain={effectiveDomain}
                                placeholder="app"
                                previewUrl={effectiveFrontendUrl}
                              />
                            </div>
                            <div ref={(node) => registerFieldRef('backendUrl', node)} className="min-w-0 max-w-full">
                              <SubdomainField
                                label="Backend subdomain"
                                value={backendSubdomain}
                                onChange={setBackendSubdomain}
                                onBlur={() => setInstallTouched((s) => ({ ...s, backendUrl: true }))}
                                error={showInstallError('backendUrl') ? installErrors.backendUrl : undefined}
                                help="Defaults to `api`. Leave blank to use the root domain."
                                rootDomain={effectiveDomain}
                                placeholder="api"
                                previewUrl={effectiveBackendUrl}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                            <p className="text-xs text-slate-500">On `localhost`, the installer keeps both frontend and backend on local host ports instead of public subdomains.</p>
                          </div>
                        )}
                        <div ref={(node) => registerFieldRef('pluginUrl', node)} className="min-w-0 max-w-full">
                          <TextField
                            label="OpenClaw plugin package URL"
                            required
                            value={pluginUrl}
                            onChange={setPluginUrl}
                            onBlur={() => setInstallTouched((s) => ({ ...s, pluginUrl: true }))}
                            error={showInstallError('pluginUrl') ? installErrors.pluginUrl : undefined}
                          />
                        </div>
                        <div ref={(node) => registerFieldRef('resendApi', node)} className="min-w-0 max-w-full">
                          <TextField
                            label="Resend API key"
                            required={effectiveDomain !== 'localhost'}
                            value={resendApi}
                            onChange={setResendApi}
                            onBlur={() => setInstallTouched((s) => ({ ...s, resendApi: true }))}
                            error={showInstallError('resendApi') ? installErrors.resendApi : undefined}
                            type="password"
                          />
                        </div>
                        <div ref={(node) => registerFieldRef('emailFrom', node)} className="min-w-0 max-w-full">
                          <TextField
                            label="Email from"
                            required={effectiveDomain !== 'localhost'}
                            value={emailFrom}
                            onChange={setEmailFrom}
                            onBlur={() => setInstallTouched((s) => ({ ...s, emailFrom: true }))}
                            error={showInstallError('emailFrom') ? installErrors.emailFrom : undefined}
                            help="Use an address verified by your email provider for public installs."
                          />
                        </div>
                      </div>
                    </FormSection>
                  ) : (
                    <FormSection
                      title="OpenClaw route"
                      description="Choose how OpenClaw reaches this local Knotwork backend and provide its related package settings."
                    >
                    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] p-4">
                      <div className="min-w-0 flex items-center justify-between gap-3">
                        <p className="min-w-0 text-sm font-medium text-gray-800">OpenClaw route</p>
                        <ToneChip tone="brand">{openclawInDocker ? 'Docker' : 'Host'}</ToneChip>
                      </div>
                      <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => setOpenclawInDocker(true)}
                          className={`min-w-0 rounded-lg px-3 py-2 text-sm ${openclawInDocker ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                        >
                          OpenClaw in Docker
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenclawInDocker(false)}
                          className={`min-w-0 rounded-lg px-3 py-2 text-sm ${!openclawInDocker ? 'bg-brand-600 text-white' : 'border border-gray-200 bg-white text-gray-700'}`}
                        >
                          OpenClaw on host
                        </button>
                      </div>
                      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
                        <div ref={(node) => registerFieldRef('pluginUrl', node)} className="min-w-0">
                        <TextField
                          label="OpenClaw plugin package URL"
                          required
                          value={pluginUrl}
                          onChange={setPluginUrl}
                          onBlur={() => setInstallTouched((s) => ({ ...s, pluginUrl: true }))}
                          error={showInstallError('pluginUrl') ? installErrors.pluginUrl : undefined}
                        />
                        </div>
                        <div ref={(node) => registerFieldRef('resendApi', node)} className="min-w-0">
                        <TextField
                          label="Resend API key"
                          value={resendApi}
                          onChange={setResendApi}
                          onBlur={() => setInstallTouched((s) => ({ ...s, resendApi: true }))}
                          error={showInstallError('resendApi') ? installErrors.resendApi : undefined}
                          type="password"
                          help="Optional on localhost installs."
                        />
                        </div>
                        <div ref={(node) => registerFieldRef('emailFrom', node)} className="min-w-0">
                        <TextField
                          label="Email from"
                          value={emailFrom}
                          onChange={setEmailFrom}
                          onBlur={() => setInstallTouched((s) => ({ ...s, emailFrom: true }))}
                          error={showInstallError('emailFrom') ? installErrors.emailFrom : undefined}
                          help="Leave this blank to let the installer use its localhost default sender address: `noreply@localhost`."
                        />
                        </div>
                        <div className="min-w-0 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Resolved URL</p>
                          <p className="mt-1 break-all font-mono text-sm text-gray-800">
                            {openclawInDocker ? `http://host.docker.internal:${backendPort}` : `http://localhost:${backendPort}`}
                          </p>
                        </div>
                      </div>
                    </div>
                    </FormSection>
                  )}

                  <Card className="overflow-hidden border-dashed p-0">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((open) => !open)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Advanced options</p>
                        <p className="mt-1 text-xs text-gray-500">Only open this if you know why you need it.</p>
                      </div>
                      {showAdvanced ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                    </button>
                    {showAdvanced ? (
                      <div className="border-t border-gray-200 px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div ref={(node) => registerFieldRef('localFsRoot', node)}>
                          <TextField
                            label="Local handbook path inside container"
                            required
                            value={localFsRoot}
                            onChange={setLocalFsRoot}
                            onBlur={() => setInstallTouched((s) => ({ ...s, localFsRoot: true }))}
                            error={showInstallError('localFsRoot') ? installErrors.localFsRoot : undefined}
                            help="Best default: keep `/app/data/knowledge`. Only change this if you intentionally changed where the backend container should store handbook files."
                          />
                          </div>

                          <div ref={(node) => registerFieldRef('defaultModel', node)}>
                          <SelectField
                            label="Default model id"
                            required
                            value={modelChoice}
                            onChange={(value) => setModelChoice(value as ModelChoice)}
                            onBlur={() => setInstallTouched((s) => ({ ...s, defaultModel: true }))}
                            error={showInstallError('defaultModel') ? installErrors.defaultModel : undefined}
                            help="This is the fallback execution target when a workflow does not specify a model. `human` is the safest default for a new workspace."
                            options={[
                              { value: 'human', label: 'human (recommended default)' },
                              { value: 'custom', label: 'custom model id' },
                            ]}
                          />
                          </div>
                          {modelChoice === 'custom' ? (
                            <div ref={(node) => registerFieldRef('customDefaultModel', node)}>
                            <TextField
                              label="Custom default model id"
                              required
                              value={customDefaultModel}
                              onChange={setCustomDefaultModel}
                              onBlur={() => setInstallTouched((s) => ({ ...s, customDefaultModel: true }))}
                              error={showInstallError('customDefaultModel') ? installErrors.customDefaultModel : undefined}
                            />
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                              <p className="text-sm font-medium text-gray-800">Tip</p>
                              <p className="mt-1 text-xs text-gray-500">New workspace? `human` is the safe choice.</p>
                            </div>
                          )}

                          <div ref={(node) => registerFieldRef('jwtSecret', node)}>
                          <TextField
                            label="JWT secret"
                            value={jwtSecret}
                            onChange={setJwtSecret}
                            onBlur={() => setInstallTouched((s) => ({ ...s, jwtSecret: true }))}
                            error={showInstallError('jwtSecret') ? installErrors.jwtSecret : undefined}
                            help="Leave blank to auto-generate, or click Generate to create one now."
                            action={
                              <Btn size="sm" variant="secondary" type="button" onClick={() => setJwtSecret(generateJwtSecret())}>
                                <Shield size={14} />
                                Generate
                              </Btn>
                            }
                          />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </Card>

                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <Trash2 size={18} className="mt-0.5 shrink-0 text-rose-600" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Runtime uninstall</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Removes Knotwork containers, volumes, runtime files, generated Docker resources, and public nginx/TLS artifacts when present.
                        </p>
                      </div>
                    </div>
                  </div>

                  {!installDetection?.installed ? (
                    <div className="rounded-2xl border border-blue-200 bg-[linear-gradient(135deg,#eff6ff_0%,#dbeafe_100%)] p-4">
                      <p className="text-sm font-semibold text-blue-900">No installed instance detected</p>
                      <p className="mt-2 text-sm text-blue-800">Nothing to remove yet. Jump back to install if this is a first run.</p>
                      <div className="mt-3">
                        <Btn size="sm" variant="secondary" onClick={() => setSearchParams({ mode: 'install' })}>
                          Open installation workspace
                        </Btn>
                      </div>
                    </div>
                  ) : null}

                  <FormSection
                    title="Installation directory"
                    description="Choose the Knotwork instance directory that should be removed. The wizard will not scan the whole machine."
                  >
                    <div ref={(node) => registerFieldRef('installDir', node)}>
                      <TextField
                        label="Installation directory"
                        required
                        value={installDir}
                        onChange={setInstallDir}
                        onBlur={() => setUninstallTouched((s) => ({ ...s, installDir: true }))}
                        error={showUninstallError('installDir') ? uninstallErrors.installDir : undefined}
                        action={
                          <>
                            <input
                              ref={installDirectoryInputRef}
                              type="file"
                              className="hidden"
                              onChange={handleDirectoryInputChange}
                            />
                            <Btn size="sm" variant="secondary" type="button" onClick={() => handleDirectoryPick('install')} className="w-full sm:w-auto">
                              <FolderOpen size={14} />
                              Choose Folder
                            </Btn>
                          </>
                        }
                      />
                      {installDetection?.install_markers?.length ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Detected markers</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {installDetection.install_markers.map((marker) => (
                              <ToneChip key={marker} tone="neutral">{marker}</ToneChip>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </FormSection>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <label className="flex items-start gap-3 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={createBackup}
                          onChange={(e) => setCreateBackup(e.target.checked)}
                        />
                        <span>
                          <span className="block font-medium">Create backup before uninstall</span>
                          <span className="mt-1 block text-xs text-gray-500">
                            Recommended when you may need to restore the database and handbook later.
                          </span>
                        </span>
                      </label>
                    </div>
                    {createBackup ? (
                      <div ref={(node) => registerFieldRef('backupDir', node)}>
                      <TextField
                        label="Backup directory"
                        required
                        value={backupDir}
                        onChange={setBackupDir}
                        onBlur={() => setUninstallTouched((s) => ({ ...s, backupDir: true }))}
                        error={showUninstallError('backupDir') ? uninstallErrors.backupDir : undefined}
                        action={
                          <>
                            <input
                              ref={backupDirectoryInputRef}
                              type="file"
                              className="hidden"
                              onChange={handleDirectoryInputChange}
                            />
                            <Btn size="sm" variant="secondary" type="button" onClick={() => handleDirectoryPick('backup')} className="w-full sm:w-auto">
                              <FolderOpen size={14} />
                              Choose Folder
                            </Btn>
                          </>
                        }
                      />
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3">
                        <p className="text-sm font-medium text-gray-800">Backup</p>
                        <p className="mt-1 text-xs text-gray-500">Disabled for this uninstall run.</p>
                      </div>
                    )}
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">Removal plan</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ToneChip tone="neutral">{createBackup ? 'Backup zip' : 'No backup'}</ToneChip>
                        <ToneChip tone="neutral">Docker cleanup</ToneChip>
                        <ToneChip tone="neutral">Runtime cleanup</ToneChip>
                        <ToneChip tone="neutral">Public nginx/TLS cleanup</ToneChip>
                      </div>
                    </div>
                  </div>

                  <FormSection
                    title="Existing backups"
                    description="Delete old backup zip files after you no longer need them."
                  >
                    {backups.length ? (
                      <div className="space-y-3">
                        <div className="grid gap-2">
                          {backups.map((backup) => (
                            <label key={backup.path} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={backupDeleteSelection.includes(backup.path)}
                                onChange={(event) => {
                                  setBackupDeleteSelection((current) =>
                                    event.target.checked
                                      ? Array.from(new Set([...current, backup.path]))
                                      : current.filter((path) => path !== backup.path),
                                  )
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block break-all font-medium text-slate-900">{backup.name}</span>
                                <span className="mt-1 block text-xs text-slate-500">Created {formatBackupDate(backup.created_at)}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Btn size="sm" variant="secondary" type="button" onClick={() => setBackupDeleteSelection(backups.map((backup) => backup.path))}>
                            Select all
                          </Btn>
                          <Btn
                            size="sm"
                            variant="danger"
                            type="button"
                            disabled={backupDeleteSelection.length === 0}
                            loading={deleteBackups.isPending}
                            onClick={async () => {
                              if (backupDeleteSelection.includes(restoreBackupPath)) {
                                setRestoreBackupPath('')
                              }
                              await deleteBackups.mutateAsync(backupDeleteSelection)
                              setBackupDeleteSelection([])
                              await refetchBackups()
                            }}
                          >
                            Delete selected
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-xs text-slate-500">No backup zip files found in this directory.</p>
                      </div>
                    )}
                  </FormSection>
                </>
              )}
            </div>

          </div>
        </Card>

      </div>

      <DesktopStatusRail
        open={desktopStatusOpen}
        onToggle={() => setDesktopStatusOpen((open) => !open)}
      >
        <StatusContent
          installDetection={installDetection}
          installDir={installDir}
          currentRun={currentRun}
          activeMode={activeMode}
          preflight={preflight}
          refetch={() => void refetch()}
          cancelSetup={cancelSetup}
          isRunning={isRunning}
        />
      </DesktopStatusRail>

      <div ref={bottomDockRef} className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 md:px-6">
          <div className={`mt-3 flex flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 transition-[height,max-height] duration-300 ease-in-out ${consoleExpanded ? 'h-[min(70vh,calc(100vh-11rem))] max-h-[calc(100vh-11rem)]' : 'h-[5.5rem] max-h-[5.5rem]'}`}>
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2 text-gray-100">
              {activeMode === 'install' ? (
                <Btn onClick={() => void runInstall()} disabled={isRunning} loading={startInstall.isPending} className="border-gray-700 bg-gray-900 text-white hover:bg-gray-800">
                  <Play size={14} />
                  Run install
                </Btn>
              ) : (
                <Btn variant="danger" onClick={() => void runUninstall()} disabled={isRunning} loading={startUninstall.isPending} className="border-red-900 bg-red-950 text-white hover:bg-red-900">
                  <Trash2 size={14} />
                  Run uninstall
                </Btn>
              )}
              <button
                type="button"
                onClick={() => setConsoleExpanded((open) => !open)}
                className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-100 transition-colors hover:bg-gray-900"
              >
                {consoleExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {consoleExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            <pre
              ref={consoleLogRef}
              className={`m-0 min-h-0 flex-1 overflow-auto bg-gray-950 px-4 py-2 text-xs leading-5 text-gray-100 ${consoleExpanded ? '' : 'overflow-hidden'}`}
            >
              {(currentRun?.logs ?? ['No setup task has been run yet.']).join('\n')}
            </pre>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMobileStatusOpen(true)}
        className="fixed right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg lg:hidden"
        style={{ bottom: `${dockHeight + 16}px` }}
        aria-label="Open status board"
      >
        <AlignJustify size={18} />
      </button>

      {mobileStatusOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/40 p-4 lg:hidden">
          <div className="absolute inset-0" onClick={() => setMobileStatusOpen(false)} />
          <div className="absolute inset-x-4 top-20 bottom-24 overflow-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Status board</p>
              <button type="button" onClick={() => setMobileStatusOpen(false)} className="rounded-full border border-slate-200 p-2 text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <StatusContent
                installDetection={installDetection}
                installDir={installDir}
                currentRun={currentRun}
                activeMode={activeMode}
                preflight={preflight}
                refetch={() => void refetch()}
                cancelSetup={cancelSetup}
                isRunning={isRunning}
              />
            </div>
          </div>
        </div>
      ) : null}

      {showInstalledPrompt ? (
        <ConfirmDialog
          title="Existing install detected"
          message={`Knotwork already looks installed in ${installDetection?.install_dir ?? installDir}. The safer path is to remove it first, then return to the installation workspace for a clean reinstall.`}
          warning="You can return here after uninstall completes."
          confirmLabel="Go To Removal Workspace"
          onCancel={() => setShowInstalledPrompt(false)}
          onConfirm={() => {
            setShowInstalledPrompt(false)
            setSearchParams({ mode: 'uninstall' })
          }}
        />
      ) : null}
    </div>
  )
}
