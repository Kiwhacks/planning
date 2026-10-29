/** Test du serveur MCP : `pnpm dev:api` dans un terminal, puis `pnpm mcp:test`. */
import { readFileSync } from 'node:fs'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* pas de .env */
}

const base = process.env.MCP_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}/api/mcp`
const token = process.env.MCP_TOKEN || process.env.APP_PASSWORD || ''
const url = new URL(token ? `${base}/${encodeURIComponent(token)}` : base)

const client = new Client({ name: 'planning-creche-test', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(url)
await client.connect(transport)

const tools = await client.listTools()
console.log('Outils :', tools.tools.map((t) => `${t.name}${t._meta?.ui ? ' (UI)' : ''}`).join(', '))

const resources = await client.listResources()
console.log('Ressources :', resources.resources.map((r) => `${r.uri} [${r.mimeType}]`).join(', '))

const weeks = await client.callTool({ name: 'list_weeks', arguments: {} })
console.log('\n--- list_weeks ---\n' + (weeks.content as { type: string; text?: string }[]).map((c) => c.text).join('\n'))

const first = (weeks.structuredContent as { weeks?: { id: string }[] } | undefined)?.weeks?.[0]
const target = process.argv[2] ?? first?.id
if (target) {
  const week = await client.callTool({ name: 'get_week', arguments: { week: target } })
  const text = (week.content as { type: string; text?: string }[]).map((c) => c.text).join('\n')
  console.log(`\n--- get_week ${target} (${text.length} caractères de Markdown) ---\n` + text.slice(0, 1200) + '\n…')
  const sc = week.structuredContent as { days?: unknown[]; totals?: unknown[] } | undefined
  console.log('structuredContent :', sc ? `${sc.days?.length} jours, ${sc.totals?.length} personnes` : 'absent')
  const team = await client.callTool({ name: 'get_team', arguments: { week: target } })
  console.log('\n--- get_team ---\n' + (team.content as { type: string; text?: string }[]).map((c) => c.text).join('\n').slice(0, 800))
  const bad = await client.callTool({ name: 'set_shift', arguments: { week: target, employee: 'Inconnue', day: 'lundi', start: '08:00', end: '16:00' } })
  console.log('\n--- set_shift (erreur attendue) ---', bad.isError, (bad.content as { text?: string }[])[0]?.text)
}

const res = await client.readResource({ uri: 'ui://planning-creche/week.html' })
const html = (res.contents[0] as { text?: string }).text ?? ''
console.log(`\nVue MCP App : ${(html.length / 1024).toFixed(0)} ko, mimeType ${(res.contents[0] as { mimeType?: string }).mimeType}`)

await client.close()
