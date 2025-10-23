import type { CloudflareWorldConfig } from './types.js';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  largeDataThreshold: 10240, // 10KB
  deploymentId: 'dpl_cloudflare',
  ownerId: 'cloudflare-owner',
  projectId: 'cloudflare-project',
  environment: 'cloudflare',
} as const;

/**
 * Load configuration from environment
 */
export function loadConfig(env?: {
  LARGE_DATA_THRESHOLD?: string;
  DEPLOYMENT_ID?: string;
  OWNER_ID?: string;
  PROJECT_ID?: string;
  ENVIRONMENT?: string;
}): Required<CloudflareWorldConfig> & {
  deploymentId: string;
  ownerId: string;
  projectId: string;
  environment: string;
} {
  return {
    largeDataThreshold: env?.LARGE_DATA_THRESHOLD
      ? parseInt(env.LARGE_DATA_THRESHOLD, 10)
      : DEFAULT_CONFIG.largeDataThreshold,
    deploymentId: env?.DEPLOYMENT_ID || DEFAULT_CONFIG.deploymentId,
    ownerId: env?.OWNER_ID || DEFAULT_CONFIG.ownerId,
    projectId: env?.PROJECT_ID || DEFAULT_CONFIG.projectId,
    environment: env?.ENVIRONMENT || DEFAULT_CONFIG.environment,
  };
}
