import { buildExampleTemplate, buildExampleWeekExtras } from '../src/domain/defaults'
import { compile } from '../src/domain/model'
import { evaluate } from '../src/domain/evaluate'
import { solve } from '../src/domain/solver'
import type { WeekConfig } from '../src/domain/types'

const cfg: WeekConfig = { ...buildExampleTemplate(), ...buildExampleWeekExtras(), notes: '' }
cfg.cleaning = { 0: { minutes: 30, employeeIds: ['emp_fanny'] }, 1: { minutes: 30, employeeIds: ['emp_isabelle'] }, 2: { minutes: 30, employeeIds: ['emp_elsa'] }, 3: { minutes: 30, employeeIds: ['emp_isabelle'] }, 4: { minutes: 30, employeeIds: ['emp_fanny', 'emp_lucie'] } }
const { model, shifts } = compile(cfg, null)
for (let seed = 1; seed <= 4; seed++) {
  const res = solve(model, shifts, { iterations: 300000, restarts: 6, seed })
  const ev = evaluate(model, res.shifts)
  const errors = ev.violations.filter((v) => v.severity === 'error').map((v) => v.message)
  console.log(`seed ${seed}: errors=${errors.length} warnings=${ev.violations.filter((v) => v.severity === 'warning').length}`, errors.join(' | '))
}
