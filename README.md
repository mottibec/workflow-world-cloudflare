# Workflow World - Cloudflare

A Cloudflare-native implementation of the [Vercel Workflow](https://useworkflow.dev/) Development Kit, providing durable, resumable async functions using Cloudflare's edge infrastructure.

> **Note**: This is the initial project setup with core infrastructure components.

## Features

- **Durable Workflows**: Execute long-running workflows that survive across process restarts
- **Cloudflare Native**: Built entirely on Cloudflare's serverless platform
- **Global Edge Network**: Deploy workflows to 300+ cities worldwide
- **Automatic Scaling**: Handles any workload without configuration
- **Strong Consistency**: Durable Objects ensure workflow state consistency
- **Large File Support**: Automatic handling of large inputs/outputs via R2

## Architecture

This implementation uses Cloudflare's native resources:

- **D1 Database**: Stores workflow metadata (runs, steps, events, hooks)
- **R2 Object Storage**: Stores large payloads (>10KB) and streaming data
- **Cloudflare Queues**: Handles async step and workflow execution
- **Durable Objects**: Coordinates workflow state with strong consistency
- **Workers KV**: Caches frequently accessed data
- **Cloudflare Workers**: Serverless execution environment

## Installation

```bash
npm install workflow-world-cloudflare
```

## Setup

### 1. Create Required Resources

```bash
# Create D1 database
wrangler d1 create workflow-db

# Create R2 bucket
wrangler r2 bucket create workflow-storage

# Create KV namespace
wrangler kv:namespace create CACHE

# Create Queues
wrangler queues create workflow-queue
wrangler queues create workflow-dlq
```

### 2. Update wrangler.toml

Fill in the IDs from the previous commands:

```toml
[[d1_databases]]
binding = "DB"
database_name = "workflow-db"
database_id = "your-database-id"  # From step 1

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-id"  # From step 1
```

### 3. Run Migrations

```bash
# For local development
npm run db:migrate:local

# For production
npm run db:migrate
```

## Usage

### Basic Example

```typescript
import { createCloudflareWorld } from 'workflow-world-cloudflare';
import type { Env } from 'workflow-world-cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Create the world instance
    const world = createCloudflareWorld(env);

    // Create a workflow run
    const run = await world.storage.runs.create(
      'my-workflow',
      { userId: '123', action: 'process' },
      { source: 'api' }
    );

    // Queue a step for execution
    await world.queue.queue('__wkf_step_process', {
      runId: run.id,
      stepName: 'process-data',
    });

    return Response.json({ runId: run.id });
  },
};
```

### Creating and Managing Workflow Runs

```typescript
const world = createCloudflareWorld(env);

// Create a new workflow run
const run = await world.storage.runs.create(
  'email-sequence',
  { email: 'user@example.com' },
  { campaign: 'onboarding' }
);

// Get a workflow run
const retrieved = await world.storage.runs.get(run.id);

// Update workflow status
await world.storage.runs.update(run.id, {
  status: 'running',
});

// List workflow runs
const { data, cursor, hasMore } = await world.storage.runs.list({
  workflowName: 'email-sequence',
  status: 'running',
  limit: 10,
});

// Cancel a workflow
await world.storage.runs.cancel(run.id);

// Pause/Resume workflow
await world.storage.runs.pause(run.id);
await world.storage.runs.resume(run.id);
```

### Working with Steps

```typescript
// Create a step
const step = await world.storage.steps.create(
  run.id,
  'send-email',
  { to: 'user@example.com', template: 'welcome' }
);

// Update step status and output
await world.storage.steps.update(run.id, step.id, {
  status: 'completed',
  output: { messageId: 'msg_123' },
});

// List steps for a run
const { data: steps } = await world.storage.steps.list(run.id);
```

### Recording Events

```typescript
// Create an event
await world.storage.events.create(
  run.id,
  'workflow_started',
  { timestamp: Date.now() },
  'correlation-id-123' // Optional correlation ID
);

// List events for a run
const { data: events } = await world.storage.events.list(run.id, {
  dataResolution: 'all', // 'all' or 'none'
});

// List events by correlation ID (across all runs)
const { data: correlatedEvents } =
  await world.storage.events.listByCorrelationId('correlation-id-123');
```

### Using Hooks

```typescript
// Create a hook
const hook = await world.storage.hooks.create(run.id, {
  responseUrl: 'https://example.com/callback',
});

// Get hook by token
const retrieved = await world.storage.hooks.getByToken(hook.token);

// Dispose hook when done
await world.storage.hooks.dispose(hook.id);
```

### Queue Operations

```typescript
// Queue a message
const messageId = await world.queue.queue(
  '__wkf_step_process',
  { runId: run.id, data: 'some-data' },
  {
    deploymentId: world.queue.getDeploymentId(),
    idempotencyKey: 'unique-key-123', // Optional
  }
);
```

### Streaming Large Data

```typescript
// Write to a stream
await world.streamer.writeToStream('logs-123', 'Log line 1\n');
await world.streamer.writeToStream('logs-123', 'Log line 2\n');
await world.streamer.closeStream('logs-123');

// Read from a stream
const stream = await world.streamer.readFromStream('logs-123', 0);
const reader = stream.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

### Using Durable Objects for Coordination

```typescript
// Get a Durable Object instance for a workflow run
const id = env.WORKFLOW_RUN.idFromName(run.id);
const stub = env.WORKFLOW_RUN.get(id);

// Initialize the workflow
await stub.fetch('https://do/initialize', {
  method: 'POST',
  body: JSON.stringify({ runId: run.id }),
});

// Update workflow status
await stub.fetch('https://do/status', {
  method: 'POST',
  body: JSON.stringify({ status: 'running' }),
});

// Start a step
await stub.fetch('https://do/step/start', {
  method: 'POST',
  body: JSON.stringify({ stepId: step.id }),
});

// Complete a step
await stub.fetch('https://do/step/complete', {
  method: 'POST',
  body: JSON.stringify({ stepId: step.id }),
});

// Get current state
const stateResponse = await stub.fetch('https://do/state');
const state = await stateResponse.json();
```

## Configuration

Environment variables (optional):

```bash
LARGE_DATA_THRESHOLD=10240  # Threshold for storing data in R2 (bytes)
DEPLOYMENT_ID=dpl_cloudflare
OWNER_ID=cloudflare-owner
PROJECT_ID=cloudflare-project
ENVIRONMENT=production
```

## Development

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Type check
npm run typecheck

# Run tests
npm run test

# Build
npm run build

# Deploy to Cloudflare
npm run deploy
```

## API Reference

See the [Workflow Development Kit documentation](https://useworkflow.dev/) for the complete API reference. This implementation follows the `@workflow/world` interface specification.

### Core Types

- `World`: Main interface combining all subsystems
- `Storage`: Data persistence layer (runs, steps, events, hooks)
- `Queue`: Async message processing
- `Streamer`: Large file streaming
- `WorkflowRun`: Workflow execution metadata
- `Step`: Individual step within a workflow
- `Event`: Workflow lifecycle event
- `Hook`: Webhook callback

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │ Main Worker  │      │Queue Consumer│                     │
│  │  (HTTP API)  │      │   Workers    │                     │
│  └──────┬───────┘      └──────┬───────┘                     │
│         │                     │                              │
│  ┌──────▼──────────────────────▼──────┐                     │
│  │    Durable Objects                 │                     │
│  │  (WorkflowRunObject)               │                     │
│  └────────┬───────────────────────────┘                     │
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            │
    ┌───────┴────────┬─────────────┬──────────────┐
    │                │             │              │
┌───▼────┐     ┌────▼────┐   ┌────▼────┐    ┌───▼────┐
│   D1   │     │   R2    │   │ Queues  │    │   KV   │
│Database│     │ Storage │   │         │    │ Cache  │
└────────┘     └─────────┘   └─────────┘    └────────┘
```

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

MIT

## Related Projects

- [Vercel Workflow](https://github.com/vercel/workflow) - Official Workflow Development Kit
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
