// Accès à la base (partagé par les fonctions API). Les fonctions sont regroupées en un fichier par esbuild (scripts/build-api.ts) vers api/*.js.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { Schedule, TemplateConfig, Week, WeekConfig } from '../src/domain/types'

export type Sql = NeonQueryFunction<false, false>

export interface WeekRow {
  id: string
  monday: string
  status: string
  data: { config: WeekConfig; schedule: Schedule }
  created_at: string
  updated_at: string
}

let schemaReady = false

export function getSql(): Sql | null {
  const url = process.env.DATABASE_URL
  if (!url) return null
  return neon(url)
}

export async function ensureSchema(sql: Sql): Promise<void> {
  if (schemaReady) return
  await sql`CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
  await sql`CREATE TABLE IF NOT EXISTS weeks (id text PRIMARY KEY, monday date NOT NULL, status text NOT NULL DEFAULT 'draft', data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`
  schemaReady = true
}

export function rowToWeek(r: WeekRow): Week {
  return {
    id: r.id,
    monday: typeof r.monday === 'string' ? r.monday.slice(0, 10) : new Date(r.monday).toISOString().slice(0, 10),
    status: r.status === 'validated' ? 'validated' : 'draft',
    config: r.data.config,
    schedule: r.data.schedule ?? {},
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

export async function loadTemplate(sql: Sql): Promise<TemplateConfig | null> {
  const rows = (await sql`SELECT data FROM app_settings WHERE key = 'template'`) as { data: TemplateConfig }[]
  return rows[0]?.data ?? null
}

export async function saveTemplate(sql: Sql, template: TemplateConfig): Promise<void> {
  await sql`INSERT INTO app_settings (key, data, updated_at) VALUES ('template', ${JSON.stringify(template)}::jsonb, now())
            ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
}

export async function loadWeeks(sql: Sql): Promise<Week[]> {
  const rows = (await sql`SELECT * FROM weeks ORDER BY monday DESC`) as WeekRow[]
  return rows.map(rowToWeek)
}

export async function loadWeek(sql: Sql, id: string): Promise<Week | null> {
  const rows = (await sql`SELECT * FROM weeks WHERE id = ${id}`) as WeekRow[]
  return rows[0] ? rowToWeek(rows[0]) : null
}

export async function saveWeek(sql: Sql, w: Week): Promise<void> {
  const data = JSON.stringify({ config: w.config, schedule: w.schedule ?? {} })
  await sql`INSERT INTO weeks (id, monday, status, data, created_at, updated_at)
            VALUES (${w.id}, ${w.monday}, ${w.status ?? 'draft'}, ${data}::jsonb, ${w.createdAt ?? new Date().toISOString()}, ${w.updatedAt ?? new Date().toISOString()})
            ON CONFLICT (id) DO UPDATE SET monday = EXCLUDED.monday, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`
}

export async function deleteWeek(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM weeks WHERE id = ${id}`
}
