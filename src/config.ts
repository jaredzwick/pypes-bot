import { z } from 'zod';

const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .refine((arr) => arr.length > 0, 'must contain at least one entry');

const url = z.string().url();
const xoxb = z.string().regex(/^xoxb-/, 'expected xoxb- bot token');
const ownerRepo = z.string().regex(/^[^/]+\/[^/]+$/, 'expected owner/repo');
const nonEmpty = z.string().min(1);
const secret32 = z.string().min(32, 'must be at least 32 characters');

export const ConfigSchema = z.object({
  // Slack
  SLACK_SIGNING_SECRET: nonEmpty,
  SLACK_BOT_TOKEN: xoxb,
  PYPES_ALLOWED_USER_IDS: csv,
  PYPES_ALLOWED_CHANNELS: csv,

  // GitHub
  PYPES_GH_PAT: nonEmpty,
  PYPES_GH_REPO: ownerRepo,
  PYPES_GH_WORKFLOW: z.string().default('pypes-bot-autopilot.yaml'),
  PYPES_GH_REF: z.string().default('main'),

  // Runner callback
  PYPES_RUNNER_CALLBACK_SECRET: secret32,
  PYPES_PUBLIC_URL: url,

  // Anthropic (bot uses this for intent classifier; runner uses its own secret)
  ANTHROPIC_API_KEY: nonEmpty,

  // Tunables
  PYPES_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  PYPES_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  PYPES_MAX_BUDGET_USD: z.coerce.number().positive().default(10),
  PYPES_MAX_TURNS: z.coerce.number().int().positive().default(15),
  PYPES_CLAUDE_MODEL: z.string().default('haiku'),
  PYPES_INTENT_MODEL: z.string().default('claude-haiku-4-5-20251001'),

  // Customization
  PYPES_SYSTEM_PROMPT_FILE: z.string().optional(),

  // Infrastructure
  DATABASE_PATH: z.string().default('/data/pypes.db'),
  PORT: z.coerce.number().int().positive().default(8080),
  PYPES_HOSTNAME: z.string().default('pypes-bot'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid pypes-bot configuration:\n${issues}`);
  }
  return result.data;
}
