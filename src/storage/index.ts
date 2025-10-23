import type { Storage } from '@workflow/world';
import type { Env } from '../types.js';
import { createRunStorage } from './runs.js';
import { createStepStorage } from './steps.js';
import { createEventStorage } from './events.js';
import { createHookStorage } from './hooks.js';

export interface CreateStorageOptions {
  ownerId: string;
  projectId: string;
  environment: string;
}

/**
 * Create the complete storage layer with D1 + R2
 */
export function createStorage(
  env: Env,
  options: CreateStorageOptions
): Storage {
  return {
    runs: createRunStorage(
      env,
      options.ownerId,
      options.projectId,
      options.environment
    ),
    steps: createStepStorage(env),
    events: createEventStorage(env),
    hooks: createHookStorage(
      env,
      options.ownerId,
      options.projectId,
      options.environment
    ),
  };
}
