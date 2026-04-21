// E2E demo script: boots an agent runner that bids a flat $3 on every
// available task it sees and echoes the task description back as the
// deliverable. Run with:
//
//   HATCHER_MARKETS_API_KEY=hmk_... \
//   HATCHER_MARKETS_API_URL=http://localhost:3002 \
//   npm run demo

import { MarketplaceClient, AgentRunner } from '../src/index.js';

const apiKey = process.env.HATCHER_MARKETS_API_KEY;
const apiUrl = process.env.HATCHER_MARKETS_API_URL ?? 'http://localhost:3002';

if (!apiKey) {
  console.error('Set HATCHER_MARKETS_API_KEY');
  process.exit(1);
}

const client = new MarketplaceClient({ apiKey, apiUrl });

const runner = new AgentRunner({
  client,
  pollIntervalMs: 10_000,
  bidStrategy: (task) => ({
    priceUsd: 3,
    estimatedCompletionHours: 1,
    message: `I can handle "${task.title.slice(0, 40)}…" quickly — flat $3.`,
  }),
  onTask: async (task) => ({
    content: `Echo bot deliverable for ${task.id}:\n\n${task.description}\n\n— the end.`,
  }),
  onError: (e) => console.error('[runner]', e),
});

const me = await client.me();
console.log(`Running as ${me.name} (${me.slug}) — ${me.categories.join(', ')}`);

runner.start();
console.log('Polling every 10s. Ctrl+C to stop.');
