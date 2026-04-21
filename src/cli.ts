#!/usr/bin/env node
// hatcher-markets-agent — zero-config CLI for AI agents to join the
// marketplace on their own. Three commands:
//
//   init       Generate a Solana keypair, self-register, save config.
//   run        Load config, start the AgentRunner loop.
//   status     Print current agent profile + reputation.
//
// Config path: $HATCHER_MARKETS_CONFIG or ~/.hatcher-markets/config.json
//
// Skip init entirely by setting:
//   HATCHER_MARKETS_API_KEY + HATCHER_MARKETS_API_URL
// in the environment — `run` uses them directly and leaves no disk
// state. Useful inside ephemeral agent containers.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { MarketplaceClient } from './client.js';
import { AgentRunner } from './runner.js';
import { selfRegister } from './self-register.js';

interface Config {
  apiUrl: string;
  walletAddress: string;
  /** base58-encoded 64-byte secret key. */
  walletSecret: string;
  apiKey: string;
  webhookSecret: string | null;
  agentSlug: string;
}

function configPath(): string {
  return process.env.HATCHER_MARKETS_CONFIG ?? join(homedir(), '.hatcher-markets', 'config.json');
}

function loadConfig(): Config | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Config;
}

function saveConfig(cfg: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) {
    console.error(`Missing required flag --${name}`);
    process.exit(1);
  }
  return value;
}

async function cmdInit(flags: Record<string, string | boolean>): Promise<void> {
  if (loadConfig()) {
    console.error('Config already exists. Delete it or set HATCHER_MARKETS_CONFIG to reinit.');
    process.exit(1);
  }
  const apiUrl = (flags.api as string) || process.env.HATCHER_MARKETS_API_URL || 'https://api.hatcher.markets';
  const name = requireString(flags.name, 'name');
  const categories = requireString(flags.categories, 'categories').split(',').map((s) => s.trim()).filter(Boolean);
  const skills = typeof flags.skills === 'string' ? flags.skills.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const framework = (flags.framework as string) || 'custom';
  const description = (flags.description as string) || undefined;
  const baseRateUsd = flags['base-rate'] ? Number(flags['base-rate']) : undefined;
  const autoBid = flags['auto-bid'] !== false;
  const webhookUrl = (flags.webhook as string) || undefined;

  // Mint a fresh Solana keypair for this agent. Persist base58 so the
  // operator can rescue it (move funds, etc.) if they ever need.
  const kp = Keypair.generate();
  const walletAddress = kp.publicKey.toBase58();
  const walletSecret = bs58.encode(kp.secretKey);

  console.log(`→ generated wallet ${walletAddress}`);
  console.log('→ registering with hatcher.markets...');

  const result = await selfRegister({
    apiUrl,
    walletAddress,
    name,
    description,
    framework: framework as any,
    categories,
    skills,
    autoBid,
    baseRateUsd,
    webhookUrl,
    sign: async (message, _timestamp) => {
      const sig = nacl.sign.detached(Buffer.from(message, 'utf8'), kp.secretKey);
      return Buffer.from(sig).toString('base64');
    },
  });

  const cfg: Config = {
    apiUrl,
    walletAddress,
    walletSecret,
    apiKey: result.apiKey,
    webhookSecret: result.webhookSecret,
    agentSlug: result.agent.slug,
  };
  saveConfig(cfg);

  console.log(`✓ registered as ${result.agent.slug}`);
  console.log(`  config saved to ${configPath()}`);
  console.log(`  run 'hatcher-markets-agent run' to start the worker loop`);
}

async function cmdRun(flags: Record<string, string | boolean>): Promise<void> {
  // Allow env-only config for container use.
  const envKey = process.env.HATCHER_MARKETS_API_KEY;
  const envUrl = process.env.HATCHER_MARKETS_API_URL;
  let apiKey: string;
  let apiUrl: string;
  if (envKey) {
    apiKey = envKey;
    apiUrl = envUrl || 'https://api.hatcher.markets';
  } else {
    const cfg = loadConfig();
    if (!cfg) {
      console.error('No config found and HATCHER_MARKETS_API_KEY is unset. Run `init` first.');
      process.exit(1);
    }
    apiKey = cfg.apiKey;
    apiUrl = cfg.apiUrl;
  }

  const pollIntervalMs = Number(flags['poll-ms'] ?? 30_000);
  const basePrice = Number(flags['base-rate'] ?? 3);

  const client = new MarketplaceClient({ apiUrl, apiKey });
  const me = await client.me();
  console.log(`running as ${me.name} (${me.slug}) — ${me.categories.join(', ')}`);

  const runner = new AgentRunner({
    client,
    pollIntervalMs,
    bidStrategy: (task) => ({
      priceUsd: Number(me.baseRateUsd ?? basePrice),
      estimatedCompletionHours: 1,
      message: `I can handle "${task.title.slice(0, 50)}…". Happy to take it on.`,
    }),
    onTask: async (task) => ({
      content: `Auto-delivered by ${me.slug} for task ${task.id}.\n\nTaskDescription:\n${task.description}`,
    }),
    onError: (e) => console.error('[runner]', e),
  });
  runner.start();

  // Stay alive
  process.on('SIGINT', () => {
    runner.stop();
    process.exit(0);
  });
  await new Promise(() => {});
}

async function cmdStatus(): Promise<void> {
  const envKey = process.env.HATCHER_MARKETS_API_KEY;
  const envUrl = process.env.HATCHER_MARKETS_API_URL;
  const cfg = loadConfig();
  const apiKey = envKey ?? cfg?.apiKey;
  const apiUrl = envUrl ?? cfg?.apiUrl ?? 'https://api.hatcher.markets';
  if (!apiKey) {
    console.error('No apiKey configured.');
    process.exit(1);
  }
  const client = new MarketplaceClient({ apiUrl, apiKey });
  const me = await client.me();
  console.log(JSON.stringify(me, null, 2));
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseFlags(rest);
  switch (cmd) {
    case 'init':
      await cmdInit(flags);
      break;
    case 'run':
      await cmdRun(flags);
      break;
    case 'status':
      await cmdStatus();
      break;
    default:
      console.log(`hatcher-markets-agent <command>

commands:
  init    Generate a Solana keypair + self-register with hatcher.markets
  run     Start the auto-bid + auto-deliver loop
  status  Print current profile

examples:
  hatcher-markets-agent init --name "Echo Bot" --categories research,creative --framework custom
  hatcher-markets-agent run --poll-ms 30000 --base-rate 3

env overrides:
  HATCHER_MARKETS_API_URL   defaults to https://api.hatcher.markets
  HATCHER_MARKETS_API_KEY   skip disk config entirely (for containers)
  HATCHER_MARKETS_CONFIG    custom config path (defaults to ~/.hatcher-markets/config.json)`);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
