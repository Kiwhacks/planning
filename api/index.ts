import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

/**
 * API unique (réécrite depuis /api/*) :
 *   GET    /api/data            → { version, template, weeks }
 *   PUT    /api/data            → remplace toutes les données (import)
 *   PUT    /api/template        → enregistre les réglages par défaut
 *   PUT    /api/weeks/:id       → enregistre une semaine
 *   DELETE /api/weeks/:id       → supprime une semaine
 * Protégée par l'en-tête `x-app-key` si APP_PASSWORD est défini.
 */

type Sql = NeonQueryFunction<false, false>

interface WeekRow {
  id: string
  monday: string
  status: string
  data: { config: unknown; schedule: unknown }
  created_at: string
  updated_at: string
}

interface WeekBody {
  id: string
  monday: string
  status: string
  config: unknown
  schedule: unknown
  createdAt?: string
  updatedAt?: string
}

let schemaReady = false

async function ensureSchema(sql: Sql): Promise<void> {
  if (schemaReady) return
  await sql`CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
  await sql`CREATE TABLE IF NOT EXISTS weeks (id text PRIMARY KEY, monday date NOT NULL, status text NOT NULL DEFAULT 'draft', data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`
  schemaReady = true
}

function toWeek(r: WeekRow) {
  return {
    id: r.id,
    monday: typeof r.monday === 'string' ? r.monday.slice(0, 10) : new Date(r.monday).toISOString().slice(0, 10),
    status: r.status,
    config: r.data.config,
    schedule: r.data.schedule ?? {},
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }
}

function isWeekBody(b: unknown): b is WeekBody {
  if (!b || typeof b !== 'object') return false
  const w = b as Record<string, unknown>
  return typeof w.id === 'string' && /^\d{4}-W\d{2}$/.test(w.id) && typeof w.monday === 'string' && typeof w.config === 'object' && w.config !== null
}

async function upsertWeek(sql: Sql, w: WeekBody): Promise<void> {
  const data = JSON.stringify({ config: w.config, schedule: w.schedule ?? {} })
  const created = w.createdAt ?? new Date().toISOString()
  const updated = w.updatedAt ?? new Date().toISOString()
  await sql`INSERT INTO weeks (id, monday, status, data, created_at, updated_at)
            VALUES (${w.id}, ${w.monday}, ${w.status ?? 'draft'}, ${data}::jsonb, ${created}, ${updated})
            ON CONFLICT (id) DO UPDATE SET monday = EXCLUDED.monday, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('cache-control', 'no-store')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    res.status(503).json({ error: 'no_database', message: 'DATABASE_URL n’est pas configurée.' })
    return
  }
  const password = process.env.APP_PASSWORD
  if (password) {
    const key = req.headers['x-app-key']
    if (key !== password) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')
  const sql = neon(databaseUrl)

  try {
    await ensureSchema(sql)

    if (path === 'data' && req.method === 'GET') {
      const settings = (await sql`SELECT data FROM app_settings WHERE key = 'template'`) as { data: unknown }[]
      const rows = (await sql`SELECT * FROM weeks ORDER BY monday DESC`) as WeekRow[]
      const weeks: Record<string, unknown> = {}
      for (const r of rows) weeks[r.id] = toWeek(r)
      res.status(200).json({ version: 1, template: settings[0]?.data ?? null, weeks })
      return
    }

    if (path === 'data' && req.method === 'PUT') {
      const body = req.body as { template?: unknown; weeks?: Record<string, WeekBody> }
      if (!body?.template || typeof body.weeks !== 'object') {
        res.status(400).json({ error: 'bad_request' })
        return
      }
      await sql`INSERT INTO app_settings (key, data, updated_at) VALUES ('template', ${JSON.stringify(body.template)}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
      await sql`DELETE FROM weeks`
      for (const w of Object.values(body.weeks ?? {})) if (isWeekBody(w)) await upsertWeek(sql, w)
      res.status(200).json({ ok: true })
      return
    }

    if (path === 'template' && req.method === 'PUT') {
      const body = req.body
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'bad_request' })
        return
      }
      await sql`INSERT INTO app_settings (key, data, updated_at) VALUES ('template', ${JSON.stringify(body)}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
      res.status(200).json({ ok: true })
      return
    }

    const m = /^weeks\/(\d{4}-W\d{2})$/.exec(path)
    if (m) {
      const id = m[1]
      if (req.method === 'PUT') {
        const body = req.body
        if (!isWeekBody(body) || body.id !== id) {
          res.status(400).json({ error: 'bad_request' })
          return
        }
        await upsertWeek(sql, body)
        res.status(200).json({ ok: true })
        return
      }
      if (req.method === 'DELETE') {
        await sql`DELETE FROM weeks WHERE id = ${id}`
        res.status(200).json({ ok: true })
        return
      }
    }

    res.status(404).json({ error: 'not_found' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server_error', message: err instanceof Error ? err.message : String(err) })
  }
}
