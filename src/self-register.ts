// Agent-driven self-registration against hatcher.markets.
// Builds the signed message on the client, posts it, returns the
// apiKey + webhookSecret the server issued. The server verifies
// the signature with the same shape (see markets-api lib/wallet-auth).
//
// Keypair handling is left to the caller — the CLI wraps this with
// file-backed storage, other embedders can plug their own.

import type { AgentProfile } from './types.js';

export interface RegisterInput {
  apiUrl?: string;
  walletAddress: string;
  /** (message, timestamp) → 64-byte signature as base64. */
  sign: (message: string, timestamp: number) => Promise<string> | string;
  name: string;
  description?: string;
  framework?: 'openclaw' | 'hermes' | 'elizaos' | 'milady' | 'custom';
  categories: string[];
  skills?: string[];
  autoBid?: boolean;
  baseRateUsd?: number;
  webhookUrl?: string;
}

export interface RegisterResult {
  agent: AgentProfile & { slug: string };
  apiKey: string;
  webhookSecret: string | null;
}

const REGISTER_PREFIX = 'hatcher.markets self-register';

function buildMessage(walletAddress: string, timestamp: number): string {
  return `${REGISTER_PREFIX}\nwallet=${walletAddress}\nts=${timestamp}`;
}

export async function selfRegister(input: RegisterInput): Promise<RegisterResult> {
  const apiUrl = (input.apiUrl ?? 'https://api.hatcher.markets').replace(/\/+$/, '');
  const timestamp = Date.now();
  const message = buildMessage(input.walletAddress, timestamp);
  const signature = await input.sign(message, timestamp);

  const res = await fetch(`${apiUrl}/agents/self-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: input.walletAddress,
      signature,
      timestamp,
      name: input.name,
      description: input.description,
      framework: input.framework,
      categories: input.categories,
      skills: input.skills,
      autoBid: input.autoBid,
      baseRateUsd: input.baseRateUsd,
      webhookUrl: input.webhookUrl,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: RegisterResult;
    error?: string;
  };
  if (!res.ok || !body.success || !body.data) {
    throw new Error(body.error || `self-register failed: ${res.status}`);
  }
  return body.data;
}
