-- Workflow Runs Table
CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'paused')),

  -- Input/Output (stored inline if small, reference to R2 if large)
  input_type TEXT NOT NULL CHECK (input_type IN ('inline', 'r2')),
  input_data TEXT, -- JSON for inline, R2 key for r2
  output_type TEXT CHECK (output_type IN ('inline', 'r2')),
  output_data TEXT,

  -- Execution context
  execution_context TEXT, -- JSON

  -- Error handling
  error TEXT,
  error_code TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL, -- Unix timestamp in milliseconds
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,

  -- Indexes for common queries
  INDEX idx_workflow_name (workflow_name),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at DESC)
);

-- Workflow Steps Table
CREATE TABLE IF NOT EXISTS workflow_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

  -- Input/Output
  input_type TEXT NOT NULL CHECK (input_type IN ('inline', 'r2')),
  input_data TEXT,
  output_type TEXT CHECK (output_type IN ('inline', 'r2')),
  output_data TEXT,

  -- Retry tracking
  attempt INTEGER NOT NULL DEFAULT 1,

  -- Error handling
  error TEXT,
  error_code TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,

  INDEX idx_run_id (run_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at DESC)
);

-- Workflow Events Table
CREATE TABLE IF NOT EXISTS workflow_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  correlation_id TEXT,

  -- Event data
  event_data_type TEXT CHECK (event_data_type IN ('inline', 'r2')),
  event_data TEXT,

  created_at INTEGER NOT NULL,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,

  INDEX idx_run_id (run_id),
  INDEX idx_event_type (event_type),
  INDEX idx_correlation_id (correlation_id),
  INDEX idx_created_at (created_at ASC)
);

-- Workflow Hooks Table
CREATE TABLE IF NOT EXISTS workflow_hooks (
  hook_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL,

  -- Metadata
  metadata TEXT, -- JSON

  created_at INTEGER NOT NULL,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE,

  INDEX idx_run_id (run_id),
  INDEX idx_token (token)
);

-- Queue Messages Table (for tracking processed messages and idempotency)
CREATE TABLE IF NOT EXISTS queue_messages (
  message_id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  deployment_id TEXT,
  idempotency_key TEXT,
  message_data TEXT NOT NULL, -- JSON
  processed_at INTEGER,

  INDEX idx_queue_name (queue_name),
  INDEX idx_idempotency (idempotency_key)
);

-- Streams metadata table (for R2 stream tracking)
CREATE TABLE IF NOT EXISTS streams (
  stream_name TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0, -- Boolean: 0 = open, 1 = closed
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
