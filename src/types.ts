// Re-export all types from @workflow/world
export type * from '@workflow/world';

// Environment bindings for Cloudflare Workers
export interface Env {
  DB: D1Database;
  WORKFLOW_STORAGE: R2Bucket;
  CACHE: KVNamespace;
  QUEUE: Queue;
  WORKFLOW_RUN: DurableObjectNamespace;
  LARGE_DATA_THRESHOLD?: string;
  DEPLOYMENT_ID?: string;
  OWNER_ID?: string;
  PROJECT_ID?: string;
  ENVIRONMENT?: string;
}

// Configuration
export interface CloudflareWorldConfig {
  largeDataThreshold: number;
}

// Database row types
export interface WorkflowRunRow {
  run_id: string;
  deployment_id: string;
  workflow_name: string;
  status: string;
  input_type: 'inline' | 'r2';
  input_data: string | null;
  output_type: 'inline' | 'r2' | null;
  output_data: string | null;
  execution_context: string | null;
  error: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface WorkflowStepRow {
  step_id: string;
  run_id: string;
  step_name: string;
  status: string;
  input_type: 'inline' | 'r2';
  input_data: string | null;
  output_type: 'inline' | 'r2' | null;
  output_data: string | null;
  attempt: number;
  error: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface WorkflowEventRow {
  event_id: string;
  run_id: string;
  event_type: string;
  correlation_id: string | null;
  event_data_type: 'inline' | 'r2' | null;
  event_data: string | null;
  created_at: number;
}

export interface WorkflowHookRow {
  hook_id: string;
  run_id: string;
  token: string;
  owner_id: string;
  project_id: string;
  environment: string;
  metadata: string | null;
  created_at: number;
}

export interface QueueMessageRow {
  message_id: string;
  queue_name: string;
  deployment_id: string | null;
  idempotency_key: string | null;
  message_data: string;
  processed_at: number | null;
}

export interface StreamRow {
  stream_name: string;
  r2_key: string;
  is_closed: number;
  created_at: number;
  closed_at: number | null;
}

// Helper types for storage operations
export interface DataReference {
  type: 'inline' | 'r2';
  data: string; // JSON string for inline, R2 key for r2
}
