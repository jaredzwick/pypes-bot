type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}
