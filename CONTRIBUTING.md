# Contributing

Thanks for your interest! pypes-bot is a small project; the contribution loop is intentionally short.

## Dev setup

```bash
bun install
cp .env.example .env       # fill in test workspace creds
bun test                   # run unit tests
bun run dev                # boot the bot in --hot mode against ./data/pypes.db
```

## Code style

- TypeScript strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- `bun test` is the only test runner; no Jest, no Vitest.
- Raw `fetch` for HTTP; no `@slack/web-api` or `@octokit/rest`.
- No comments explaining *what* code does; comments only when *why* is non-obvious.
- Functions stay small. If a function doesn't fit on a screen, split it.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/). Examples:
- `feat(worker): add intent classifier fallback`
- `fix(slack): respect Retry-After on 429`
- `docs(README): clarify cloudflared setup`

## Pull requests

- One logical change per PR.
- Include tests for new code paths.
- Update `CHANGELOG.md` under "Unreleased."
- All checks green before review.

## Manual QA recipe (release gate)

Run before tagging any release. Catches issues unit tests can't (real Slack API quirks, Docker behavior, NPX wrapper, end-to-end loop).

1. **Clean clone.** `git clone https://github.com/jaredzwick/pypes-bot.git /tmp/qa && cd /tmp/qa && bun install && bun test` — all green.
2. **NPX init.** `npx /tmp/qa/npx init` — every prompt accepts valid input, refuses obviously bad input.
3. **NPX start.** `npx /tmp/qa/npx start` → container up; `curl http://localhost:8080/healthz` → 200 with `kill_switch=false`.
4. **Tunnel setup.** `cloudflared tunnel --url http://localhost:8080` → paste URL into Slack app's Event Subscriptions.
5. **Allowed mention.** `@pypes-bot do nothing, just say hi` from your allowed user in an allowed channel → ✅ reaction within 1s → eventual thread reply with Claude's text.
6. **Disallowed mention.** Create a second Slack user not on the allowlist; `@pypes-bot ...` from them → ⛔ reaction, no thread reply.
7. **Ambiguous mention.** `@pypes-bot hey` → 🤔 reaction + thread reply asking for clarification.
8. **Kill switch.** `docker exec pypes-bot sqlite3 /data/pypes.db "UPDATE pypes_config SET kill_switch=1 WHERE id=1"` → next mention gets ✅ reaction but no dispatch (verify via `SELECT * FROM slack_mentions ORDER BY created_at DESC LIMIT 1`).
9. **Budget cap.** Manually insert 6 finished rows totaling > daily cap; restart bot; verify auto kill_switch flipped on next tick.
10. **PAT expiry warn.** Set a fake PAT with `X-GitHub-Token-Expiration: 2026-07-01` → restart → verify `/healthz` shows `pat_expires_in_days` warning if < 30.

All 10 steps pass = ready to tag.

## Releasing

```bash
# Bump version in package.json + npx/package.json + CHANGELOG.md
git commit -am "chore: release v0.X.Y"
git tag v0.X.Y
git push origin main --tags
# Release workflow builds + pushes GHCR image + publishes npm package
```
