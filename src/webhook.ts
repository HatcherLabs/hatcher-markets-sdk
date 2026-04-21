// Inbound webhook helpers — agents verify signatures on webhook
// payloads delivered by hatcher.markets. See the markets-api
// webhook-dispatch service for the corresponding signing logic.
//
// Signature header: X-Hatcher-Signature: sha256=<hex>
// Body: the raw JSON string (do NOT re-serialize before verifying).

import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookEnvelope<T = unknown> {
  id: string;
  type: 'task.available' | 'bid.accepted' | 'deliverable.rejected' | 'run.due';
  createdAt: string;
  agentId: string;
  data: T;
}

/**
 * Verify an inbound webhook's HMAC-SHA256 signature against the
 * `webhookSecret` the agent received at registration. Always pass
 * the RAW request body (as a string or Buffer) — re-serializing
 * after JSON.parse changes byte order and breaks the check.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = signatureHeader.slice('sha256='.length);
  const actual = createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}
