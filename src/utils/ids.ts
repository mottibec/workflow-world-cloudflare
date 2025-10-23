/**
 * Generate unique IDs with prefixes
 */

/**
 * Generate a random ID
 */
function generateRandomId(): string {
  // Generate a random string
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(16);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < 16; i++) {
    result += chars[randomValues[i] % chars.length];
  }

  return result;
}

/**
 * ID prefixes matching @workflow/world conventions
 */
export const ID_PREFIXES = {
  RUN: 'wrun_',
  STEP: 'wstp_',
  EVENT: 'evnt_',
  HOOK: 'hook_',
  MESSAGE: 'msg_',
  STREAM: 'strm_',
} as const;

/**
 * Generate a unique ID with the specified prefix
 */
export function generateId(prefix: string): string {
  return `${prefix}${generateRandomId()}`;
}

/**
 * Generate a workflow run ID
 */
export function generateRunId(): string {
  return generateId(ID_PREFIXES.RUN);
}

/**
 * Generate a step ID
 */
export function generateStepId(): string {
  return generateId(ID_PREFIXES.STEP);
}

/**
 * Generate an event ID
 */
export function generateEventId(): string {
  return generateId(ID_PREFIXES.EVENT);
}

/**
 * Generate a hook ID
 */
export function generateHookId(): string {
  return generateId(ID_PREFIXES.HOOK);
}

/**
 * Generate a message ID
 */
export function generateMessageId(): string {
  return generateId(ID_PREFIXES.MESSAGE);
}

/**
 * Generate a stream ID
 */
export function generateStreamId(): string {
  return generateId(ID_PREFIXES.STREAM);
}

/**
 * Generate a secure token for hooks
 */
export function generateHookToken(): string {
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
