# Security Policy

## Threat model

`pypes-bot` is a **single-user trust** tool. It assumes:

- One operator (you) controls the Slack allowlist.
- One operator (you) controls the GitHub PAT and Anthropic key.
- Slack messages in allowlisted channels are treated as instructions to Claude.

If multiple people can post in an allowlisted channel, **they all have the same trust level as the operator** in terms of what they can ask Claude to do.

## Boundary: what protects you

1. **Slack user-ID + channel-ID allowlists** (env CSV).
2. **GitHub PAT scope** — fine-grained, single repo, minimum permissions.
3. **Anthropic API key spend cap** — set on the Anthropic console, NOT in code.
4. **Daily budget** (`PYPES_DAILY_BUDGET_USD`) — flips kill-switch when exceeded.

## NOT a boundary: `--disallowedTools`

The Claude CLI's `--disallowedTools` flag rejects exact tool-string prefixes (e.g. `Bash(git push -f*)`). It is a **speed bump** against accidental harm. It is NOT a sandbox.

A prompt-injection in a file Claude reads — a README the agent grep'd, an issue body it `gh issue view`'d, a dependency's README pulled in by a search — can:

- Cause Claude to `curl` your secrets to an attacker.
- Push to branches the disallowedTools list didn't anticipate.
- Mutate the repo in ways the user didn't ask for.

The disallowedTools list is currently:

```
Bash(git push -f*) Bash(rm -rf*) Bash(psql*) Bash(kubectl*) Bash(helm*)
Edit(.env*) Edit(.github/**) Edit(CLAUDE.md)
```

**Mitigations you should apply:**

- Use a dedicated Anthropic key with a hard monthly spend cap.
- Use a fine-grained PAT scoped to one repo.
- Don't grant the bot write access to repos containing other people's secrets.
- Treat the bot's repo as if its contents were public.

## Reporting a vulnerability

Use [GitHub Security Advisories](https://github.com/jaredzwick/pypes-bot/security/advisories) to privately report security issues. Please don't open public issues for security bugs.

We'll acknowledge within 72 hours.

## Scope

In scope:
- HMAC verification logic (Slack signature, runner callback)
- Allowlist enforcement
- Kill switch behavior
- Token handling (PAT, signing secret, Anthropic key)
- DB query SQL injection
- Anything in `src/`, `npx/`, `Dockerfile`

Out of scope:
- The Anthropic API itself (report to Anthropic).
- Slack's API (report to Slack).
- GitHub's API (report to GitHub).
- Whether Claude follows the system prompt's blast-radius rules (that's a Claude model behavior question, not a pypes-bot bug).
