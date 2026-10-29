/**
 * Serveur local pour l'API (développement) : `pnpm dev:api`.
 * Lit DATABASE_URL et APP_PASSWORD depuis l'environnement (ou un fichier .env).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import handler from '../api/index'

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
  const vreq = Object.assign(req, { body: raw ? JSON.parse(raw) : undefined, query: {}, cookies: {} })
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
  await handler(vreq as any, vres as any)
}).listen(port, () => console.log(`API locale sur http://localhost:${port}/api (base : ${process.env.DATABASE_URL ? 'configurée' : 'absente'})`))
