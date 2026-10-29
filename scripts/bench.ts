import { buildExampleTemplate, buildExampleWeekExtras } from '../src/domain/defaults'
import { compile } from '../src/domain/model'
import { evaluate } from '../src/domain/evaluate'
import { solve } from '../src/domain/solver'
import type { WeekConfig } from '../src/domain/types'

const cfg: WeekConfig = { ...buildExampleTemplate(), ...buildExampleWeekExtras(), notes: '' }
const { model, shifts } = compile(cfg, null)
const its = Number(process.argv[2] ?? 300000)
const restarts = Number(process.argv[3] ?? 4)
for (let seed = 1; seed <= 12; seed++) {
  const t0 = Date.now()
  const res = solve(model, shifts, { iterations: its, restarts, seed })
  const ev = evaluate(model, res.shifts)
  const errors = ev.violations.filter((v) => v.severity === 'error').map((v) => v.message)
  const ot = ev.stats.reduce((a, s) => a + Math.max(0, s.deltaMinutes), 0)
  console.log(`seed ${seed}: cost=${Math.round(res.cost)} errors=${errors.length} overtime=${ot}min ${Date.now() - t0}ms`, errors.join(' | '))
}
