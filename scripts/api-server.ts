/**
 * Serveur local pour l'API (développement) : `pnpm dev:api`.
 * Lit DATABASE_URL et APP_PASSWORD depuis l'environnement (ou un fichier .env).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
// USE_BUNDLE=1 : utilise les fonctions regroupées api/*.js (comme sur Vercel) au lieu des sources server/*.ts
const bundle = !!process.env.USE_BUNDLE
const handler = (bundle ? await import('../api/index.js') : await import('../server/data')).default
const mcpHandler = (bundle ? await import('../api/mcp.js') : await import('../server/mcp')).default

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* pas de .env */
}

const port = Number(process.env.API_PORT ?? 3001)

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query: Record<string, string> = {}
  url.searchParams.forEach((v, k) => (query[k] = v))
  // /api/mcp/<token> → /api/mcp?token=<token> (comme la réécriture Vercel)
  const mcpMatch = /^\/api\/mcp\/([^/]+)$/.exec(url.pathname)
  if (mcpMatch) {
    query.token = decodeURIComponent(mcpMatch[1])
    req.url = `/api/mcp?${new URLSearchParams(query).toString()}`
  }
  const isMcp = url.pathname === '/api/mcp' || !!mcpMatch
  const vreq = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined, query, cookies: {} })
  const vres = Object.assign(res, {
    status(code: number) {
      res.statusCode = code
      return vres
    },
    json(body: unknown) {
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
      return vres
    },
    send(body: unknown) {
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
      return vres
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (isMcp ? mcpHandler : handler)(vreq as any, vres as any)
}).listen(port, () => console.log(`API locale sur http://localhost:${port}/api (base : ${process.env.DATABASE_URL ? 'configurée' : 'absente'})`))
