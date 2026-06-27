-- pypes-bot initial schema
-- Hand-written (not Drizzle-generated) to include CHECK constraints + index DESC ordering
-- + seed row, which drizzle-kit doesn't emit for SQLite yet.

CREATE TABLE IF NOT EXISTS slack_mentions (
  id                     TEXT    PRIMARY KEY,
  channel                TEXT    NOT NULL,
  ts                     TEXT    NOT NULL,
  user_id                TEXT    NOT NULL,
  text                   TEXT    NOT NULL,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  processed_at           INTEGER,
  claimed_at             INTEGER,
  claimed_by             TEXT,
  started_at             INTEGER,
  finished_at            INTEGER,
  status                 TEXT    NOT NULL DEFAULT 'pending',
  intent                 TEXT,
  clarification_question TEXT,
  mode                   TEXT,
  response_slack_ts      TEXT,
  cost_usd               REAL    DEFAULT 0,
  exit_code              INTEGER,
  pr_url                 TEXT,
  error_text             TEXT,
  CHECK (status IN ('pending','running','success','failed','cancelled','dropped_allowlist','clarification_needed')),
  CHECK (intent IS NULL OR intent IN ('clear','ambiguous','rejected')),
  CHECK (mode IS NULL OR mode IN ('code','ops_preview','ops_execute')),
  CHECK (processed_at IS NULL OR status != 'pending')
);

CREATE INDEX IF NOT EXISTS idx_slack_mentions_processed_at ON slack_mentions(processed_at);
CREATE INDEX IF NOT EXISTS idx_slack_mentions_created_at   ON slack_mentions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_mentions_finished_at  ON slack_mentions(finished_at);

CREATE TABLE IF NOT EXISTS pypes_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  kill_switch   INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0,1)),
  paused_reason TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_by    TEXT
);

INSERT OR IGNORE INTO pypes_config (id, kill_switch, updated_by)
VALUES (1, 0, 'system');
