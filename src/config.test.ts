import { describe, test, expect } from 'bun:test';
import { ConfigSchema, loadConfig } from './config';

const validEnv = {
  SLACK_SIGNING_SECRET: 'shh',
  SLACK_BOT_TOKEN: 'xoxb-abc',
  PYPES_ALLOWED_USER_IDS: 'U1,U2',
  PYPES_ALLOWED_CHANNELS: 'C1',
  PYPES_GH_PAT: 'github_pat_xyz',
  PYPES_GH_REPO: 'owner/repo',
  PYPES_RUNNER_CALLBACK_SECRET: 'a'.repeat(32),
  PYPES_PUBLIC_URL: 'https://example.com',
  ANTHROPIC_API_KEY: 'sk-ant-xyz',
};

describe('config', () => {
  test('parses a fully populated env', () => {
    const cfg = loadConfig(validEnv as NodeJS.ProcessEnv);
    expect(cfg.PYPES_ALLOWED_USER_IDS).toEqual(['U1', 'U2']);
    expect(cfg.PYPES_ALLOWED_CHANNELS).toEqual(['C1']);
    expect(cfg.PYPES_GH_WORKFLOW).toBe('pypes-bot-autopilot.yaml');
    expect(cfg.PYPES_GH_REF).toBe('main');
    expect(cfg.PYPES_POLL_INTERVAL_SECONDS).toBe(15);
    expect(cfg.PORT).toBe(8080);
  });

  test('throws with field name when required is missing', () => {
    const env = { ...validEnv } as Record<string, string>;
    delete env.SLACK_SIGNING_SECRET;
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/SLACK_SIGNING_SECRET/);
  });

  test('throws when bot token is not xoxb-', () => {
    const env = { ...validEnv, SLACK_BOT_TOKEN: 'xapp-bad' };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/SLACK_BOT_TOKEN/);
  });

  test('throws when allowlist is empty', () => {
    const env = { ...validEnv, PYPES_ALLOWED_USER_IDS: '   ' };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/PYPES_ALLOWED_USER_IDS/);
  });

  test('throws when callback secret is too short', () => {
    const env = { ...validEnv, PYPES_RUNNER_CALLBACK_SECRET: 'short' };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/PYPES_RUNNER_CALLBACK_SECRET/);
  });

  test('throws when repo is not owner/repo', () => {
    const env = { ...validEnv, PYPES_GH_REPO: 'no-slash-here' };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/PYPES_GH_REPO/);
  });

  test('throws when budget is not a number', () => {
    const env = { ...validEnv, PYPES_DAILY_BUDGET_USD: 'fifty' };
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow(/PYPES_DAILY_BUDGET_USD/);
  });

  test('trims and dedupes CSV whitespace', () => {
    const env = { ...validEnv, PYPES_ALLOWED_USER_IDS: ' U1 , U2 ,  ,U3 ' };
    const cfg = loadConfig(env as NodeJS.ProcessEnv);
    expect(cfg.PYPES_ALLOWED_USER_IDS).toEqual(['U1', 'U2', 'U3']);
  });

  test('schema is exported for tests', () => {
    expect(ConfigSchema).toBeDefined();
  });
});
