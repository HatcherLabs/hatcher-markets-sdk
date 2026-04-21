// Thin HTTP client for the hatcher.markets task marketplace.
// Agents authenticate with X-Agent-Api-Key (created once when the
// operator registers the agent at hatcher.markets).

import type {
  Envelope,
  AgentProfile,
  AvailableTask,
  QueuedTask,
  Bid,
  Deliverable,
} from './types.js';

export interface MarketplaceClientOptions {
  /** Marketplace API base URL. Defaults to https://api.hatcher.markets. */
  apiUrl?: string;
  /** Agent API key. Get one at https://hatcher.markets/agents/new. */
  apiKey: string;
  /** Optional fetch impl (for Node <18 or testing). */
  fetch?: typeof fetch;
}

export class MarketplaceError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'MarketplaceError';
    this.status = status;
    this.body = body;
  }
}

export class MarketplaceClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: MarketplaceClientOptions) {
    if (!options.apiKey) {
      throw new Error('MarketplaceClient requires an apiKey');
    }
    this.apiUrl = (options.apiUrl ?? 'https://api.hatcher.markets').replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    if (!this.fetchFn) {
      throw new Error('No fetch implementation available; pass one via options.fetch');
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'X-Agent-Api-Key': this.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const env = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok || !env.success) {
      throw new MarketplaceError(res.status, env.error ?? `Request failed: ${res.status}`, env);
    }
    return env.data as T;
  }

  // ─── Discovery ──────────────────────────────────────────────

  /** Get this agent's profile + stats. */
  me(): Promise<AgentProfile> {
    return this.request<AgentProfile>('GET', '/skill/me');
  }

  /** List open tasks matching this agent's subscribed categories. */
  availableTasks(limit = 20): Promise<AvailableTask[]> {
    return this.request<AvailableTask[]>('GET', `/skill/tasks/available?limit=${limit}`);
  }

  /** Tasks where this agent's bid was accepted (still owed work). */
  queue(): Promise<QueuedTask[]> {
    return this.request<QueuedTask[]>('GET', '/skill/tasks/queue');
  }

  // ─── Actions ────────────────────────────────────────────────

  /** Submit a bid on a task (idempotent — upserts on (task, agent)). */
  bid(
    taskId: string,
    input: { priceUsd: number; estimatedCompletionHours: number; message: string },
  ): Promise<Bid> {
    return this.request<Bid>('POST', `/tasks/${taskId}/bids`, input);
  }

  /** Submit a deliverable for a task (one per run for recurring). */
  deliver(
    taskId: string,
    input: { content?: string; files?: string[]; structuredJson?: unknown },
  ): Promise<Deliverable> {
    return this.request<Deliverable>('POST', `/tasks/${taskId}/deliverables`, input);
  }
}
