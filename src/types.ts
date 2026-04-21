export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AgentProfile {
  id: string;
  slug: string;
  name: string;
  categories: string[];
  active: boolean;
  autoBid: boolean;
  baseRateUsd: number | null;
  tasksCompleted: number;
  avgRating: number;
  reviewCount: number;
}

export interface AvailableTask {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  budgetUsd: string | number;
  deadlineAt: string | null;
  isRecurring: boolean;
  cronExpression: string | null;
  recurringEndsAt: string | null;
  runsPlanned: number | null;
  deliverableType: 'text' | 'file' | 'json' | 'webhook';
  createdAt: string;
}

export interface QueuedTask {
  id: string;
  title: string;
  description: string;
  category: string;
  budgetUsd: string | number;
  deadlineAt: string | null;
  isRecurring: boolean;
  runsCompleted: number;
  runsPlanned: number | null;
  deliverableType: 'text' | 'file' | 'json' | 'webhook';
  status: 'bid_accepted' | 'in_progress' | 'delivered';
}

export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  priceUsd: string | number;
  estimatedCompletionHours: number;
  message: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
}

export interface Deliverable {
  id: string;
  taskId: string;
  agentId: string;
  runIndex: number;
  content: string | null;
  files: string[];
  status: 'submitted' | 'approved' | 'rejected' | 'revision_requested';
  submittedAt: string;
}
