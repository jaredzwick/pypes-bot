import { describe, test, expect } from 'bun:test';
import { parseIntent } from './intent';

describe('parseIntent', () => {
  test('clear', () => {
    expect(parseIntent('{"kind":"clear"}')).toEqual({ kind: 'clear' });
  });

  test('ambiguous with question', () => {
    const r = parseIntent('{"kind":"ambiguous","question":"What repo?"}');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.question).toBe('What repo?');
  });

  test('rejected with reason', () => {
    const r = parseIntent('{"kind":"rejected","reason":"chit-chat"}');
    expect(r.kind).toBe('rejected');
  });

  test('ambiguous missing question falls back to clear', () => {
    expect(parseIntent('{"kind":"ambiguous"}')).toEqual({ kind: 'clear' });
  });

  test('garbage falls back to clear', () => {
    expect(parseIntent('this is not json')).toEqual({ kind: 'clear' });
  });

  test('extra prose around JSON still parses', () => {
    expect(parseIntent('Here is my answer: {"kind":"clear"} thanks')).toEqual({ kind: 'clear' });
  });
});
