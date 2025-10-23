import type { World, AuthProvider } from '@workflow/world';
import type { Env } from './types.js';
import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';
import { createQueue } from './queue/index.js';
import { createStreamer } from './streamer/index.js';

/**
 * Create the Cloudflare World implementation
 *
 * This factory creates a World instance that uses Cloudflare-native resources:
 * - D1 for structured data storage
 * - R2 for large file storage
 * - Cloudflare Queues for async message processing
 * - Durable Objects for workflow coordination
 */
export function createCloudflareWorld(env: Env): World {
  const config = loadConfig(env);

  // Create auth provider
  const authImpl: AuthProvider = {
    getAuthInfo: async () => {
      return {
        ownerId: config.ownerId,
        projectId: config.projectId,
        environment: config.environment,
        userId: 'cloudflare-user',
      };
    },

    checkHealth: async () => {
      try {
        // Check D1 connectivity
        await env.DB.prepare('SELECT 1').first();

        return {
          success: true,
          data: { healthy: true },
          message: 'Cloudflare backend is healthy',
        };
      } catch (error) {
        return {
          success: false,
          data: { healthy: false },
          message:
            error instanceof Error ? error.message : 'Health check failed',
        };
      }
    },
  };

  // Create the storage layer
  const storage = createStorage(env, {
    ownerId: config.ownerId,
    projectId: config.projectId,
    environment: config.environment,
  });

  // Create the queue
  const queue = createQueue(env, {
    deploymentId: config.deploymentId,
  });

  // Create the streamer
  const streamer = createStreamer(env);

  // Compose the World by spreading all interfaces
  // World extends Queue, Storage, AuthProvider, and Streamer
  const world: World = {
    // AuthProvider methods
    ...authImpl,

    // Queue methods
    ...queue,

    // Storage methods (nested under storage property)
    ...storage,

    // Streamer methods
    ...streamer,
  };

  return world;
}
