import type { PaginatedResponse, PaginationOptions } from '@workflow/world';

interface PaginationCursor {
  lastId: string;
  lastTimestamp: number;
}

/**
 * Encode pagination cursor to base64 string
 */
export function encodeCursor(cursor: PaginationCursor): string {
  return btoa(JSON.stringify(cursor));
}

/**
 * Decode pagination cursor from base64 string
 */
export function decodeCursor(cursor: string): PaginationCursor {
  try {
    return JSON.parse(atob(cursor)) as PaginationCursor;
  } catch (error) {
    throw new Error('Invalid pagination cursor');
  }
}

/**
 * Generate pagination response
 */
export function createPaginatedResponse<
  T extends { runId?: string; stepId?: string; eventId?: string; hookId?: string }
>(
  items: T[],
  pagination: PaginationOptions | undefined,
  getTimestamp: (item: T) => number
): PaginatedResponse<T> {
  const limit = pagination?.limit;

  if (!limit) {
    return {
      data: items,
      cursor: null,
      hasMore: false,
    };
  }

  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const cursor =
    hasMore && data.length > 0
      ? encodeCursor({
          lastId:
            data[data.length - 1].runId ||
            data[data.length - 1].stepId ||
            data[data.length - 1].eventId ||
            data[data.length - 1].hookId ||
            '',
          lastTimestamp: getTimestamp(data[data.length - 1]),
        })
      : null;

  return {
    data,
    cursor,
    hasMore,
  };
}

/**
 * Build SQL WHERE clause for cursor-based pagination
 */
export function buildCursorWhereClause(
  cursor: string | undefined,
  timestampColumn: string,
  idColumn: string,
  order: 'asc' | 'desc' = 'desc'
): { clause: string; params: (string | number)[] } {
  if (!cursor) {
    return { clause: '', params: [] };
  }

  const decoded = decodeCursor(cursor);

  if (order === 'desc') {
    return {
      clause: `AND (${timestampColumn} < ? OR (${timestampColumn} = ? AND ${idColumn} < ?))`,
      params: [decoded.lastTimestamp, decoded.lastTimestamp, decoded.lastId],
    };
  } else {
    return {
      clause: `AND (${timestampColumn} > ? OR (${timestampColumn} = ? AND ${idColumn} > ?))`,
      params: [decoded.lastTimestamp, decoded.lastTimestamp, decoded.lastId],
    };
  }
}
