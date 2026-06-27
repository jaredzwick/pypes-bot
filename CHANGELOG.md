# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-26

### Added
- Initial OSS release. Behavior ported from the internal pypes paperclip bot.
- Slack `@pypes-bot` mention → GitHub Actions `workflow_dispatch` → Claude → PR loop.
- Reaction-based status protocol (✅ working, 🤔 needs clarification, ⛔ rejected, ❌ failed).
- Intent classifier (Haiku, 1-turn) gates expensive runner dispatches.
- HMAC-signed runner callback for cost tracking + daily budget enforcement.
- SQLite (bun:sqlite) state store with WAL + busy_timeout + auto-migrate-on-boot.
- Drizzle ORM for schema authoring; Zod for env validation.
- NPX CLI (`npx @pypes/bot init` + `start`) for one-command setup.
- Distroless-style Bun Docker image, multi-arch (amd64 + arm64).
- GitHub Actions: CI, multi-arch release, plus a template autopilot workflow for users to copy.
- GitHub PAT expiry check (warns on `/healthz` when < 30 days remain).
- Customizable system prompt via `PYPES_SYSTEM_PROMPT_FILE` env var.

### Known limitations
- Tunnel/proxy disconnect causes lost mentions (no Slack Socket Mode in v0.1).
- One workspace, one repo per install.
- Serial worker (concurrency = 1).
- PAT auth only (GitHub App support deferred to v0.2).
- GitHub Actions runner mode only (local Claude subprocess mode deferred to v0.2).
