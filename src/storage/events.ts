import type {
  Event,
  CreateEventRequest,
  CreateEventParams,
  ListEventsParams,
  ListEventsByCorrelationIdParams,
  PaginatedResponse,
} from '@workflow/world';
import type { Env, WorkflowEventRow } from '../types.js';
import {
  storeData,
  retrieveData,
  createDataReference,
} from '../utils/r2.js';
import {
  createPaginatedResponse,
  buildCursorWhereClause,
} from '../utils/pagination.js';
import { generateEventId } from '../utils/ids.js';

export function createEventStorage(env: Env) {
  const threshold = parseInt(env.LARGE_DATA_THRESHOLD || '10240', 10);

  /**
   * Convert database row to Event
   */
  async function rowToEvent(
    row: WorkflowEventRow,
    resolveData: 'none' | 'all' = 'all'
  ): Promise<Event> {
    // Parse the base event data
    const baseEvent: any = {
      eventType: row.event_type,
      correlationId: row.correlation_id || undefined,
    };

    // Add eventData if present and resolveData is 'all'
    if (row.event_data_type && row.event_data && resolveData === 'all') {
      const dataRef = createDataReference(
        row.event_data_type,
        row.event_data
      );
      const eventData = await retrieveData(env.WORKFLOW_STORAGE, dataRef);
      if (eventData) {
        baseEvent.eventData = eventData;
      }
    }

    return {
      ...baseEvent,
      runId: row.run_id,
      eventId: row.event_id,
      createdAt: new Date(row.created_at),
    };
  }

  return {
    async create(
      runId: string,
      data: CreateEventRequest,
      params?: CreateEventParams
    ): Promise<Event> {
      const eventId = generateEventId();
      const now = Date.now();

      let dataType: 'inline' | 'r2' | null = null;
      let dataValue: string | null = null;

      // Store eventData if present
      if ('eventData' in data && data.eventData !== undefined) {
        const dataRef = await storeData(
          env.WORKFLOW_STORAGE,
          data.eventData,
          'event-data',
          eventId,
          'data',
          threshold
        );
        dataType = dataRef.type;
        dataValue = dataRef.data;
      }

      await env.DB.prepare(
        `INSERT INTO workflow_events (
          event_id, run_id, event_type, correlation_id,
          event_data_type, event_data, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          eventId,
          runId,
          data.eventType,
          data.correlationId || null,
          dataType,
          dataValue,
          now
        )
        .run();

      const result = await env.DB.prepare(
        'SELECT * FROM workflow_events WHERE event_id = ?'
      )
        .bind(eventId)
        .first<WorkflowEventRow>();

      if (!result) {
        throw new Error(`Failed to create event`);
      }

      return rowToEvent(result, params?.resolveData);
    },

    async list(
      params: ListEventsParams
    ): Promise<PaginatedResponse<Event>> {
      const { runId, pagination, resolveData } = params;

      const whereClauses: string[] = ['run_id = ?'];
      const queryParams: (string | number)[] = [runId];

      // Determine sort order (events default to ASC, unlike runs/steps)
      const sortOrder = pagination?.sortOrder || 'asc';

      // Add cursor-based pagination
      const cursorClause = buildCursorWhereClause(
        pagination?.cursor,
        'created_at',
        'event_id',
        sortOrder
      );
      if (cursorClause.clause) {
        whereClauses.push(cursorClause.clause);
        queryParams.push(...cursorClause.params);
      }

      // Fetch one extra to determine if there are more results
      const fetchLimit = pagination?.limit ? pagination.limit + 1 : undefined;

      const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
      const query = `
        SELECT * FROM workflow_events
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY created_at ${orderDirection}, event_id ${orderDirection}
        ${fetchLimit ? `LIMIT ${fetchLimit}` : ''}
      `;

      const result = await env.DB.prepare(query)
        .bind(...queryParams)
        .all<WorkflowEventRow>();

      const events = await Promise.all(
        result.results.map((row) => rowToEvent(row, resolveData))
      );

      return createPaginatedResponse(
        events,
        pagination,
        (event) => event.createdAt.getTime()
      );
    },

    async listByCorrelationId(
      params: ListEventsByCorrelationIdParams
    ): Promise<PaginatedResponse<Event>> {
      const { correlationId, pagination, resolveData } = params;

      const whereClauses: string[] = ['correlation_id = ?'];
      const queryParams: (string | number)[] = [correlationId];

      // Determine sort order
      const sortOrder = pagination?.sortOrder || 'asc';

      // Add cursor-based pagination
      const cursorClause = buildCursorWhereClause(
        pagination?.cursor,
        'created_at',
        'event_id',
        sortOrder
      );
      if (cursorClause.clause) {
        whereClauses.push(cursorClause.clause);
        queryParams.push(...cursorClause.params);
      }

      // Fetch one extra to determine if there are more results
      const fetchLimit = pagination?.limit ? pagination.limit + 1 : undefined;

      const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
      const query = `
        SELECT * FROM workflow_events
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY created_at ${orderDirection}, event_id ${orderDirection}
        ${fetchLimit ? `LIMIT ${fetchLimit}` : ''}
      `;

      const result = await env.DB.prepare(query)
        .bind(...queryParams)
        .all<WorkflowEventRow>();

      const events = await Promise.all(
        result.results.map((row) => rowToEvent(row, resolveData))
      );

      return createPaginatedResponse(
        events,
        pagination,
        (event) => event.createdAt.getTime()
      );
    },
  };
}
