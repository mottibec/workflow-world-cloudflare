import type {
  Hook,
  CreateHookRequest,
  GetHookParams,
  ListHooksParams,
  PaginatedResponse,
} from '@workflow/world';
import type { Env, WorkflowHookRow } from '../types.js';
import {
  storeData,
  retrieveData,
  createDataReference,
} from '../utils/r2.js';
import {
  createPaginatedResponse,
  buildCursorWhereClause,
} from '../utils/pagination.js';

export function createHookStorage(
  env: Env,
  ownerId: string,
  projectId: string,
  environment: string
) {
  const threshold = parseInt(env.LARGE_DATA_THRESHOLD || '10240', 10);

  /**
   * Convert database row to Hook
   */
  async function rowToHook(
    row: WorkflowHookRow,
    resolveData: 'none' | 'all' = 'all'
  ): Promise<Hook> {
    let metadata: unknown = undefined;

    if (row.metadata && resolveData === 'all') {
      // For hooks, metadata is always stored inline as JSON
      metadata = JSON.parse(row.metadata);
    }

    return {
      hookId: row.hook_id,
      runId: row.run_id,
      token: row.token,
      ownerId: row.owner_id,
      projectId: row.project_id,
      environment: row.environment,
      metadata,
      createdAt: new Date(row.created_at),
    };
  }

  return {
    async create(
      runId: string,
      data: CreateHookRequest,
      params?: GetHookParams
    ): Promise<Hook> {
      const now = Date.now();

      // Metadata is stored inline for hooks (small data)
      const metadataJson = data.metadata
        ? JSON.stringify(data.metadata)
        : null;

      await env.DB.prepare(
        `INSERT INTO workflow_hooks (
          hook_id, run_id, token, owner_id, project_id,
          environment, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          data.hookId,
          runId,
          data.token,
          ownerId,
          projectId,
          environment,
          metadataJson,
          now
        )
        .run();

      return this.get(data.hookId, params);
    },

    async get(hookId: string, params?: GetHookParams): Promise<Hook> {
      const result = await env.DB.prepare(
        'SELECT * FROM workflow_hooks WHERE hook_id = ?'
      )
        .bind(hookId)
        .first<WorkflowHookRow>();

      if (!result) {
        throw new Error(`Hook not found: ${hookId}`);
      }

      return rowToHook(result, params?.resolveData);
    },

    async getByToken(
      token: string,
      params?: GetHookParams
    ): Promise<Hook> {
      const result = await env.DB.prepare(
        'SELECT * FROM workflow_hooks WHERE token = ?'
      )
        .bind(token)
        .first<WorkflowHookRow>();

      if (!result) {
        throw new Error(`Hook not found for token: ${token}`);
      }

      return rowToHook(result, params?.resolveData);
    },

    async list(
      params: ListHooksParams
    ): Promise<PaginatedResponse<Hook>> {
      const { runId, pagination, resolveData } = params;

      const whereClauses: string[] = [];
      const queryParams: (string | number)[] = [];

      if (runId) {
        whereClauses.push('run_id = ?');
        queryParams.push(runId);
      }

      // Determine sort order
      const sortOrder = pagination?.sortOrder || 'desc';

      // Add cursor-based pagination
      const cursorClause = buildCursorWhereClause(
        pagination?.cursor,
        'created_at',
        'hook_id',
        sortOrder
      );
      if (cursorClause.clause) {
        whereClauses.push(cursorClause.clause);
        queryParams.push(...cursorClause.params);
      }

      // Fetch one extra to determine if there are more results
      const fetchLimit = pagination?.limit ? pagination.limit + 1 : undefined;

      const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';
      const whereClause =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const query = `
        SELECT * FROM workflow_hooks
        ${whereClause}
        ORDER BY created_at ${orderDirection}, hook_id ${orderDirection}
        ${fetchLimit ? `LIMIT ${fetchLimit}` : ''}
      `;

      const result = await env.DB.prepare(query)
        .bind(...queryParams)
        .all<WorkflowHookRow>();

      const hooks = await Promise.all(
        result.results.map((row) => rowToHook(row, resolveData))
      );

      return createPaginatedResponse(
        hooks,
        pagination,
        (hook) => hook.createdAt.getTime()
      );
    },

    async dispose(
      hookId: string,
      params?: GetHookParams
    ): Promise<Hook> {
      const hook = await this.get(hookId, params);

      await env.DB.prepare('DELETE FROM workflow_hooks WHERE hook_id = ?')
        .bind(hookId)
        .run();

      return hook;
    },
  };
}
