import type {
  World,
  AuthInfo,
  HealthCheckResponse,
  WorkflowRun,
  CreateWorkflowRunRequest,
  GetWorkflowRunParams,
  UpdateWorkflowRunRequest,
  ListWorkflowRunsParams,
  PaginationOptions,
  PaginatedResponse,
  Step,
  CreateStepRequest,
  UpdateStepRequest,
  GetStepParams,
  ListWorkflowRunStepsParams,
  Event,
  CreateEventRequest,
  CreateEventParams,
  ListEventsParams,
  ListEventsByCorrelationIdParams,
  Hook,
  CreateHookRequest,
  GetHookParams,
  ListHooksParams,
  ValidQueueName,
  QueuePayload,
  MessageId,
} from '@workflow/world';

/**
 * Configuration for remote world client
 */
export interface RemoteWorldConfig {
  /**
   * Base URL of the Cloudflare Worker (e.g., 'https://your-worker.workers.dev')
   */
  apiUrl: string;

  /**
   * API key for authentication (optional)
   */
  apiKey?: string;

  /**
   * Custom fetch implementation (optional, defaults to globalThis.fetch)
   */
  fetch?: typeof fetch;
}

/**
 * Creates a remote World client that communicates with a Cloudflare Worker via HTTP
 *
 * This allows you to use the Cloudflare World implementation from any Node.js or Next.js
 * application without needing to run code on Cloudflare Workers.
 *
 * @example
 * ```typescript
 * import { createRemoteWorld } from 'workflow-world-cloudflare/remote';
 * import { setWorld } from 'workflow/runtime';
 *
 * const world = createRemoteWorld({
 *   apiUrl: 'https://your-worker.workers.dev',
 *   apiKey: process.env.CLOUDFLARE_WORKFLOW_KEY,
 * });
 *
 * setWorld(world);
 *
 * // Now use workflows normally
 * import { start } from 'workflow/api';
 * const run = await start(myWorkflow, [args]);
 * ```
 */
export function createRemoteWorld(config: RemoteWorldConfig): World {
  const fetchFn = config.fetch || globalThis.fetch;

  const apiFetch = async (
    path: string,
    opts?: RequestInit
  ): Promise<Response> => {
    const url = `${config.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((opts?.headers as Record<string, string>) || {}),
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetchFn(url, {
      ...opts,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error: string };
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  };

  // Helper to build query string
  const buildQuery = (params: Record<string, string | number | undefined>): string => {
    const entries = Object.entries(params).filter(([_, v]) => v !== undefined);
    if (entries.length === 0) return '';
    const query = new URLSearchParams(
      entries.map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();
    return `?${query}`;
  };

  const world: World = {
    // AuthProvider
    async getAuthInfo(): Promise<AuthInfo> {
      const response = await apiFetch('/auth');
      return response.json();
    },

    async checkHealth(): Promise<HealthCheckResponse> {
      const response = await apiFetch('/health');
      return response.json();
    },

    // Queue
    async getDeploymentId(): Promise<string> {
      const response = await apiFetch('/api/queue/deployment-id');
      const result = await response.json() as { deploymentId: string };
      return result.deploymentId;
    },

    async queue(
      queueName: ValidQueueName,
      message: QueuePayload,
      opts?: { deploymentId?: string; idempotencyKey?: string }
    ): Promise<{ messageId: MessageId }> {
      const response = await apiFetch('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ queueName, message, opts }),
      });
      return response.json();
    },

    createQueueHandler() {
      throw new Error('createQueueHandler is not supported in remote world');
    },

    // Storage - Runs
    runs: {
      async create(data: CreateWorkflowRunRequest): Promise<WorkflowRun> {
        const response = await apiFetch('/api/runs', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return response.json();
      },

      async get(id: string, params?: GetWorkflowRunParams): Promise<WorkflowRun> {
        const query = buildQuery({
          resolveData: params?.resolveData,
        });
        const response = await apiFetch(`/api/runs/${id}${query}`);
        return response.json();
      },

      async update(id: string, data: UpdateWorkflowRunRequest): Promise<WorkflowRun> {
        const response = await apiFetch(`/api/runs/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        return response.json();
      },

      async list(params?: ListWorkflowRunsParams): Promise<PaginatedResponse<WorkflowRun>> {
        const query = buildQuery({
          workflowName: params?.workflowName,
          status: params?.status,
          limit: params?.pagination?.limit,
          cursor: params?.pagination?.cursor,
          sortOrder: params?.pagination?.sortOrder,
          resolveData: params?.resolveData,
        });
        const response = await apiFetch(`/api/runs${query}`);
        return response.json();
      },

      async cancel(id: string): Promise<WorkflowRun> {
        const response = await apiFetch(`/api/runs/${id}/cancel`, {
          method: 'POST',
        });
        return response.json();
      },

      async pause(id: string): Promise<WorkflowRun> {
        const response = await apiFetch(`/api/runs/${id}/pause`, {
          method: 'POST',
        });
        return response.json();
      },

      async resume(id: string): Promise<WorkflowRun> {
        const response = await apiFetch(`/api/runs/${id}/resume`, {
          method: 'POST',
        });
        return response.json();
      },
    },

    // Storage - Steps
    steps: {
      async create(runId: string, data: CreateStepRequest): Promise<Step> {
        const response = await apiFetch(`/api/runs/${runId}/steps`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return response.json();
      },

      async get(runId: string, stepId: string, params?: GetStepParams): Promise<Step> {
        const query = buildQuery({
          resolveData: params?.resolveData,
        });
        const response = await apiFetch(`/api/runs/${runId}/steps/${stepId}${query}`);
        return response.json();
      },

      async update(
        runId: string,
        stepId: string,
        data: UpdateStepRequest
      ): Promise<Step> {
        const response = await apiFetch(`/api/runs/${runId}/steps/${stepId}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        return response.json();
      },

      async list(
        params: ListWorkflowRunStepsParams
      ): Promise<PaginatedResponse<Step>> {
        const query = buildQuery({
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          sortOrder: params.pagination?.sortOrder,
          resolveData: params.resolveData,
        });
        const response = await apiFetch(`/api/runs/${params.runId}/steps${query}`);
        return response.json();
      },
    },

    // Storage - Events
    events: {
      async create(
        runId: string,
        data: CreateEventRequest,
        params?: CreateEventParams
      ): Promise<Event> {
        const response = await apiFetch(`/api/runs/${runId}/events`, {
          method: 'POST',
          body: JSON.stringify({ data, params }),
        });
        return response.json();
      },

      async list(params: ListEventsParams): Promise<PaginatedResponse<Event>> {
        const query = buildQuery({
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          sortOrder: params.pagination?.sortOrder,
          resolveData: params.resolveData,
        });
        const response = await apiFetch(`/api/runs/${params.runId}/events${query}`);
        return response.json();
      },

      async listByCorrelationId(
        params: ListEventsByCorrelationIdParams
      ): Promise<PaginatedResponse<Event>> {
        const query = buildQuery({
          correlationId: params.correlationId,
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          sortOrder: params.pagination?.sortOrder,
          resolveData: params.resolveData,
        });
        const response = await apiFetch(`/api/events/by-correlation${query}`);
        return response.json();
      },
    },

    // Storage - Hooks
    hooks: {
      async create(
        runId: string,
        data: CreateHookRequest,
        params?: GetHookParams
      ): Promise<Hook> {
        const response = await apiFetch(`/api/runs/${runId}/hooks`, {
          method: 'POST',
          body: JSON.stringify({ data, params }),
        });
        return response.json();
      },

      async get(hookId: string, params?: GetHookParams): Promise<Hook> {
        const query = buildQuery({
          resolveData: params?.resolveData,
        });
        const response = await apiFetch(`/api/hooks/${hookId}${query}`);
        return response.json();
      },

      async getByToken(token: string, params?: GetHookParams): Promise<Hook> {
        const query = buildQuery({
          token,
          resolveData: params?.resolveData,
        });
        const response = await apiFetch(`/api/hooks/by-token${query}`);
        return response.json();
      },

      async list(
        params: ListHooksParams
      ): Promise<PaginatedResponse<Hook>> {
        const query = buildQuery({
          limit: params.pagination?.limit,
          cursor: params.pagination?.cursor,
          sortOrder: params.pagination?.sortOrder,
          resolveData: params.resolveData,
        });
        const runId = params.runId;
        const path = runId ? `/api/runs/${runId}/hooks` : '/api/hooks';
        const response = await apiFetch(`${path}${query}`);
        return response.json();
      },

      async dispose(hookId: string, params?: GetHookParams): Promise<Hook> {
        const response = await apiFetch(`/api/hooks/${hookId}`, {
          method: 'DELETE',
        });
        return response.json();
      },
    },

    // Streamer
    async writeToStream(name: string, chunk: string | Uint8Array | Buffer): Promise<void> {
      await apiFetch(`/api/streams/${name}/write`, {
        method: 'POST',
        body: JSON.stringify({ chunk }),
      });
    },

    async closeStream(name: string): Promise<void> {
      await apiFetch(`/api/streams/${name}/close`, {
        method: 'POST',
      });
    },

    async readFromStream(
      name: string,
      startIndex?: number
    ): Promise<ReadableStream<Uint8Array>> {
      const query = buildQuery({ startIndex });
      const response = await apiFetch(`/api/streams/${name}${query}`);
      if (!response.body) {
        throw new Error('No stream body in response');
      }
      return response.body as ReadableStream<Uint8Array>;
    },
  };

  return world;
}
