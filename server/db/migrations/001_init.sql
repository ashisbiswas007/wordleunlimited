-- Wordle Unlimited — initial schema.
-- Player progress lives in Google Drive appData, so there is deliberately no
-- users table here. This database holds site configuration, topic content and
-- aggregate match history only.

CREATE TABLE IF NOT EXISTS admin_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Topic packs power Topic mode and the "popular topics" SEO grid.
CREATE TABLE IF NOT EXISTS topics (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT        NOT NULL,
  category    TEXT        NOT NULL DEFAULT 'general',
  region      TEXT        NOT NULL DEFAULT 'en',
  blurb       TEXT,
  icon        TEXT,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  featured    BOOLEAN     NOT NULL DEFAULT FALSE,
  play_count  BIGINT      NOT NULL DEFAULT 0,
  sort_order  INTEGER     NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topics_region_enabled_idx
  ON topics (region, enabled, sort_order);
CREATE INDEX IF NOT EXISTS topics_category_idx
  ON topics (category) WHERE enabled;
CREATE INDEX IF NOT EXISTS topics_popular_idx
  ON topics (play_count DESC) WHERE enabled;

-- One guessable answer within a topic, e.g. "PETER" in topic "family-guy".
CREATE TABLE IF NOT EXISTS topic_items (
  id         SERIAL PRIMARY KEY,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  answer     TEXT    NOT NULL,
  length     SMALLINT NOT NULL,
  clue       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  UNIQUE (topic_id, answer)
);

CREATE INDEX IF NOT EXISTS topic_items_topic_idx ON topic_items (topic_id, sort_order);
CREATE INDEX IF NOT EXISTS topic_items_length_idx ON topic_items (topic_id, length);

-- Finished multiplayer matches, kept for the recent-winners strip and admin stats.
CREATE TABLE IF NOT EXISTS match_results (
  id           BIGSERIAL PRIMARY KEY,
  room_code    TEXT        NOT NULL,
  room_kind    TEXT        NOT NULL,            -- 'open' | 'custom'
  format       TEXT        NOT NULL,            -- 'race' | 'timed'
  region       TEXT        NOT NULL DEFAULT 'en',
  topic_slug   TEXT,
  player_count INTEGER     NOT NULL DEFAULT 0,
  winner_name  TEXT,
  winner_score INTEGER,
  duration_s   INTEGER,
  standings    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  finished_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_results_finished_idx ON match_results (finished_at DESC);
CREATE INDEX IF NOT EXISTS match_results_topic_idx    ON match_results (topic_slug, finished_at DESC);

-- Admin action trail.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  detail     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- Nicknames blocked from multiplayer.
CREATE TABLE IF NOT EXISTS blocked_names (
  name       TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
