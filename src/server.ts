import { ulid } from 'ulid';
import type { Config } from './config';
import type { Store } from './db/queries';
import type { SlackClient } from './slack/post';
import type { Worker } from './worker';
import { verifySlackSignature, verifyRunnerCallback } from './slack/verify';
import { checkPatExpiry } from './github/expiry';
import { log } from './logger';

const INSERT_TIMEOUT_MS = 2000;

export type ServerDeps = {
  cfg: Config;
  store: Store;
  slack: SlackClient;
  worker: Worker;
};

export function createHandler(deps: ServerDeps): (req: Request) => Promise<Response> {
  let lastPatStatus: { daysUntilExpiry: number | null; ok: boolean } = { daysUntilExpiry: null, ok: true };
  let patChecked = 0;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      // Refresh PAT expiry at most once per hour
      if (Date.now() - patChecked > 3600_000) {
        patChecked = Date.now();
        const status = await checkPatExpiry(deps.cfg.PYPES_GH_PAT);
        lastPatStatus = { daysUntilExpiry: status.daysUntilExpiry, ok: status.ok };
      }
      const killed = await deps.store.isKilled();
      return json({
        ok: true,
        kill_switch: killed.killed,
        paused_reason: killed.reason,
        gh_pat_ok: lastPatStatus.ok,
        gh_pat_expires_in_days: lastPatStatus.daysUntilExpiry,
        version: '0.1.0',
      });
    }

    if (req.method === 'POST' && url.pathname === '/slack/events') {
      return handleSlackEvent(req, deps);
    }

    if (req.method === 'POST' && url.pathname === '/runner/callback') {
      return handleRunnerCallback(req, deps);
    }

    return new Response('not found', { status: 404 });
  };
}

async function handleSlackEvent(req: Request, deps: ServerDeps): Promise<Response> {
  const body = await req.text();
  const signature = req.headers.get('x-slack-signature');
  const timestamp = req.headers.get('x-slack-request-timestamp');
  if (!verifySlackSignature({ signingSecret: deps.cfg.SLACK_SIGNING_SECRET, body, signature, timestamp })) {
    return new Response('invalid signature', { status: 401 });
  }

  type Envelope =
    | { type: 'url_verification'; challenge: string }
    | { type: 'event_callback'; event: SlackEvent };
  type SlackEvent =
    | { type: 'app_mention'; channel: string; user: string; ts: string; text: string; thread_ts?: string }
    | { type: string; [k: string]: unknown };

  let payload: Envelope;
  try {
    payload = JSON.parse(body) as Envelope;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  if (payload.type === 'url_verification') {
    return new Response(payload.challenge, { headers: { 'Content-Type': 'text/plain' } });
  }

  if (payload.type !== 'event_callback') {
    return new Response('ok', { status: 200 });
  }

  const evt = payload.event;
  if (evt.type !== 'app_mention') {
    return new Response('ok', { status: 200 });
  }

  const ev = evt as { channel: string; user: string; ts: string; text: string };

  const channelAllowed = deps.cfg.PYPES_ALLOWED_CHANNELS.includes(ev.channel);
  const userAllowed = deps.cfg.PYPES_ALLOWED_USER_IDS.includes(ev.user);

  const id = ulid();

  if (!channelAllowed) {
    // Silent drop, not even an audit row — bot was added to a channel it doesn't own
    log('info', 'webhook_drop_channel', { channel: ev.channel, user: ev.user });
    return new Response('ok', { status: 200 });
  }

  const status: 'pending' | 'dropped_allowlist' = userAllowed ? 'pending' : 'dropped_allowlist';

  await Promise.race([
    deps.store.insertMention({
      id,
      channel: ev.channel,
      ts: ev.ts,
      userId: ev.user,
      text: ev.text,
      status,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('insert timeout')), INSERT_TIMEOUT_MS)),
  ]).catch((err) => {
    log('error', 'webhook_insert_failed', { error: String(err) });
    throw err;
  });

  // Async post-200 work: emoji + notify
  queueMicrotask(() => {
    void (async () => {
      if (userAllowed) {
        deps.worker.signalNewMention();
        await deps.slack.addReaction(ev.channel, ev.ts, 'white_check_mark').catch((e) => {
          log('warn', 'webhook_reaction_failed', { error: String(e) });
        });
      } else {
        await deps.slack.addReaction(ev.channel, ev.ts, 'no_entry').catch((e) => {
          log('warn', 'webhook_reaction_failed', { error: String(e) });
        });
      }
    })();
  });

  return new Response('ok', { status: 200 });
}

async function handleRunnerCallback(req: Request, deps: ServerDeps): Promise<Response> {
  const body = await req.text();
  const signature = req.headers.get('x-pypes-signature');
  if (!verifyRunnerCallback({ secret: deps.cfg.PYPES_RUNNER_CALLBACK_SECRET, body, signature })) {
    return new Response('invalid signature', { status: 401 });
  }
  type Body = {
    mention_id: string;
    cost_usd: number;
    exit_code: number;
    pr_url?: string;
  };
  let parsed: Body;
  try {
    parsed = JSON.parse(body) as Body;
  } catch {
    return new Response('bad json', { status: 400 });
  }
  if (!parsed.mention_id || typeof parsed.cost_usd !== 'number') {
    return new Response('missing fields', { status: 400 });
  }

  await deps.store.recordCost({
    mentionId: parsed.mention_id,
    costUsd: parsed.cost_usd,
    exitCode: parsed.exit_code,
    ...(parsed.pr_url ? { prUrl: parsed.pr_url } : {}),
  });

  const spent = await deps.store.dailyCostUsd();
  if (deps.cfg.PYPES_DAILY_BUDGET_USD > 0 && spent >= deps.cfg.PYPES_DAILY_BUDGET_USD) {
    await deps.store.flipKillSwitch(
      `daily cap exceeded: $${spent.toFixed(2)} >= $${deps.cfg.PYPES_DAILY_BUDGET_USD.toFixed(2)}`,
      deps.cfg.PYPES_HOSTNAME,
    );
  }

  return new Response('', { status: 204 });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
