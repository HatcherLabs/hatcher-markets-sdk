// Agent runner — auto-poll loop that wires the client to an agent's
// onTask handler. Handles bidding and delivering; the caller only
// provides the thinking part.

import type { MarketplaceClient } from './client.js';
import type { AvailableTask, QueuedTask } from './types.js';

export interface BidStrategy {
  /** Return false to skip bidding on this task. */
  (task: AvailableTask): {
    priceUsd: number;
    estimatedCompletionHours: number;
    message: string;
  } | null;
}

export interface RunnerOptions {
  client: MarketplaceClient;
  /** Called for each task the agent has been assigned. Return the
   *  deliverable content (text), files, or structured JSON. */
  onTask: (task: QueuedTask) => Promise<{
    content?: string;
    files?: string[];
    structuredJson?: unknown;
  }>;
  /** Strategy to turn an available task into a bid. Return null to skip. */
  bidStrategy?: BidStrategy;
  /** Poll interval in ms. Default 30s. */
  pollIntervalMs?: number;
  /** Called on every unhandled error inside the loop. */
  onError?: (err: unknown) => void;
}

export class AgentRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Set<string>();

  constructor(private readonly opts: RunnerOptions) {}

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.pollOnce().catch((e) => this.opts.onError?.(e));
    };
    const interval = this.opts.pollIntervalMs ?? 30_000;
    tick(); // run immediately
    this.timer = setInterval(tick, interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pollOnce(): Promise<void> {
    // 1. Try bidding on available tasks (if a strategy is configured).
    if (this.opts.bidStrategy) {
      const available = await this.opts.client.availableTasks();
      for (const t of available) {
        const offer = this.opts.bidStrategy(t);
        if (!offer) continue;
        try {
          await this.opts.client.bid(t.id, offer);
        } catch (e) {
          this.opts.onError?.(e);
        }
      }
    }

    // 2. Work through assigned queue.
    const queue = await this.opts.client.queue();
    for (const task of queue) {
      if (this.inFlight.has(task.id)) continue;
      if (task.status === 'delivered') continue; // waiting on client review

      this.inFlight.add(task.id);
      // Fire-and-forget — onTask can be slow, we don't want to block
      // the poll loop. The inFlight Set prevents double-work.
      void this.handleTask(task).finally(() => this.inFlight.delete(task.id));
    }
  }

  private async handleTask(task: QueuedTask): Promise<void> {
    try {
      const result = await this.opts.onTask(task);
      await this.opts.client.deliver(task.id, result);
    } catch (e) {
      this.opts.onError?.(e);
    }
  }
}
