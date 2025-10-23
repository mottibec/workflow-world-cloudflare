import type { Streamer } from '@workflow/world';
import type { Env, StreamRow } from '../types.js';

/**
 * Create the streamer implementation using R2
 *
 * Streams are stored as objects in R2 with progressive writes.
 */
export function createStreamer(env: Env): Streamer {
  /**
   * Generate R2 key for a stream
   */
  function getStreamKey(name: string): string {
    return `streams/${name}`;
  }

  /**
   * Get or create stream metadata
   */
  async function getOrCreateStreamMetadata(name: string): Promise<StreamRow> {
    const existing = await env.DB.prepare(
      'SELECT * FROM streams WHERE stream_name = ?'
    )
      .bind(name)
      .first<StreamRow>();

    if (existing) {
      return existing;
    }

    // Create new stream metadata
    const now = Date.now();
    const r2Key = getStreamKey(name);

    await env.DB.prepare(
      'INSERT INTO streams (stream_name, r2_key, is_closed, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(name, r2Key, 0, now)
      .run();

    return {
      stream_name: name,
      r2_key: r2Key,
      is_closed: 0,
      created_at: now,
      closed_at: null,
    };
  }

  return {
    async writeToStream(name, chunk) {
      const metadata = await getOrCreateStreamMetadata(name);

      if (metadata.is_closed) {
        throw new Error(`Stream ${name} is closed and cannot be written to`);
      }

      // Convert chunk to Uint8Array
      let data: Uint8Array;
      if (typeof chunk === 'string') {
        data = new TextEncoder().encode(chunk);
      } else if (chunk instanceof Buffer) {
        data = new Uint8Array(chunk);
      } else {
        data = chunk;
      }

      // For simplicity, we'll append to the existing object
      // In a production implementation, you might want to use multipart uploads
      // or store chunks separately and concatenate on read
      const existing = await env.WORKFLOW_STORAGE.get(metadata.r2_key);
      const existingData = existing ? await existing.arrayBuffer() : new ArrayBuffer(0);

      // Concatenate existing data with new chunk
      const combined = new Uint8Array(existingData.byteLength + data.byteLength);
      combined.set(new Uint8Array(existingData), 0);
      combined.set(data, existingData.byteLength);

      // Write back to R2
      await env.WORKFLOW_STORAGE.put(metadata.r2_key, combined);
    },

    async closeStream(name) {
      const metadata = await getOrCreateStreamMetadata(name);

      if (metadata.is_closed) {
        return; // Already closed
      }

      const now = Date.now();
      await env.DB.prepare(
        'UPDATE streams SET is_closed = 1, closed_at = ? WHERE stream_name = ?'
      )
        .bind(now, name)
        .run();
    },

    async readFromStream(name, startIndex = 0) {
      const metadata = await getOrCreateStreamMetadata(name);

      const object = await env.WORKFLOW_STORAGE.get(metadata.r2_key);
      if (!object) {
        // Stream exists in metadata but not in R2, return empty stream
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      }

      // Get the body as a ReadableStream
      const body = object.body;
      if (!body) {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      }

      // If startIndex is provided, we need to skip bytes
      if (startIndex > 0) {
        let bytesRead = 0;
        const reader = body.getReader();

        return new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  controller.close();
                  break;
                }

                if (bytesRead + value.byteLength <= startIndex) {
                  // Skip this chunk entirely
                  bytesRead += value.byteLength;
                  continue;
                }

                if (bytesRead < startIndex) {
                  // Partially skip this chunk
                  const offset = startIndex - bytesRead;
                  controller.enqueue(value.slice(offset));
                  bytesRead += value.byteLength;
                } else {
                  // Include the entire chunk
                  controller.enqueue(value);
                  bytesRead += value.byteLength;
                }
              }
            } catch (error) {
              controller.error(error);
            }
          },
          cancel() {
            reader.cancel();
          },
        });
      }

      // Return the stream as-is
      return body;
    },
  };
}
