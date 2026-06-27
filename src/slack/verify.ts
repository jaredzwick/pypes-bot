import { timingSafeEqual } from 'node:crypto';

const FIVE_MINUTES = 5 * 60;

export function verifySlackSignature(opts: {
  signingSecret: string;
  body: string;
  signature: string | null;
  timestamp: string | null;
  now?: number;
}): boolean {
  if (!opts.signature || !opts.timestamp) return false;

  const ts = Number.parseInt(opts.timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > FIVE_MINUTES) return false;

  const base = `v0:${opts.timestamp}:${opts.body}`;
  const hasher = new Bun.CryptoHasher('sha256', opts.signingSecret);
  hasher.update(base);
  const expected = `v0=${hasher.digest('hex')}`;

  if (expected.length !== opts.signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(opts.signature));
  } catch {
    return false;
  }
}

export function signRunnerCallback(secret: string, body: string): string {
  const hasher = new Bun.CryptoHasher('sha256', secret);
  hasher.update(body);
  return hasher.digest('hex');
}

export function verifyRunnerCallback(opts: {
  secret: string;
  body: string;
  signature: string | null;
}): boolean {
  if (!opts.signature) return false;
  const expected = signRunnerCallback(opts.secret, opts.body);
  if (expected.length !== opts.signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(opts.signature));
  } catch {
    return false;
  }
}
