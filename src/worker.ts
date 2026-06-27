import type { Config } from './config';
import type { Store, ClaimedMention } from './db/queries';
import type { SlackClient } from './slack/post';
import type { GitHubClient } from './github/dispatch';
import { GitHubAuthError } from './github/dispatch';
import type { IntentClassifier } from './intent';
import { log } from './logger';

export type WorkerDeps = {
  cfg: Config;
  store: Store;
  slack: SlackClient;
  github: GitHubClient;
  intent: IntentClassifier;
};

export class Worker {
  private notify = new Notifier();
  private abort = new AbortController();

  constructor(private deps: WorkerDeps) {}

  signalNewMention(): void {
    this.notify.signal();
  }

  stop(): void {
    this.abort.abort();
  }

  async run(): Promise<void> {
    const interval = this.deps.cfg.PYPES_POLL_INTERVAL_SECONDS * 1000;
    while (!this.abort.signal.aborted) {
      try {
        await this.tick();
      } catch (err) {
        log('error', 'worker_tick_panic', { error: String(err) });
      }
      await this.notify.waitOrTimeout(interval, this.abort.signal);
    }
    log('info', 'worker_stopped');
  }

  private async tick(): Promise<void> {
    const killed = await this.deps.store.isKilled();
    if (killed.killed) {
      log('debug', 'worker_kill_switch_on', { reason: killed.reason ?? '' });
      return;
    }

    if (this.deps.cfg.PYPES_DAILY_BUDGET_USD > 0) {
      const spent = await this.deps.store.dailyCostUsd();
      if (spent >= this.deps.cfg.PYPES_DAILY_BUDGET_USD) {
        const reason = `daily cap exceeded: $${spent.toFixed(2)} >= $${this.deps.cfg.PYPES_DAILY_BUDGET_USD.toFixed(2)}`;
        await this.deps.store.flipKillSwitch(reason, this.deps.cfg.PYPES_HOSTNAME);
        log('warn', 'worker_auto_kill', { spent, cap: this.deps.cfg.PYPES_DAILY_BUDGET_USD });
        return;
      }
    }

    const m = await this.deps.store.claim({
      hostname: this.deps.cfg.PYPES_HOSTNAME,
      allowedUsers: this.deps.cfg.PYPES_ALLOWED_USER_IDS,
      allowedChannels: this.deps.cfg.PYPES_ALLOWED_CHANNELS,
    });
    if (!m) return;

    log('info', 'worker_run_start', { mention_id: m.id, channel: m.channel, user_id: m.userId });
    await this.process(m);
  }

  private async process(m: ClaimedMention): Promise<void> {
    const thread = await this.fetchThreadSafely(m);
    const task = buildPrompt(m, thread);

    const intent = await this.deps.intent.classify(m.text, thread);

    if (intent.kind === 'rejected') {
      await safe(() => this.deps.slack.removeReaction(m.channel, m.ts, 'white_check_mark'));
      await safe(() => this.deps.slack.addReaction(m.channel, m.ts, 'no_entry'));
      await this.deps.store.markFinished(m.id, {
        status: 'dropped_allowlist',
        intent: 'rejected',
        errorText: intent.reason,
      });
      return;
    }

    if (intent.kind === 'ambiguous') {
      await safe(() => this.deps.slack.removeReaction(m.channel, m.ts, 'white_check_mark'));
      await safe(() => this.deps.slack.addReaction(m.channel, m.ts, 'thinking_face'));
      const post = await safe(() => this.deps.slack.postMessage(m.channel, m.ts, intent.question));
      await this.deps.store.markFinished(m.id, {
        status: 'clarification_needed',
        intent: 'ambiguous',
        clarificationQuestion: intent.question,
        ...(post && 'ts' in post ? { responseSlackTs: post.ts } : {}),
      });
      return;
    }

    try {
      await this.deps.github.dispatch({
        mentionId: m.id,
        task,
        slackChannel: m.channel,
        slackThreadTs: m.ts,
        slackUserId: m.userId,
      });
      await this.deps.store.markFinished(m.id, {
        status: 'success',
        intent: 'clear',
        mode: classifyMode(m.text),
      });
      log('info', 'worker_run_end', { mention_id: m.id, status: 'dispatched' });
    } catch (err) {
      const isAuth = err instanceof GitHubAuthError;
      await safe(() => this.deps.slack.addReaction(m.channel, m.ts, 'x'));
      if (isAuth) {
        await this.deps.store.flipKillSwitch(
          'github PAT rejected — rotate PYPES_GH_PAT and reset kill_switch',
          this.deps.cfg.PYPES_HOSTNAME,
        );
        await safe(() =>
          this.deps.slack.postMessage(m.channel, m.ts, "Couldn't dispatch: GitHub PAT was rejected. Bot is paused until rotated."),
        );
      } else {
        await safe(() =>
          this.deps.slack.postMessage(m.channel, m.ts, `Couldn't dispatch: ${(err as Error).message.slice(0, 200)}`),
        );
      }
      await this.deps.store.markFinished(m.id, {
        status: 'failed',
        intent: 'clear',
        errorText: (err as Error).message,
      });
    }
  }

  private async fetchThreadSafely(m: ClaimedMention): Promise<string> {
    try {
      const msgs = await this.deps.slack.fetchThread(m.channel, m.ts);
      if (msgs.length <= 1) return '';
      return msgs
        .map((msg) => {
          const sender = msg.user ?? msg.bot_id ?? 'unknown';
          return `[${sender}] ${msg.text.trim()}`;
        })
        .join('\n');
    } catch (err) {
      log('warn', 'worker_history_fetch_failed', { mention_id: m.id, error: String(err) });
      return '';
    }
  }
}

class Notifier {
  private resolvers: Array<() => void> = [];

  signal(): void {
    const list = this.resolvers;
    this.resolvers = [];
    for (const r of list) r();
  }

  async waitOrTimeout(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => done(), ms);
      const onAbort = () => done();
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        const i = this.resolvers.indexOf(resolveOnce);
        if (i >= 0) this.resolvers.splice(i, 1);
        resolve();
      };
      const resolveOnce = () => done();
      this.resolvers.push(resolveOnce);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export function buildPrompt(m: { text: string }, threadContext: string): string {
  if (!threadContext) return m.text;
  return `Conversation thread context (oldest first):
${threadContext}

---

Latest mention (this is your task — respond to it with the thread above in mind):
${m.text}`;
}

export function classifyMode(text: string): 'code' | 'ops_preview' | 'ops_execute' {
  if (text.includes('[EXECUTE]')) return 'ops_execute';
  return 'code';
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    log('warn', 'worker_safe_call_failed', { error: String(err) });
    return null;
  }
}
