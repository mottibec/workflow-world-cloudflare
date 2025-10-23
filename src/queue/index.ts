import type {
  Queue,
  ValidQueueName,
  QueuePayload,
  MessageId,
  QueuePrefix,
} from '@workflow/world';
import type { Env } from '../types.js';
import { generateMessageId } from '../utils/ids.js';

export interface CreateQueueOptions {
  deploymentId: string;
}

/**
 * Create the queue implementation using Cloudflare Queues
 */
export function createQueue(env: Env, options: CreateQueueOptions): Queue {
  const { deploymentId } = options;

  return {
    async getDeploymentId(): Promise<string> {
      return deploymentId;
    },

    async queue(
      queueName: ValidQueueName,
      message: QueuePayload,
      opts?: {
        deploymentId?: string;
        idempotencyKey?: string;
      }
    ): Promise<{ messageId: MessageId }> {
      const messageId = generateMessageId() as MessageId;

      // Store message metadata in D1 for idempotency tracking
      if (opts?.idempotencyKey) {
        const existing = await env.DB.prepare(
          'SELECT message_id FROM queue_messages WHERE idempotency_key = ? AND queue_name = ?'
        )
          .bind(opts.idempotencyKey, queueName)
          .first<{ message_id: string }>();

        if (existing) {
          // Message already queued, return existing ID
          return { messageId: existing.message_id as MessageId };
        }
      }

      // Store in D1 for tracking
      await env.DB.prepare(
        `INSERT INTO queue_messages (
          message_id, queue_name, deployment_id, idempotency_key, message_data
        ) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(
          messageId,
          queueName,
          opts?.deploymentId || null,
          opts?.idempotencyKey || null,
          JSON.stringify(message)
        )
        .run();

      // Send to Cloudflare Queue
      await env.QUEUE.send({
        messageId,
        queueName,
        message,
        metadata: {
          deploymentId: opts?.deploymentId,
          idempotencyKey: opts?.idempotencyKey,
        },
      });

      return { messageId };
    },

    createQueueHandler(
      queueNamePrefix: QueuePrefix,
      handler: (
        message: unknown,
        meta: {
          attempt: number;
          queueName: ValidQueueName;
          messageId: MessageId;
        }
      ) => Promise<void | { timeoutSeconds: number }>
    ): (req: Request) => Promise<Response> {
      return async (req: Request): Promise<Response> => {
        try {
          const body = await req.json<{
            messageId: string;
            queueName: string;
            message: unknown;
            metadata?: {
              attempt?: number;
            };
          }>();

          // Validate queue name prefix
          if (!body.queueName.startsWith(queueNamePrefix)) {
            return new Response('Invalid queue name prefix', { status: 400 });
          }

          const result = await handler(body.message, {
            attempt: body.metadata?.attempt || 1,
            queueName: body.queueName as ValidQueueName,
            messageId: body.messageId as MessageId,
          });

          if (result && 'timeoutSeconds' in result) {
            // Handler requested a timeout/retry
            return new Response('Timeout requested', {
              status: 503,
              headers: {
                'Retry-After': result.timeoutSeconds.toString(),
              },
            });
          }

          // Mark as processed in D1
          await env.DB.prepare(
            'UPDATE queue_messages SET processed_at = ? WHERE message_id = ?'
          )
            .bind(Date.now(), body.messageId)
            .run();

          return new Response('OK', { status: 200 });
        } catch (error) {
          console.error('Queue handler error:', error);
          return new Response(
            error instanceof Error ? error.message : 'Unknown error',
            { status: 500 }
          );
        }
      };
    },
  };
}

/**
 * Create a queue message consumer for Cloudflare Queue consumers
 * This is used in the queue() export handler
 */
export function createQueueConsumer(
  env: Env,
  handler: (
    message: unknown,
    meta: {
      attempt: number;
      queueName: ValidQueueName;
      messageId: MessageId;
    }
  ) => Promise<void | { timeoutSeconds: number }>
): (batch: MessageBatch) => Promise<void> {
  return async (batch: MessageBatch): Promise<void> => {
    for (const msg of batch.messages) {
      const body = msg.body as {
        messageId: string;
        queueName: string;
        message: unknown;
      };

      try {
        const result = await handler(body.message, {
          attempt: msg.attempts,
          queueName: body.queueName as ValidQueueName,
          messageId: body.messageId as MessageId,
        });

        if (result && 'timeoutSeconds' in result) {
          // Retry the message
          msg.retry();
          continue;
        }

        // Mark as processed in D1
        await env.DB.prepare(
          'UPDATE queue_messages SET processed_at = ? WHERE message_id = ?'
        )
          .bind(Date.now(), body.messageId)
          .run();

        // Acknowledge the message
        msg.ack();
      } catch (error) {
        console.error('Queue message processing error:', error);
        // Let Cloudflare Queues handle retry logic
        msg.retry();
      }
    }
  };
}
