import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { ulid } from 'ulid';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './queries';
import * as schema from './schema';

function freshDb() {
  const raw = new Database(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const sqlPath = join(import.meta.dir, '..', '..', 'migrations', '0001_initial.sql');
  raw.exec(readFileSync(sqlPath, 'utf8'));
  return new Store(drizzle(raw, { schema }));
}

describe('Store', () => {
  let store: Store;
  beforeEach(() => {
    store = freshDb();
  });

  test('insertMention then claim picks oldest pending from allowlist', async () => {
    await store.insertMention({ id: ulid(), channel: 'C1', ts: '1.0', userId: 'U1', text: 'one' });
    await new Promise((r) => setTimeout(r, 2));
    await store.insertMention({ id: ulid(), channel: 'C1', ts: '2.0', userId: 'U1', text: 'two' });

    const m = await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    expect(m?.text).toBe('one');
    expect(m?.status).toBe('running');
  });

  test('claim returns null when nothing pending', async () => {
    const m = await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    expect(m).toBeNull();
  });

  test('claim filters by allowlist', async () => {
    await store.insertMention({ id: ulid(), channel: 'C1', ts: '1', userId: 'U_BAD', text: 't' });
    const m = await store.claim({ hostname: 'h', allowedUsers: ['U_GOOD'], allowedChannels: ['C1'] });
    expect(m).toBeNull();
  });

  test('markFinished closes the row', async () => {
    const id = ulid();
    await store.insertMention({ id, channel: 'C1', ts: '1', userId: 'U1', text: 't' });
    await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    await store.markFinished(id, { status: 'success', intent: 'clear', mode: 'code', responseSlackTs: '99.99' });

    const m = await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    expect(m).toBeNull();
  });

  test('selfClear cancels stale claims by hostname', async () => {
    const id = ulid();
    await store.insertMention({ id, channel: 'C1', ts: '1', userId: 'U1', text: 't' });
    await store.claim({ hostname: 'h1', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    const cleared = await store.selfClear('h1');
    expect(cleared).toBe(1);
  });

  test('isKilled defaults to false', async () => {
    const k = await store.isKilled();
    expect(k.killed).toBe(false);
  });

  test('flipKillSwitch toggles state with reason', async () => {
    await store.flipKillSwitch('test reason', 'tester');
    const k = await store.isKilled();
    expect(k.killed).toBe(true);
    expect(k.reason).toBe('test reason');
  });

  test('recordCost updates cost and pr url', async () => {
    const id = ulid();
    await store.insertMention({ id, channel: 'C1', ts: '1', userId: 'U1', text: 't' });
    await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    await store.recordCost({ mentionId: id, costUsd: 0.42, exitCode: 0, prUrl: 'https://pr/1' });
    const total = await store.dailyCostUsd();
    expect(total).toBeCloseTo(0.42);
  });

  test('dropped_allowlist insert is immediately processed', async () => {
    const id = ulid();
    await store.insertMention({ id, channel: 'C1', ts: '1', userId: 'U_BAD', text: 't', status: 'dropped_allowlist' });
    const m = await store.claim({ hostname: 'h', allowedUsers: ['U1'], allowedChannels: ['C1'] });
    expect(m).toBeNull();
  });
});
