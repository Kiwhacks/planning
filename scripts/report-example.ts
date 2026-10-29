/** Produit un rapport JSON (données d'exemple) pour tester la vue MCP : pnpm exec tsx scripts/report-example.ts > rapport.json */
import { buildExampleTemplate, buildExampleWeekExtras } from '../src/domain/defaults'
import { compile, toSchedule } from '../src/domain/model'
import { solve } from '../src/domain/solver'
import { buildWeekReport } from '../src/domain/report'
import type { Week, WeekConfig } from '../src/domain/types'

const cfg: WeekConfig = { ...buildExampleTemplate(), ...buildExampleWeekExtras(), notes: '' }
cfg.cleaning![0] = { minutes: 30, employeeIds: ['emp_fanny'] }
const week: Week = { id: '2026-W44', monday: '2026-10-26', config: cfg, schedule: {}, status: 'draft', createdAt: '', updatedAt: '' }
const { model, shifts } = compile(cfg, null)
const res = solve(model, shifts, { iterations: 150000, restarts: 3, seed: 7 })
week.schedule = toSchedule(model, res.shifts, null)
console.log(JSON.stringify(buildWeekReport(week, 'https://planning-creche-trezoclair.vercel.app')))
