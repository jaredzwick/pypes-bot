import { loadConfig } from './config';
import { openDb, runMigrations } from './db/client';
import { Store } from './db/queries';
import { SlackClient } from './slack/post';
import { GitHubClient } from './github/dispatch';
import { IntentClassifier } from './intent';
import { Worker } from './worker';
import { createHandler } from './server';
import { log } from './logger';

async function main(): Promise<void> {
  const cfg = loadConfig();

  const { db, raw } = openDb(cfg.DATABASE_PATH);
  const applied = runMigrations(raw);
  if (applied.length > 0) log('info', 'migrations_applied', { files: applied });

  const store = new Store(db);
  const cleared = await store.selfClear(cfg.PYPES_HOSTNAME);
  if (cleared > 0) log('info', 'self_clear_cancelled_stale_claims', { rows: cleared });

  const slack = new SlackClient(cfg.SLACK_BOT_TOKEN);
  const github = new GitHubClient(cfg.PYPES_GH_PAT, cfg.PYPES_GH_REPO, cfg.PYPES_GH_WORKFLOW, cfg.PYPES_GH_REF);
  const intent = new IntentClassifier(cfg.ANTHROPIC_API_KEY, cfg.PYPES_INTENT_MODEL);

  const worker = new Worker({ cfg, store, slack, github, intent });
  const workerPromise = worker.run();

  const handler = createHandler({ cfg, store, slack, worker });
  const server = Bun.serve({
    port: cfg.PORT,
    fetch: handler,
  });

  log('info', 'pypes_bot_started', {
    port: cfg.PORT,
    hostname: cfg.PYPES_HOSTNAME,
    allowed_users: cfg.PYPES_ALLOWED_USER_IDS.length,
    allowed_channels: cfg.PYPES_ALLOWED_CHANNELS.length,
    poll_interval_s: cfg.PYPES_POLL_INTERVAL_SECONDS,
    daily_budget_usd: cfg.PYPES_DAILY_BUDGET_USD,
  });

  const shutdown = async (signal: string) => {
    log('info', 'shutdown_signal', { signal });
    worker.stop();
    server.stop();
    raw.close();
    await workerPromise;
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log('error', 'fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
