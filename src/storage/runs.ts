import type {
  WorkflowRun,
  WorkflowRunStatus,
  CreateWorkflowRunRequest,
  UpdateWorkflowRunRequest,
  GetWorkflowRunParams,
  ListWorkflowRunsParams,
  CancelWorkflowRunParams,
  PauseWorkflowRunParams,
  ResumeWorkflowRunParams,
  PaginatedResponse,
} from '@workflow/world';
import type { Env, WorkflowRunRow } from '../types.js';
import { generateRunId } from '../utils/ids.js';
import {
  storeData,
  retrieveData,
  createDataReference,
} from '../utils/r2.js';
import {
  createPaginatedResponse,
  buildCursorWhereClause,
} from '../utils/pagination.js';

export function createRunStorage(
  env: Env,
  ownerId: string,
  projectId: string,
  environment: string
) {
  const threshold = parseInt(env.LARGE_DATA_THRESHOLD || '10240', 10);

  /**
   * Convert database row to WorkflowRun
   */
  async function rowToRun(
    row: WorkflowRunRow,
    resolveData: 'none' | 'all' = 'all'
  ): Promise<WorkflowRun> {
    let input: any[] = [];
    let output: any = undefined;

    if (resolveData === 'all') {
      const inputRef = createDataReference(row.input_type, row.input_data);
      const outputRef = createDataReference(row.output_type, row.output_data);

      input = (await retrieveData<any[]>(env.WORKFLOW_STORAGE, inputRef)) || [];
      output = await retrieveData(env.WORKFLOW_STORAGE, outputRef);
    }

    const executionContext = row.execution_context
      ? (JSON.parse(row.execution_context) as Record<string, any>)
      : undefined;

    return {
      runId: row.run_id,
      deploymentId: row.deployment_id,
      workflowName: row.workflow_name,
      status: row.status as WorkflowRunStatus,
      input,
      output,
      executionContext,
      error: row.error || undefined,
      errorCode: row.error_code || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  return {
    async create(data: CreateWorkflowRunRequest): Promise<WorkflowRun> {
      const runId = generateRunId();
      const now = Date.now();

      // Store input (inline or R2)
      const inputRef = await storeData(
        env.WORKFLOW_STORAGE,
        data.input,
        'inputs',
        runId,
        'input',
        threshold
      );

      const contextJson = data.executionContext
        ? JSON.stringify(data.executionContext)
        : null;

      await env.DB.prepare(
        `INSERT INTO workflow_runs (
          run_id, deployment_id, workflow_name, status,
          input_type, input_data, execution_context,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          runId,
          data.deploymentId,
          data.workflowName,
          'pending',
          inputRef.type,
          inputRef.data,
          contextJson,
          now,
          now
        )
        .run();

      return this.get(runId);
    },

    async get(
      id: string,
      params?: GetWorkflowRunParams
    ): Promise<WorkflowRun> {
      const result = await env.DB.prepare(
        'SELECT * FROM workflow_runs WHERE run_id = ?'
      )
        .bind(id)
        .first<WorkflowRunRow>();

      if (!result) {
        throw new Error(`Workflow run not found: ${id}`);
      }

      return rowToRun(result, params?.resolveData);
    },

    async update(
      id: string,
      data: UpdateWorkflowRunRequest
    ): Promise<WorkflowRun> {
      const current = await this.get(id);
      const now = Date.now();

      const setClauses: string[] = ['updated_at = ?'];
      const queryParams: (string | number | null)[] = [now];

      if (data.status !== undefined) {
        setClauses.push('status = ?');
        queryParams.push(data.status);

        // Set timestamps based on status transitions
        if (data.status === 'running' && !current.startedAt) {
          setClauses.push('started_at = ?');
          queryParams.push(now);
        }

        if (
          ['completed', 'failed', 'cancelled'].includes(data.status) &&
          !current.completedAt
        ) {
          setClauses.push('completed_at = ?');
          queryParams.push(now);
        }
      }

      if (data.output !== undefined) {
        const outputRef = await storeData(
          env.WORKFLOW_STORAGE,
          data.output,
          'outputs',
          id,
          'output',
          threshold
        );
        setClauses.push('output_type = ?', 'output_data = ?');
        queryParams.push(outputRef.type, outputRef.data);
      }

      if (data.executionContext !== undefined) {
        setClauses.push('execution_context = ?');
        queryParams.push(JSON.stringify(data.executionContext));
      }

      if (data.error !== undefined) {
        setClauses.push('error = ?');
        queryParams.push(data.error);
      }

      if (data.errorCode !== undefined) {
        setClauses.push('error_code = ?');
        queryParams.push(data.errorCode);
      }

      queryParams.push(id);

      await env.DB.prepare(
        `UPDATE workflow_runs SET ${setClauses.join(', ')} WHERE run_id = ?`
      )
        .bind(...queryParams)
        .run();

      return this.get(id);
    },

    async list(
      params?: ListWorkflowRunsParams
    ): Promise<PaginatedResponse<WorkflowRun>> {
      const { workflowName, status, pagination, resolveData } = params || {};

      const whereClauses: string[] = ['1=1'];
      const queryParams: (string | number)[] = [];

      if (workflowName) {
        whereClauses.push('workflow_name = ?');
        queryParams.push(workflowName);
      }

      if (status) {
        whereClauses.push('status = ?');
        queryParams.push(status);
      }

      // Determine sort order
      const sortOrder = pagination?.sortOrder || 'desc';

      // Add cursor-based pagination
      const cursorClause = buildCursorWhereClause(
        pagination?.cursor,
        'created_at',
        'run_id',
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
        SELECT * FROM workflow_runs
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY created_at ${orderDirection}, run_id ${orderDirection}
        ${fetchLimit ? `LIMIT ${fetchLimit}` : ''}
      `;

      const result = await env.DB.prepare(query)
        .bind(...queryParams)
        .all<WorkflowRunRow>();

      const runs = await Promise.all(
        result.results.map((row) => rowToRun(row, resolveData))
      );

      return createPaginatedResponse(
        runs,
        pagination,
        (run) => run.createdAt.getTime()
      );
    },

    async cancel(
      id: string,
      params?: CancelWorkflowRunParams
    ): Promise<WorkflowRun> {
      await this.update(id, { status: 'cancelled' });
      return this.get(id, params);
    },

    async pause(
      id: string,
      params?: PauseWorkflowRunParams
    ): Promise<WorkflowRun> {
      await this.update(id, { status: 'paused' });
      return this.get(id, params);
    },

    async resume(
      id: string,
      params?: ResumeWorkflowRunParams
    ): Promise<WorkflowRun> {
      await this.update(id, { status: 'running' });
      return this.get(id, params);
    },
  };
}
