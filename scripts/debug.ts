import { buildExampleTemplate, buildExampleWeekExtras } from '../src/domain/defaults'
import { compile, toSchedule } from '../src/domain/model'
import { evaluate } from '../src/domain/evaluate'
import { solve } from '../src/domain/solver'
import { toHHMM } from '../src/domain/time'
import type { WeekConfig } from '../src/domain/types'
const cfg: WeekConfig = { ...buildExampleTemplate(), ...buildExampleWeekExtras(), notes: '' }
const { model, shifts } = compile(cfg, null)
const res = solve(model, shifts, { iterations: 300000, restarts: 4, seed: Number(process.argv[2] ?? 3) })
const sched = toSchedule(model, res.shifts, null)
const ev = evaluate(model, res.shifts)
for (const e of cfg.employees) { const sh = sched[e.id]?.[4]; if (sh) console.log(e.name, toHHMM(sh.start), toHHMM(sh.end), sh.breakStart != null ? 'pause ' + toHHMM(sh.breakStart) : '', 'weekdelta', ev.stats.find(s=>s.employeeId===e.id)!.deltaMinutes) }
console.log(ev.coverage[4].slots.filter(s=>s.required>0).map(s=>`${toHHMM(s.time)}:${s.present}/${s.required}`).join(' '))
