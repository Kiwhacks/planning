/**
 * Regroupe chaque fonction serveur (server/*.ts) en un seul fichier JavaScript autonome dans api/,
 * tel que Vercel le déploie. Les sorties api/index.js et api/mcp.js sont versionnées.
 */
import { build } from 'esbuild'
import { statSync } from 'node:fs'

const entries: Record<string, string> = { index: 'server/data.ts', mcp: 'server/mcp.ts' }
for (const [name, entry] of Object.entries(entries)) {
  await build({
    entryPoints: [entry],
    outfile: `api/${name}.js`,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    legalComments: 'none',
    logLevel: 'warning',
  })
  console.log(`api/${name}.js : ${(statSync(`api/${name}.js`).size / 1024).toFixed(0)} ko`)
}
