# Architecture

## Components

```
┌─ Slack workspace ─────────────────────────────────────────────┐
│  @pypes-bot mention                                            │
│     │                                                          │
│     │ HTTPS Events API webhook                                 │
│     ▼                                                          │
└─────┼──────────────────────────────────────────────────────────┘
      │
      ▼ via cloudflared/ngrok tunnel to localhost:8080
┌────────────────────────────────────────────────────────────────┐
│ pypes-bot container (Bun TS, single process)                   │
│                                                                │
│  Bun.serve handler                                             │
│   POST /slack/events ── verify HMAC ─ INSERT ─ notify ─ 200    │
│                                            │                   │
│                                            ▼                   │
│                                  async: reactions.add ✅       │
│                                                                │
│   POST /runner/callback ── verify HMAC ─ recordCost ─ 204      │
│                                            │                   │
│                                            ▼                   │
│                              if daily >= cap → flipKillSwitch  │
│                                                                │
│   GET /healthz ── { ok, kill_switch, gh_pat_expires_in_days }  │
│                                                                │
│  Worker (Promise.race([notify, sleep(15s)]))                   │
│   ├─ isKilled? skip                                            │
│   ├─ claim oldest pending (allowlist filtered)                 │
│   ├─ fetchThread → buildPrompt                                 │
│   ├─ intent.classify(Haiku 1-turn)                             │
│   │    ├─ rejected   → ✅→⛔, mark dropped_allowlist            │
│   │    ├─ ambiguous  → ✅→🤔, postMessage question, mark       │
│   │    └─ clear      → dispatch + mark success                 │
│   └─ on GitHubAuthError → flipKillSwitch + ❌                  │
└────────────────────────────────────────────────────────────────┘
      │ workflow_dispatch
      ▼
┌────────────────────────────────────────────────────────────────┐
│ GitHub Actions runner (user's repo)                            │
│   checkout → install claude → claude --print → diff?           │
│      ├─ yes → commit + push + gh pr create                     │
│      └─ no  → post claude's text to thread                     │
│   POST /runner/callback with cost_usd                          │
└────────────────────────────────────────────────────────────────┘
```

## Reaction state machine

```
        webhook arrives
              │
              ▼
            [✅]
              │
   ┌──────────┼──────────┐
   │          │          │
intent=     intent=    intent=
rejected  ambiguous    clear
   │          │          │
   ▼          ▼          ▼
  [⛔]       [🤔]       [✅]  ──runner err──►  [✅❌]
                                     │
                                     └──runner ok──►  [✅]
```

## Data model

Two tables in SQLite (WAL mode, busy_timeout=5000):

- `slack_mentions` — every mention received. Indexed on `processed_at` (queue cursor) and `created_at DESC` (ordering). Status enum: `pending → running → {success|failed|cancelled|clarification_needed|dropped_allowlist}`. CHECK constraint forbids `processed_at IS NOT NULL` with `status='pending'`.
- `pypes_config` — single row (id=1) holding `kill_switch`, `paused_reason`, `updated_at`, `updated_by`. CHECK enforces single-row.
- `schema_migrations` — applied migration versions (lexical order).

## Trust boundary

| Layer | Boundary |
|---|---|
| Slack inbound | HMAC-SHA256 over `v0:{ts}:{body}` with `SLACK_SIGNING_SECRET`. Reject if ts is >5min off. |
| Allowlist | `PYPES_ALLOWED_USER_IDS` × `PYPES_ALLOWED_CHANNELS`. Enforced at INSERT time and again at claim time. |
| Runner inbound | HMAC-SHA256 over raw body with `PYPES_RUNNER_CALLBACK_SECRET`. |
| GitHub | Fine-grained PAT, single repo, Actions/Contents/PRs write. Expiry surfaced via `/healthz`. |
| Anthropic (runner) | Dedicated key, console spend cap. The bot's daily budget cap is a soft-fail backstop. |

## Failure modes

See `SECURITY.md` for the threat model. Failures from §14 of the design doc:

- Tunnel disconnect → mentions lost (Slack retries ~5min, then drops). Documented v0.1 limitation.
- PAT revoked mid-flight → `GitHubAuthError` → ❌ reaction + flipKillSwitch.
- Intent classifier 503 → fallback `kind:'clear'` (degradation, not stoppage).
- Slack 429 → respect `Retry-After`, max 3 retries.
- INSERT under contention → 2s context timeout → 500 → Slack retries.
- Runner callback replay → idempotent via `mention_id` unique on UPDATE.
