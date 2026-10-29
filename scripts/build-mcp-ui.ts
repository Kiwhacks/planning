/** Construit la vue MCP (HTML autonome) et l'écrit dans api/_ui.generated.ts. */
import { build } from 'esbuild'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/mcp-ui/view.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  logLevel: 'warning',
})
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const animals: Record<string, string> = {}
for (const f of readdirSync('public/animals')) if (f.endsWith('.svg')) animals[f.replace(/\.svg$/, '')] = readFileSync(`public/animals/${f}`, 'utf8').replace(/<\/script/gi, '<\\/script')
const html = readFileSync('src/mcp-ui/template.html', 'utf8').replace('/*__ANIMALS__*/', () => `window.__ANIMALS=${JSON.stringify(animals)};`).replace('/*__SCRIPT__*/', () => js)
const out = `// Généré par scripts/build-mcp-ui.ts — ne pas modifier à la main.\nexport const WEEK_UI_HTML = ${JSON.stringify(html)}\n`
writeFileSync('api/_ui.generated.ts', out)
console.log(`api/_ui.generated.ts : ${(html.length / 1024).toFixed(0)} ko`)
