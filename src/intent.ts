import Anthropic from '@anthropic-ai/sdk';

export type Intent =
  | { kind: 'clear' }
  | { kind: 'ambiguous'; question: string }
  | { kind: 'rejected'; reason: string };

const SYSTEM = `You classify a Slack mention of an autonomous bot. The bot can:
- make code changes by opening a PR
- read files and answer questions about a codebase
- run small ops tasks (querying state)

Decide one of:
- "clear": user wants a specific action the bot can perform. Proceed.
- "ambiguous": unclear what action is wanted. Ask one short clarifying question.
- "rejected": not actionable (chit-chat, off-topic, asking for sensitive info, impossible request).

Return ONLY a JSON object, no prose. Shapes:
  {"kind":"clear"}
  {"kind":"ambiguous","question":"<one question under 140 chars>"}
  {"kind":"rejected","reason":"<short reason>"}`;

export class IntentClassifier {
  private anthropic: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async classify(mentionText: string, threadContext: string): Promise<Intent> {
    try {
      const userBlock = threadContext
        ? `Thread so far:\n${threadContext}\n\nLatest mention:\n${mentionText}`
        : `Mention:\n${mentionText}`;

      const res = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: userBlock }],
      });
      const block = res.content[0];
      const raw = block && block.type === 'text' ? block.text.trim() : '';
      return parseIntent(raw);
    } catch {
      // Degradation, not stoppage — if the classifier is down, proceed as 'clear'.
      return { kind: 'clear' };
    }
  }
}

export function parseIntent(raw: string): Intent {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { kind: 'clear' };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { kind?: string; question?: string; reason?: string };
    if (obj.kind === 'ambiguous' && typeof obj.question === 'string' && obj.question.trim()) {
      return { kind: 'ambiguous', question: obj.question.slice(0, 200) };
    }
    if (obj.kind === 'rejected') {
      return { kind: 'rejected', reason: (obj.reason ?? 'rejected by classifier').slice(0, 200) };
    }
    return { kind: 'clear' };
  } catch {
    return { kind: 'clear' };
  }
}
