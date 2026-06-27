export type PatStatus = {
  ok: boolean;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  error?: string;
};

export async function checkPatExpiry(
  pat: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<PatStatus> {
  try {
    const res = await fetchImpl('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, expiresAt: null, daysUntilExpiry: null, error: `auth ${res.status}` };
    }
    if (!res.ok) {
      return { ok: false, expiresAt: null, daysUntilExpiry: null, error: `status ${res.status}` };
    }
    const expiryHeader = res.headers.get('github-authentication-token-expiration');
    if (!expiryHeader) {
      return { ok: true, expiresAt: null, daysUntilExpiry: null };
    }
    const expiresAt = new Date(expiryHeader);
    if (Number.isNaN(expiresAt.getTime())) {
      return { ok: true, expiresAt: null, daysUntilExpiry: null };
    }
    const days = Math.floor((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return { ok: true, expiresAt, daysUntilExpiry: days };
  } catch (e) {
    return { ok: false, expiresAt: null, daysUntilExpiry: null, error: (e as Error).message };
  }
}
