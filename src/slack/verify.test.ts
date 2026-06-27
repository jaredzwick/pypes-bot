import { describe, test, expect } from 'bun:test';
import { verifySlackSignature, signRunnerCallback, verifyRunnerCallback } from './verify';

const SECRET = 'shh';
const NOW = 1_700_000_000;

function sign(ts: string, body: string, secret = SECRET): string {
  const hasher = new Bun.CryptoHasher('sha256', secret);
  hasher.update(`v0:${ts}:${body}`);
  return `v0=${hasher.digest('hex')}`;
}

describe('verifySlackSignature', () => {
  test('valid signature returns true', () => {
    const ts = String(NOW);
    const body = '{"event":"x"}';
    const sig = sign(ts, body);
    expect(verifySlackSignature({ signingSecret: SECRET, body, signature: sig, timestamp: ts, now: NOW })).toBe(true);
  });

  test('tampered body fails', () => {
    const ts = String(NOW);
    const sig = sign(ts, 'original');
    expect(verifySlackSignature({ signingSecret: SECRET, body: 'tampered', signature: sig, timestamp: ts, now: NOW })).toBe(false);
  });

  test('stale timestamp (>5min) fails', () => {
    const ts = String(NOW - 6 * 60);
    const sig = sign(ts, 'body');
    expect(verifySlackSignature({ signingSecret: SECRET, body: 'body', signature: sig, timestamp: ts, now: NOW })).toBe(false);
  });

  test('missing signature fails', () => {
    expect(verifySlackSignature({ signingSecret: SECRET, body: 'b', signature: null, timestamp: String(NOW), now: NOW })).toBe(false);
  });

  test('missing timestamp fails', () => {
    expect(verifySlackSignature({ signingSecret: SECRET, body: 'b', signature: 'v0=x', timestamp: null, now: NOW })).toBe(false);
  });

  test('bad signing secret fails', () => {
    const ts = String(NOW);
    const sig = sign(ts, 'b', 'wrong-secret');
    expect(verifySlackSignature({ signingSecret: SECRET, body: 'b', signature: sig, timestamp: ts, now: NOW })).toBe(false);
  });
});

describe('runner callback signing', () => {
  test('round-trips', () => {
    const secret = 'a'.repeat(32);
    const body = '{"mention_id":"01HZX"}';
    const sig = signRunnerCallback(secret, body);
    expect(verifyRunnerCallback({ secret, body, signature: sig })).toBe(true);
  });

  test('tampered body fails', () => {
    const secret = 'a'.repeat(32);
    const sig = signRunnerCallback(secret, 'original');
    expect(verifyRunnerCallback({ secret, body: 'tampered', signature: sig })).toBe(false);
  });

  test('missing signature fails', () => {
    const secret = 'a'.repeat(32);
    expect(verifyRunnerCallback({ secret, body: 'b', signature: null })).toBe(false);
  });
});
