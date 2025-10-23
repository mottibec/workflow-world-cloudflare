import type { DurableObject } from '@cloudflare/workers-types';
import type { Env } from '../types.js';
import type { WorkflowRunStatus, StepStatus } from '@workflow/world';

/**
 * Workflow state stored in Durable Object
 */
interface WorkflowState {
  runId: string;
  status: WorkflowRunStatus;
  activeSteps: Set<string>;
  completedSteps: Set<string>;
  failedSteps: Set<string>;
  metadata: Record<string, unknown>;
}

/**
 * Durable Object for coordinating workflow execution
 *
 * Each workflow run gets its own instance that maintains state
 * and coordinates step execution with strong consistency
 */
export class WorkflowRunObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private workflowState: WorkflowState | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Initialize or load workflow state
   */
  async initialize(runId: string): Promise<void> {
    // Try to load existing state
    const loadedState = await this.state.storage.get<WorkflowState>('state');
    this.workflowState = loadedState || null;

    if (!this.workflowState) {
      // Initialize new state
      this.workflowState = {
        runId,
        status: 'pending',
        activeSteps: new Set(),
        completedSteps: new Set(),
        failedSteps: new Set(),
        metadata: {},
      };
      await this.persistState();
    }
  }

  /**
   * Persist state to durable storage
   */
  private async persistState(): Promise<void> {
    if (!this.workflowState) return;

    // Convert Sets to Arrays for serialization
    const serializable = {
      ...this.workflowState,
      activeSteps: Array.from(this.workflowState.activeSteps),
      completedSteps: Array.from(this.workflowState.completedSteps),
      failedSteps: Array.from(this.workflowState.failedSteps),
    };

    await this.state.storage.put('state', serializable);
  }

  /**
   * Update workflow status
   */
  async updateWorkflowStatus(status: WorkflowRunStatus): Promise<void> {
    if (!this.workflowState) {
      throw new Error('Workflow state not initialized');
    }

    this.workflowState.status = status;
    await this.persistState();
  }

  /**
   * Register a step as active
   */
  async startStep(stepId: string): Promise<void> {
    if (!this.workflowState) {
      throw new Error('Workflow state not initialized');
    }

    this.workflowState.activeSteps.add(stepId);
    await this.persistState();
  }

  /**
   * Mark a step as completed
   */
  async completeStep(stepId: string): Promise<void> {
    if (!this.workflowState) {
      throw new Error('Workflow state not initialized');
    }

    this.workflowState.activeSteps.delete(stepId);
    this.workflowState.completedSteps.add(stepId);
    await this.persistState();
  }

  /**
   * Mark a step as failed
   */
  async failStep(stepId: string): Promise<void> {
    if (!this.workflowState) {
      throw new Error('Workflow state not initialized');
    }

    this.workflowState.activeSteps.delete(stepId);
    this.workflowState.failedSteps.add(stepId);
    await this.persistState();
  }

  /**
   * Get current workflow state
   */
  async getState(): Promise<WorkflowState | null> {
    return this.workflowState;
  }

  /**
   * Check if workflow can accept new steps
   */
  async canAcceptSteps(): Promise<boolean> {
    if (!this.workflowState) {
      return false;
    }

    return (
      this.workflowState.status === 'running' ||
      this.workflowState.status === 'pending'
    );
  }

  /**
   * Set metadata for the workflow
   */
  async setMetadata(key: string, value: unknown): Promise<void> {
    if (!this.workflowState) {
      throw new Error('Workflow state not initialized');
    }

    this.workflowState.metadata[key] = value;
    await this.persistState();
  }

  /**
   * Get metadata from the workflow
   */
  async getMetadata(key: string): Promise<unknown> {
    if (!this.workflowState) {
      return undefined;
    }

    return this.workflowState.metadata[key];
  }

  /**
   * HTTP handler for fetch requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/initialize') {
        const { runId } = await request.json<{ runId: string }>();
        await this.initialize(runId);
        return Response.json({ success: true });
      }

      if (path === '/status') {
        const { status } = await request.json<{ status: WorkflowRunStatus }>();
        await this.updateWorkflowStatus(status);
        return Response.json({ success: true });
      }

      if (path === '/step/start') {
        const { stepId } = await request.json<{ stepId: string }>();
        await this.startStep(stepId);
        return Response.json({ success: true });
      }

      if (path === '/step/complete') {
        const { stepId } = await request.json<{ stepId: string }>();
        await this.completeStep(stepId);
        return Response.json({ success: true });
      }

      if (path === '/step/fail') {
        const { stepId } = await request.json<{ stepId: string }>();
        await this.failStep(stepId);
        return Response.json({ success: true });
      }

      if (path === '/state') {
        const state = await this.getState();
        return Response.json(state);
      }

      if (path === '/can-accept-steps') {
        const canAccept = await this.canAcceptSteps();
        return Response.json({ canAccept });
      }

      if (path === '/metadata') {
        if (request.method === 'POST') {
          const { key, value } = await request.json<{
            key: string;
            value: unknown;
          }>();
          await this.setMetadata(key, value);
          return Response.json({ success: true });
        } else if (request.method === 'GET') {
          const key = url.searchParams.get('key');
          if (!key) {
            return Response.json({ error: 'Missing key parameter' }, { status: 400 });
          }
          const value = await this.getMetadata(key);
          return Response.json({ value });
        }
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }
}
