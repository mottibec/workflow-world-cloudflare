import type { Env } from './types.js';
import { createCloudflareWorld } from './world.js';
import { createQueueConsumer } from './queue/index.js';
import { WorkflowRunObject } from './durable-objects/workflow-run.js';

// Re-export types
export type * from './types.js';
export { createCloudflareWorld };
export { WorkflowRunObject };

/**
 * Main Worker export
 *
 * This is the entry point for the Cloudflare Worker.
 * It handles HTTP requests and queue messages.
 */
export default {
  /**
   * HTTP fetch handler
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      const world = createCloudflareWorld(env);
      const health = await world.checkHealth();
      return Response.json(health);
    }

    // Auth info endpoint
    if (url.pathname === '/auth') {
      const world = createCloudflareWorld(env);
      const authInfo = await world.getAuthInfo();
      return Response.json(authInfo);
    }

    // Complete REST API for all World methods
    if (url.pathname.startsWith('/api/')) {
      const world = createCloudflareWorld(env);

      try {
        // Workflow Runs API
        if (url.pathname === '/api/runs') {
          if (request.method === 'POST') {
            const data = await request.json() as import('@workflow/world').CreateWorkflowRunRequest;
            const run = await world.runs.create(data);
            return Response.json(run);
          }
          if (request.method === 'GET') {
            const limit = url.searchParams.get('limit');
            const cursor = url.searchParams.get('cursor');
            const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' | null;
            const workflowName = url.searchParams.get('workflowName');
            const status = url.searchParams.get('status') as import('@workflow/world').WorkflowRunStatus | null;
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const result = await world.runs.list({
              workflowName: workflowName || undefined,
              status: status || undefined,
              pagination: {
                limit: limit ? parseInt(limit) : undefined,
                cursor: cursor || undefined,
                sortOrder: sortOrder || undefined,
              },
              resolveData: resolveData || undefined,
            });
            return Response.json(result);
          }
        }

        if (url.pathname.match(/^\/api\/runs\/([^/]+)$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'GET') {
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const run = await world.runs.get(runId, {
              resolveData: resolveData || undefined,
            });
            return Response.json(run);
          }
          if (request.method === 'PATCH') {
            const data = await request.json() as import('@workflow/world').UpdateWorkflowRunRequest;
            const run = await world.runs.update(runId, data);
            return Response.json(run);
          }
        }

        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const run = await world.runs.cancel(runId);
            return Response.json(run);
          }
        }

        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/pause$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const run = await world.runs.pause(runId);
            return Response.json(run);
          }
        }

        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const run = await world.runs.resume(runId);
            return Response.json(run);
          }
        }

        // Steps API
        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/steps$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const data = await request.json() as import('@workflow/world').CreateStepRequest;
            const step = await world.steps.create(runId, data);
            return Response.json(step);
          }
          if (request.method === 'GET') {
            const limit = url.searchParams.get('limit');
            const cursor = url.searchParams.get('cursor');
            const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' | null;
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const result = await world.steps.list({
              runId,
              pagination: {
                limit: limit ? parseInt(limit) : undefined,
                cursor: cursor || undefined,
                sortOrder: sortOrder || undefined,
              },
              resolveData: resolveData || undefined,
            });
            return Response.json(result);
          }
        }

        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/steps\/([^/]+)$/)) {
          const runId = url.pathname.split('/')[3];
          const stepId = url.pathname.split('/')[5];
          if (request.method === 'GET') {
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const step = await world.steps.get(runId, stepId, {
              resolveData: resolveData || undefined,
            });
            return Response.json(step);
          }
          if (request.method === 'PATCH') {
            const data = await request.json() as import('@workflow/world').UpdateStepRequest;
            const step = await world.steps.update(runId, stepId, data);
            return Response.json(step);
          }
        }

        // Events API
        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const body = await request.json() as { data: import('@workflow/world').CreateEventRequest, params?: import('@workflow/world').CreateEventParams };
            const event = await world.events.create(runId, body.data, body.params);
            return Response.json(event);
          }
          if (request.method === 'GET') {
            const limit = url.searchParams.get('limit');
            const cursor = url.searchParams.get('cursor');
            const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' | null;
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const result = await world.events.list({
              runId,
              pagination: {
                limit: limit ? parseInt(limit) : undefined,
                cursor: cursor || undefined,
                sortOrder: sortOrder || undefined,
              },
              resolveData: resolveData || undefined,
            });
            return Response.json(result);
          }
        }

        if (url.pathname === '/api/events/by-correlation') {
          if (request.method === 'GET') {
            const correlationId = url.searchParams.get('correlationId');
            if (!correlationId) {
              return Response.json(
                { error: 'correlationId is required' },
                { status: 400 }
              );
            }
            const limit = url.searchParams.get('limit');
            const cursor = url.searchParams.get('cursor');
            const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' | null;
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const result = await world.events.listByCorrelationId({
              correlationId,
              pagination: {
                limit: limit ? parseInt(limit) : undefined,
                cursor: cursor || undefined,
                sortOrder: sortOrder || undefined,
              },
              resolveData: resolveData || undefined,
            });
            return Response.json(result);
          }
        }

        // Hooks API
        if (url.pathname.match(/^\/api\/runs\/([^/]+)\/hooks$/)) {
          const runId = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const body = await request.json() as { data: import('@workflow/world').CreateHookRequest, params?: import('@workflow/world').GetHookParams };
            const hook = await world.hooks.create(runId, body.data, body.params);
            return Response.json(hook);
          }
          if (request.method === 'GET') {
            const limit = url.searchParams.get('limit');
            const cursor = url.searchParams.get('cursor');
            const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' | null;
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const result = await world.hooks.list({
              runId,
              pagination: {
                limit: limit ? parseInt(limit) : undefined,
                cursor: cursor || undefined,
                sortOrder: sortOrder || undefined,
              },
              resolveData: resolveData || undefined,
            });
            return Response.json(result);
          }
        }

        if (url.pathname.match(/^\/api\/hooks\/([^/]+)$/)) {
          const hookId = url.pathname.split('/')[3];
          if (request.method === 'GET') {
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const hook = await world.hooks.get(hookId, {
              resolveData: resolveData || undefined,
            });
            return Response.json(hook);
          }
          if (request.method === 'DELETE') {
            const hook = await world.hooks.dispose(hookId);
            return Response.json(hook);
          }
        }

        if (url.pathname === '/api/hooks/by-token') {
          if (request.method === 'GET') {
            const token = url.searchParams.get('token');
            if (!token) {
              return Response.json({ error: 'token is required' }, { status: 400 });
            }
            const resolveData = url.searchParams.get('resolveData') as 'none' | 'all' | null;
            const hook = await world.hooks.getByToken(token, {
              resolveData: resolveData || undefined,
            });
            return Response.json(hook);
          }
        }

        // Queue API
        if (url.pathname === '/api/queue') {
          if (request.method === 'POST') {
            const body = await request.json() as {
              queueName: import('@workflow/world').ValidQueueName;
              message: import('@workflow/world').QueuePayload;
              opts?: { deploymentId?: string; idempotencyKey?: string };
            };
            const result = await world.queue(body.queueName, body.message, body.opts);
            return Response.json(result);
          }
        }

        if (url.pathname === '/api/queue/deployment-id') {
          if (request.method === 'GET') {
            const deploymentId = await world.getDeploymentId();
            return Response.json({ deploymentId });
          }
        }

        // Streamer API
        if (url.pathname.match(/^\/api\/streams\/([^/]+)\/write$/)) {
          const streamName = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            const body = await request.json() as { chunk: string | Uint8Array | Buffer };
            await world.writeToStream(streamName, body.chunk);
            return Response.json({ success: true });
          }
        }

        if (url.pathname.match(/^\/api\/streams\/([^/]+)\/close$/)) {
          const streamName = url.pathname.split('/')[3];
          if (request.method === 'POST') {
            await world.closeStream(streamName);
            return Response.json({ success: true });
          }
        }

        if (url.pathname.match(/^\/api\/streams\/([^/]+)$/)) {
          const streamName = url.pathname.split('/')[3];
          if (request.method === 'GET') {
            const startIndex = url.searchParams.get('startIndex');
            const stream = await world.readFromStream(
              streamName,
              startIndex ? parseInt(startIndex) : undefined
            );
            return new Response(stream, {
              headers: { 'Content-Type': 'application/octet-stream' },
            });
          }
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    }

    return new Response('Workflow World - Cloudflare', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },

  /**
   * Queue consumer handler
   *
   * This is called when messages are received from Cloudflare Queues.
   * You need to provide your own handler implementation.
   */
  async queue(
    batch: MessageBatch,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Example handler - you should implement your own logic
    const handler = async (
      message: unknown,
      meta: {
        attempt: number;
        queueName: any;
        messageId: any;
      }
    ): Promise<void | { timeoutSeconds: number }> => {
      console.log('Processing message:', message, meta);
      // Your message processing logic here
    };

    const consumer = createQueueConsumer(env, handler);
    await consumer(batch);
  },
};

// Export Durable Object class
export { WorkflowRunObject as WorkflowRun };
