import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ensureSchema, getSql, loadTemplate, loadWeeks, saveTemplate, saveWeek, deleteWeek as deleteWeekRow } from './shared'
import type { Week } from '../src/domain/types'

/**
 * API de persistance (réécrite depuis /api/*) :
 *   GET    /api/data            → { version, template, weeks }
 *   PUT    /api/data            → remplace toutes les données (import)
 *   PUT    /api/template        → enregistre les réglages par défaut
 *   PUT    /api/weeks/:id       → enregistre une semaine
 *   DELETE /api/weeks/:id       → supprime une semaine
 * Protégée par l'en-tête `x-app-key` si APP_PASSWORD est défini.
 */

function isWeekBody(b: unknown): b is Week {
  if (!b || typeof b !== 'object') return false
  const w = b as Record<string, unknown>
  return typeof w.id === 'string' && /^\d{4}-W\d{2}$/.test(w.id) && typeof w.monday === 'string' && typeof w.config === 'object' && w.config !== null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('cache-control', 'no-store')
  const sql = getSql()
  if (!sql) {
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

  try {
    await ensureSchema(sql)

    if (path === 'data' && req.method === 'GET') {
      const template = await loadTemplate(sql)
      const weeks: Record<string, Week> = {}
      for (const w of await loadWeeks(sql)) weeks[w.id] = w
      res.status(200).json({ version: 1, template, weeks })
      return
    }

    if (path === 'data' && req.method === 'PUT') {
      const body = req.body as { template?: Week['config']; weeks?: Record<string, Week> }
      if (!body?.template || typeof body.weeks !== 'object') {
        res.status(400).json({ error: 'bad_request' })
        return
      }
      await saveTemplate(sql, body.template)
      await sql`DELETE FROM weeks`
      for (const w of Object.values(body.weeks ?? {})) if (isWeekBody(w)) await saveWeek(sql, w)
      res.status(200).json({ ok: true })
      return
    }

    if (path === 'template' && req.method === 'PUT') {
      const body = req.body
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'bad_request' })
        return
      }
      await saveTemplate(sql, body as Week['config'])
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
        await saveWeek(sql, body)
        res.status(200).json({ ok: true })
        return
      }
      if (req.method === 'DELETE') {
        await deleteWeekRow(sql, id)
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
