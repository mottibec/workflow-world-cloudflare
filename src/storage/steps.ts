import type {
  Step,
  StepStatus,
  CreateStepRequest,
  UpdateStepRequest,
  GetStepParams,
  ListWorkflowRunStepsParams,
  PaginatedResponse,
} from '@workflow/world';
import type { Env, WorkflowStepRow } from '../types.js';
import {
  storeData,
  retrieveData,
  createDataReference,
} from '../utils/r2.js';
import {
  createPaginatedResponse,
  buildCursorWhereClause,
} from '../utils/pagination.js';

export function createStepStorage(env: Env) {
  const threshold = parseInt(env.LARGE_DATA_THRESHOLD || '10240', 10);

  /**
   * Convert database row to Step
   */
  async function rowToStep(
    row: WorkflowStepRow,
    resolveData: 'none' | 'all' = 'all'
  ): Promise<Step> {
    let input: any[] = [];
    let output: any = undefined;

    if (resolveData === 'all') {
      const inputRef = createDataReference(row.input_type, row.input_data);
      const outputRef = createDataReference(row.output_type, row.output_data);

      input = (await retrieveData<any[]>(env.WORKFLOW_STORAGE, inputRef)) || [];
      output = await retrieveData(env.WORKFLOW_STORAGE, outputRef);
    }

    return {
      stepId: row.step_id,
      runId: row.run_id,
      stepName: row.step_name,
      status: row.status as StepStatus,
      input,
      output,
      attempt: row.attempt,
      error: row.error || undefined,
      errorCode: row.error_code || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  return {
    async create(runId: string, data: CreateStepRequest): Promise<Step> {
      const now = Date.now();

      // Store input (inline or R2)
      const inputRef = await storeData(
        env.WORKFLOW_STORAGE,
        data.input,
        'step-inputs',
        data.stepId,
        'input',
        threshold
      );

      await env.DB.prepare(
        `INSERT INTO workflow_steps (
          step_id, run_id, step_name, status,
          input_type, input_data, attempt,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          data.stepId,
          runId,
          data.stepName,
          'pending',
          inputRef.type,
          inputRef.data,
          1,
          now,
          now
        )
        .run();

      return this.get(runId, data.stepId);
    },

    async get(
      runId: string | undefined,
      stepId: string,
      params?: GetStepParams
    ): Promise<Step> {
      const result = await env.DB.prepare(
        'SELECT * FROM workflow_steps WHERE step_id = ?'
      )
        .bind(stepId)
        .first<WorkflowStepRow>();

      if (!result) {
        throw new Error(`Step not found: ${stepId}`);
      }

      // Validate runId if provided
      if (runId && result.run_id !== runId) {
        throw new Error(
          `Step ${stepId} does not belong to run ${runId}`
        );
      }

      return rowToStep(result, params?.resolveData);
    },

    async update(
      runId: string,
      stepId: string,
      data: UpdateStepRequest
    ): Promise<Step> {
      const current = await this.get(runId, stepId);
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
          ['completed', 'failed'].includes(data.status) &&
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
          'step-outputs',
          stepId,
          'output',
          threshold
        );
        setClauses.push('output_type = ?', 'output_data = ?');
        queryParams.push(outputRef.type, outputRef.data);
      }

      if (data.attempt !== undefined) {
        setClauses.push('attempt = ?');
        queryParams.push(data.attempt);
      }

      if (data.error !== undefined) {
        setClauses.push('error = ?');
        queryParams.push(data.error);
      }

      if (data.errorCode !== undefined) {
        setClauses.push('error_code = ?');
        queryParams.push(data.errorCode);
      }

      queryParams.push(stepId);

      await env.DB.prepare(
        `UPDATE workflow_steps SET ${setClauses.join(', ')}
         WHERE step_id = ?`
      )
        .bind(...queryParams)
        .run();

      return this.get(runId, stepId);
    },

    async list(
      params: ListWorkflowRunStepsParams
    ): Promise<PaginatedResponse<Step>> {
      const { runId, pagination, resolveData } = params;

      const whereClauses: string[] = ['run_id = ?'];
      const queryParams: (string | number)[] = [runId];

      // Determine sort order
      const sortOrder = pagination?.sortOrder || 'desc';

      // Add cursor-based pagination
      const cursorClause = buildCursorWhereClause(
        pagination?.cursor,
        'created_at',
        'step_id',
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
        SELECT * FROM workflow_steps
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY created_at ${orderDirection}, step_id ${orderDirection}
        ${fetchLimit ? `LIMIT ${fetchLimit}` : ''}
      `;

      const result = await env.DB.prepare(query)
        .bind(...queryParams)
        .all<WorkflowStepRow>();

      const steps = await Promise.all(
        result.results.map((row) => rowToStep(row, resolveData))
      );

      return createPaginatedResponse(
        steps,
        pagination,
        (step) => step.createdAt.getTime()
      );
    },
  };
}
