-- Raw SQL migration for the logs table.
CREATE TABLE logs (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL,
  message     TEXT,
  payload     JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);
