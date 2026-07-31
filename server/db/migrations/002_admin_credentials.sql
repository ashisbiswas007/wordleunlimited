-- Admin credentials live in their own table, deliberately NOT in admin_settings.
-- Settings are read wholesale and returned by the admin API, so a password hash
-- stored there would be served to the browser.

CREATE TABLE IF NOT EXISTS admin_credentials (
  username      TEXT PRIMARY KEY,
  password_hash TEXT        NOT NULL,
  must_change   BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
