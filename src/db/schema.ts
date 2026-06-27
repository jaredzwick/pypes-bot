import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const slackMentions = sqliteTable('slack_mentions', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  ts: text('ts').notNull(),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
  claimedBy: text('claimed_by'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  status: text('status', {
    enum: [
      'pending',
      'running',
      'success',
      'failed',
      'cancelled',
      'dropped_allowlist',
      'clarification_needed',
    ],
  })
    .notNull()
    .default('pending'),
  intent: text('intent', { enum: ['clear', 'ambiguous', 'rejected'] }),
  clarificationQuestion: text('clarification_question'),
  mode: text('mode', { enum: ['code', 'ops_preview', 'ops_execute'] }),
  responseSlackTs: text('response_slack_ts'),
  costUsd: real('cost_usd').default(0),
  exitCode: integer('exit_code'),
  prUrl: text('pr_url'),
  errorText: text('error_text'),
});

export const pypesConfig = sqliteTable('pypes_config', {
  id: integer('id').primaryKey(),
  killSwitch: integer('kill_switch', { mode: 'boolean' }).notNull().default(false),
  pausedReason: text('paused_reason'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedBy: text('updated_by'),
});

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type SlackMention = typeof slackMentions.$inferSelect;
export type NewSlackMention = typeof slackMentions.$inferInsert;
export type PypesConfigRow = typeof pypesConfig.$inferSelect;
