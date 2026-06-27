const SLACK = 'https://slack.com/api';

export type PostResult = { ts: string; channel: string };

export class SlackClient {
  constructor(private token: string, private fetchImpl: typeof fetch = fetch) {}

  async postMessage(channel: string, threadTs: string | null, text: string): Promise<PostResult> {
    return this.callWithRetry('chat.postMessage', { channel, thread_ts: threadTs ?? undefined, text });
  }

  async addReaction(channel: string, ts: string, name: string): Promise<void> {
    await this.callWithRetry('reactions.add', { channel, timestamp: ts, name });
  }

  async removeReaction(channel: string, ts: string, name: string): Promise<void> {
    try {
      await this.callWithRetry('reactions.remove', { channel, timestamp: ts, name });
    } catch (err) {
      // 'no_reaction' is fine — the emoji was never added or already gone.
      if (err instanceof Error && err.message.includes('no_reaction')) return;
      throw err;
    }
  }

  async fetchThread(channel: string, ts: string): Promise<Array<{ user?: string; bot_id?: string; text: string }>> {
    const url = `${SLACK}/conversations.replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(ts)}&limit=30`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const body = (await res.json()) as { ok: boolean; messages?: Array<{ user?: string; bot_id?: string; text: string }>; error?: string };
    if (!body.ok) throw new Error(`slack conversations.replies: ${body.error ?? 'unknown'}`);
    return body.messages ?? [];
  }

  private async callWithRetry(method: string, payload: object, attempt = 0): Promise<PostResult> {
    const res = await this.fetchImpl(`${SLACK}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      await sleep((retryAfter || 1) * 1000);
      return this.callWithRetry(method, payload, attempt + 1);
    }

    const body = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (!body.ok) throw new Error(`slack ${method}: ${body.error ?? `status ${res.status}`}`);
    return { ts: body.ts ?? '', channel: body.channel ?? '' };
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
