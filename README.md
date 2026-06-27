# pypes-bot

> Self-hosted Slack bot. Mention `@pypes-bot`, get a Claude Code run, get a PR.

```
@pypes-bot   "Add a /health endpoint to the API."
   ↓ (✅ reaction appears under your message in <1s)
   ↓ intent classifier checks the request makes sense
   ↓ GitHub Actions runs claude --print on your repo
   ↓ Bot opens a PR + replies in the thread with the link
```

## What it does

- Listens for `@pypes-bot` mentions in allowlisted Slack channels.
- Acknowledges with a `:white_check_mark:` reaction (no chat-thread spam).
- Classifies intent before dispatching (rejects chit-chat; asks for clarification when ambiguous).
- Fires a `workflow_dispatch` on **your** GitHub repo — your Actions minutes, your Anthropic key, your code.
- The runner does the actual Claude run, opens the PR, and replies to the thread.
- Tracks per-mention cost; flips a kill-switch if the daily budget is exceeded.

## Quickstart

You'll need:

- A Slack workspace where you can install an app
- A GitHub repo you own
- A dedicated Anthropic API key with a console spend cap (do **not** reuse your main key)
- Docker installed locally (or anywhere you want to host the bot)
- A way to expose port 8080 over HTTPS — `cloudflared` (free, recommended) or `ngrok`

```bash
# 1. Start a tunnel so Slack can reach you
cloudflared tunnel --url http://localhost:8080
# Note the https://xxxxx.trycloudflare.com URL — you'll paste it during init

# 2. Initialize config
npx @pypes/bot init

# 3. Start the bot
npx @pypes/bot start

# 4. In Slack: paste the webhook URL printed by `init` into your Slack app's
#    "Event Subscriptions" Request URL.

# 5. In your GitHub repo:
#    a. Copy docs/pypes-bot-autopilot.yaml → .github/workflows/
#    b. Add repo secrets:
#       ANTHROPIC_API_KEY, PYPES_SLACK_BOT_TOKEN, PYPES_GH_PAT,
#       PYPES_RUNNER_CALLBACK_SECRET, PYPES_PUBLIC_URL
```

Honest TTHW (time to "hello world"): ~30 minutes the first time.

## Architecture

```
Slack workspace
    │ HTTPS webhook
    ▼
┌──────────────────────────────────────────────┐
│ pypes-bot (Bun + SQLite, single container)   │
│                                              │
│  POST /slack/events                          │
│   → verify HMAC                              │
│   → INSERT mention                           │
│   → notify worker channel                    │
│   → respond 200 (<100ms)                     │
│   → async: add ✅ reaction                   │
│                                              │
│  Worker (notify + 15s tick)                  │
│   → claim oldest pending                     │
│   → fetch thread history                     │
│   → intent.classify() with Haiku             │
│   →   clear     → dispatch workflow          │
│   →   ambiguous → swap ✅→🤔 + ask question  │
│   →   rejected  → swap ✅→⛔                 │
│                                              │
│  POST /runner/callback                       │
│   → verify HMAC                              │
│   → record cost, enforce daily budget        │
└──────────────────────────────────────────────┘
                       │
                       ▼ workflow_dispatch
┌──────────────────────────────────────────────┐
│ GitHub Actions runner (in YOUR repo)         │
│   → claude --print → PR → reply in thread    │
│   → POST /runner/callback with cost          │
└──────────────────────────────────────────────┘
```

The bot itself **does not run Claude**. It only:
1. Receives Slack webhooks and persists mentions.
2. Classifies intent (one small Haiku call, ~$0.0003 each).
3. Fires `workflow_dispatch` on your repo with the task.
4. Records cost reported by the runner; throws the kill-switch if the daily cap is hit.

## Security model

This is a **single-user trust** bot. The security boundary is:

1. **Slack allowlists.** Only `PYPES_ALLOWED_USER_IDS` can trigger runs in only `PYPES_ALLOWED_CHANNELS`.
2. **GitHub PAT scope.** Use a fine-grained PAT scoped to one repo with the minimum permissions (Actions, Contents, PRs — all write). Not an org PAT.
3. **Anthropic key scope.** Use a dedicated Anthropic API key with a $X/mo console spend cap. The runner has full access to this key.
4. **Daily budget.** `PYPES_DAILY_BUDGET_USD` flips the kill-switch when exceeded.

### What is NOT a security boundary

The Claude CLI's `--disallowedTools` flag is a **speed bump**, not a sandbox. A determined prompt-injection in a file Claude reads (a README, a fetched issue body) can:

- Exfiltrate `ANTHROPIC_API_KEY` and `PYPES_SLACK_BOT_TOKEN` via curl.
- Push to branches the disallowedTools list didn't anticipate.

**Mitigation:** dedicated Anthropic key with a hard spend cap. Treat your bot's repo and any repo it can write to as if any contributor could see the secrets.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Configuration

Every config value is an env var. See [`.env.example`](.env.example) for the full list with descriptions. The bot validates the schema at startup via [Zod](https://github.com/colinhacks/zod) — any missing or malformed value fails fast with a clear message.

## Ops

```bash
# Tail logs
docker logs -f pypes-bot

# Stop
docker stop pypes-bot

# Inspect DB
docker exec -it pypes-bot sqlite3 /data/pypes.db

# Flip the kill switch
docker exec pypes-bot sqlite3 /data/pypes.db \
  "UPDATE pypes_config SET kill_switch=1, paused_reason='manual' WHERE id=1"

# Reset the kill switch
docker exec pypes-bot sqlite3 /data/pypes.db \
  "UPDATE pypes_config SET kill_switch=0, paused_reason=NULL WHERE id=1"
```

## Known limitations (v0.1)

- **Tunnel disconnects drop mentions.** If `cloudflared` / `ngrok` is down, Slack retries for ~5min then drops. Switching to Slack Socket Mode is a v0.2 candidate.
- **One workspace, one repo.** The dispatcher fires to a single GH repo. Multi-target deferred.
- **Single-process, serial worker.** One mention at a time. Fine for typical Slack volumes.
- **PAT expires silently after 1 year.** The bot warns on `/healthz` when expiry < 30 days; it's still on you to rotate.

## Status

v0.1.0 — initial OSS release. Built on top of patterns from [pypes](https://github.com/jaredzwick/pypes)' internal paperclip bot.

## License

MIT © Pypes LLC
