/** Test du flux de confirmation sur une semaine jetable (2030-W10) : `pnpm dev:api` puis `tsx scripts/mcp-confirm-test.ts`. */
import { readFileSync } from 'node:fs'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* pas de .env */ }

const base = process.env.MCP_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}/api/mcp`
const token = process.env.MCP_TOKEN || process.env.APP_PASSWORD || ''
const client = new Client({ name: 'confirm-test', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/${encodeURIComponent(token)}`)))
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args })
  const t = (r.content as { text?: string }[]).map((c) => c.text ?? '').join('\n')
  console.log(`\n### ${name}${r.isError ? ' (ERREUR)' : ''}\n${t.slice(0, 500)}${t.length > 500 ? '\n…' : ''}`)
  return t
}
const WEEK = '2030-03-04'
const id = '2030-W10'
console.log('outils :', (await client.listTools()).tools.map((t) => t.name).join(', '))
let t = await call('create_week', { date: WEEK })
if (!t.includes('Aperçu')) throw new Error('aperçu attendu')
t = await call('create_week', { date: WEEK, confirm: true })
if (!t.includes('✅')) throw new Error('création attendue')
await call('upsert_employee', { week: id, employee: 'Claude', fields: { weekly_hours: '20h', can_be_alone: false, avatar: 'renard' } })
t = await call('upsert_employee', { week: id, employee: 'Claude', fields: { weekly_hours: '20h', can_be_alone: false, avatar: 'renard' }, confirm: true })
if (!t.includes('20h') || !t.includes('Renard')) throw new Error('modification employée attendue')
await call('upsert_employee', { week: id, employee: 'Nadia', create: true, fields: { weekly_hours: '28h', role: 'apprentie', work_days: ['lundi', 'mardi', 'jeudi'] }, confirm: true })
await call('upsert_child', { week: id, child: 'Léo', create: true, fields: { referent: 'Fanny', relais: 'Elsa', attendance: { lundi: '08:30-17:00', mardi: null } }, confirm: true })
await call('update_rules', { week: id, fields: { day_end: '19:30', min_pros: 2, overtime_strictness: 3 }, confirm: true })
await call('set_notes', { week: id, notes: 'Semaine de test MCP', confirm: true })
await call('get_children', { week: id })
await call('set_leave', { week: id, employee: 'Nadia', day: 'lundi', hours: '7h', label: 'Formation' })
t = await call('delete_employee', { week: id, employee: 'Nadia', confirm: true })
if (!t.includes('retirée')) throw new Error('suppression employée attendue')
t = await call('delete_week', { week: id })
if (!t.includes('Aperçu')) throw new Error('aperçu suppression attendu')
t = await call('delete_week', { week: id, confirm: true })
if (!t.includes('supprimée')) throw new Error('suppression semaine attendue')
await client.close()
console.log('\nOK : flux de confirmation vérifié, semaine jetable supprimée.')
