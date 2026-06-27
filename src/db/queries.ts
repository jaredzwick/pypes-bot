import { sql, eq, and, isNull, inArray, gte } from 'drizzle-orm';
import type { DB } from './client';
import { slackMentions, pypesConfig } from './schema';
import type { SlackMention } from './schema';

export type ClaimedMention = SlackMention;

export type FinishResult = {
  status: 'success' | 'failed' | 'cancelled' | 'clarification_needed' | 'dropped_allowlist';
  intent?: 'clear' | 'ambiguous' | 'rejected';
  clarificationQuestion?: string;
  mode?: 'code' | 'ops_preview' | 'ops_execute';
  responseSlackTs?: string;
  errorText?: string;
};

export type CostUpdate = {
  mentionId: string;
  costUsd: number;
  exitCode: number;
  prUrl?: string;
};

export class Store {
  constructor(private db: DB) {}

  async insertMention(row: {
    id: string;
    channel: string;
    ts: string;
    userId: string;
    text: string;
    status?: 'pending' | 'dropped_allowlist';
  }): Promise<void> {
    await this.db
      .insert(slackMentions)
      .values({
        id: row.id,
        channel: row.channel,
        ts: row.ts,
        userId: row.userId,
        text: row.text,
        status: row.status ?? 'pending',
        ...(row.status === 'dropped_allowlist'
          ? { processedAt: new Date(), finishedAt: new Date() }
          : {}),
      })
      .run();
  }

  async claim(opts: {
    hostname: string;
    allowedUsers: string[];
    allowedChannels: string[];
  }): Promise<ClaimedMention | null> {
    const now = new Date();

    const row = await this.db
      .select()
      .from(slackMentions)
      .where(
        and(
          isNull(slackMentions.processedAt),
          eq(slackMentions.status, 'pending'),
          inArray(slackMentions.userId, opts.allowedUsers),
          inArray(slackMentions.channel, opts.allowedChannels),
        ),
      )
      .orderBy(slackMentions.createdAt)
      .limit(1)
      .get();

    if (!row) return null;

    const updated = await this.db
      .update(slackMentions)
      .set({
        status: 'running',
        claimedAt: now,
        claimedBy: opts.hostname,
        startedAt: now,
      })
      .where(and(eq(slackMentions.id, row.id), eq(slackMentions.status, 'pending')))
      .returning();

    if (updated.length === 0) return null;
    return { ...row, status: 'running', claimedAt: now, claimedBy: opts.hostname, startedAt: now };
  }

  async markFinished(mentionId: string, r: FinishResult): Promise<void> {
    const now = new Date();
    await this.db
      .update(slackMentions)
      .set({
        status: r.status,
        processedAt: now,
        finishedAt: now,
        intent: r.intent ?? null,
        clarificationQuestion: r.clarificationQuestion ?? null,
        mode: r.mode ?? null,
        responseSlackTs: r.responseSlackTs ?? null,
        errorText: r.errorText ?? null,
      })
      .where(eq(slackMentions.id, mentionId))
      .run();
  }

  async selfClear(hostname: string): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(slackMentions)
      .set({
        status: 'cancelled',
        processedAt: now,
        finishedAt: now,
        errorText: 'cancelled at startup self-clear',
      })
      .where(
        and(
          eq(slackMentions.status, 'running'),
          eq(slackMentions.claimedBy, hostname),
        ),
      )
      .returning({ id: slackMentions.id });
    return updated.length;
  }

  async isKilled(): Promise<{ killed: boolean; reason: string | null }> {
    const row = await this.db
      .select()
      .from(pypesConfig)
      .where(eq(pypesConfig.id, 1))
      .get();
    if (!row) return { killed: false, reason: null };
    return { killed: !!row.killSwitch, reason: row.pausedReason ?? null };
  }

  async flipKillSwitch(reason: string, updatedBy: string): Promise<void> {
    await this.db
      .update(pypesConfig)
      .set({
        killSwitch: true,
        pausedReason: reason,
        updatedAt: new Date(),
        updatedBy,
      })
      .where(eq(pypesConfig.id, 1))
      .run();
  }

  async dailyCostUsd(): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const row = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${slackMentions.costUsd}), 0)` })
      .from(slackMentions)
      .where(gte(slackMentions.finishedAt, startOfToday))
      .get();
    return Number(row?.total ?? 0);
  }

  async recordCost(u: CostUpdate): Promise<void> {
    await this.db
      .update(slackMentions)
      .set({
        costUsd: u.costUsd,
        exitCode: u.exitCode,
        prUrl: u.prUrl ?? null,
        finishedAt: new Date(),
      })
      .where(eq(slackMentions.id, u.mentionId))
      .run();
  }
}
