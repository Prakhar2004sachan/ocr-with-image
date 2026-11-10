export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'canceled'

export type PageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type PromptMode = 'layout' | 'plain' | 'custom'
export type ExportFormat = 'md' | 'txt' | 'json' | 'zip'

export interface UploadPage {
  id: string
  page_number: number
  thumb_url: string
  image_url: string | null
  width: number | null
  height: number | null
}

export interface Upload {
  id: string
  original_name: string
  mime: string
  size: number
  kind: 'pdf' | 'image'
  page_count: number
  created_at: string
  pages: UploadPage[]
}

export interface UploadError {
  filename: string
  message: string
  code: string
  hint: string | null
}

export interface UploadBatchResponse {
  uploads: Upload[]
  errors: UploadError[]
}

export interface JobOptions {
  prompt: string
  prompt_mode: PromptMode
  dpi: number
  max_tokens: number
  temperature: number
  top_p: number
  seed: number
  batch_mode: boolean
  strip_repeated_margins: boolean
  auto_retry_truncated: boolean
  page_selection: Record<string, string>
}

export interface OcrBlock {
  label: string
  box: [number, number, number, number] | null
  text: string
}

export interface JobPage {
  position: number
  upload_id: string
  upload_name: string
  page_number: number
  status: PageStatus
  image_url: string | null
  thumb_url: string
  width: number | null
  height: number | null
  output_clean: string | null
  output_raw: string | null
  blocks: OcrBlock[]
  error: string | null
  warning: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  finish_reason: string | null
}

export interface UploadSummary {
  id: string
  original_name: string
  kind: string
  page_count: number
  size: number
}

export interface Job {
  id: string
  status: JobStatus
  options: JobOptions
  total_pages: number
  completed_pages: number
  failed_pages: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  error: string | null
  warning: string | null
  engine: string | null
  model: string | null
  uploads: UploadSummary[]
  pages: JobPage[]
  queue_position: number | null
}

export interface JobList {
  items: Job[]
  total: number
  limit: number
  offset: number
}

export type EngineKind = 'llama_cpp' | 'transformers' | 'fake'
export type EnginePreference = 'auto' | EngineKind
export type Uocr2Device = 'auto' | 'mps' | 'cuda' | 'cpu'

export interface AppSettings {
  default_prompt: string
  default_prompt_mode: PromptMode
  default_dpi: number
  default_max_tokens: number
  auto_start_engine: boolean
  keep_history: boolean
  active_engine: EnginePreference
  uocr2_device: Uocr2Device
}

export interface ModelFile {
  name: string
  path: string
  exists: boolean
  size: number | null
  expected: string | null
}

export interface ModelStatus {
  ready: boolean
  model: ModelFile | null
  mmproj: ModelFile | null
  message: string
  download_command: string | null
  engine?: EngineKind | null
  directory?: string | null
  device?: string | null
  shards?: string[]
}

export interface EngineStatus {
  status: 'stopped' | 'starting' | 'ready' | 'error'
  port: number | null
  pid: number | null
  model: string | null
  backend: string
  started_at: string | null
  last_error: string | null
  log_tail: string[]
  engine_type?: EngineKind
  device?: string | null
  ready?: boolean | null
}

export interface SystemInfo {
  platform: string
  platform_label: string
  machine: string
  python: string
  cpu_count: number
  total_ram: number
  available_ram: number
  disk_total: number
  disk_free: number
  llama_server: string | null
  llama_version: string | null
  torch_version: string | null
  accelerator: string | null
  engine_label: string | null
}

export interface Health {
  status: 'ok' | 'degraded' | 'error'
  version: string
  uptime_seconds: number
  engine: EngineStatus
  model: ModelStatus
  system: SystemInfo
  active_job: string | null
  queued_jobs: number
}

export interface Diagnostics {
  health: Health
  data_dir: string
  models_dir: string
  db_path: string
  log_path: string
  engine_command: string[] | null
  engine_log_tail: string[]
  settings: AppSettings
  active_engine?: EngineKind
  engines?: EngineFacts
}

export interface EngineFacts {
  active: EngineKind
  llama_cpp: {
    ready: boolean
    binary: string | null
    version: string | null
    status: string
    label?: string
  }
  platform?: {
    label: string
    accelerator: string
    fake_engine: boolean
  }
  transformers: {
    weights: {
      ready: boolean
      dir: string
      files: string[]
      missing: string[]
      message: string
      download_command: string | null
      shards: string[]
    }
    device: string
    python: string
    torch: string | null
    mps_available?: boolean
    cuda_available?: boolean
    cuda_device?: string
    loaded?: {
      loaded: boolean
      weights_gb?: number
      device?: string
      system_available_gb?: number
    }
  }
}

export interface SettingsUpdate {
  default_prompt?: string
  default_prompt_mode?: PromptMode
  default_dpi?: number
  default_max_tokens?: number
  auto_start_engine?: boolean
  keep_history?: boolean
  active_engine?: EnginePreference
  uocr2_device?: Uocr2Device
}

export interface DeleteResponse {
  deleted: boolean
  message?: string | null
}

export interface JobEvent {
  type:
    | 'snapshot'
    | 'job_update'
    | 'page_start'
    | 'page_update'
    | 'page_delta'
    | 'job_delta'
    | 'job_done'
  job?: Job
  page?: JobPage
  position?: number
  page_number?: number
  upload_name?: string
  text?: string
}
