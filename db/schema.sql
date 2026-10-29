-- Schéma de la base (Neon / PostgreSQL). Créé automatiquement par l'API au premier appel.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,          -- 'template' : réglages par défaut
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weeks (
  id         text PRIMARY KEY,          -- ex. '2026-W44'
  monday     date NOT NULL,
  status     text NOT NULL DEFAULT 'draft',  -- 'draft' | 'validated'
  data       jsonb NOT NULL,            -- { config, schedule }
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
