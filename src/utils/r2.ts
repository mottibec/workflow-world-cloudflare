import type { DataReference } from '../types.js';

/**
 * Generate a unique R2 key for storing large data
 */
export function generateR2Key(prefix: string, id: string, field: string): string {
  return `${prefix}/${id}/${field}`;
}

/**
 * Store data in R2 if it exceeds the threshold, otherwise return inline reference
 */
export async function storeData(
  bucket: R2Bucket,
  data: unknown,
  keyPrefix: string,
  id: string,
  field: string,
  threshold: number
): Promise<DataReference> {
  const jsonData = JSON.stringify(data);

  if (jsonData.length <= threshold) {
    return {
      type: 'inline',
      data: jsonData,
    };
  }

  const key = generateR2Key(keyPrefix, id, field);
  await bucket.put(key, jsonData, {
    httpMetadata: {
      contentType: 'application/json',
    },
  });

  return {
    type: 'r2',
    data: key,
  };
}

/**
 * Retrieve data from either inline storage or R2
 */
export async function retrieveData<T>(
  bucket: R2Bucket,
  reference: DataReference | null
): Promise<T | null> {
  if (!reference) {
    return null;
  }

  if (reference.type === 'inline') {
    return JSON.parse(reference.data) as T;
  }

  // type === 'r2'
  const object = await bucket.get(reference.data);
  if (!object) {
    throw new Error(`R2 object not found: ${reference.data}`);
  }

  const text = await object.text();
  return JSON.parse(text) as T;
}

/**
 * Delete data from R2 (no-op for inline)
 */
export async function deleteData(
  bucket: R2Bucket,
  reference: DataReference | null
): Promise<void> {
  if (!reference || reference.type === 'inline') {
    return;
  }

  await bucket.delete(reference.data);
}

/**
 * Convert row data reference to DataReference object
 */
export function createDataReference(
  type: 'inline' | 'r2' | null,
  data: string | null
): DataReference | null {
  if (!type || !data) {
    return null;
  }

  return { type, data };
}
