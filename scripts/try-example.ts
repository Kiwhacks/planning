import { buildExampleTemplate, buildExampleWeekExtras } from '../src/domain/defaults'
import { compile, toSchedule } from '../src/domain/model'
import { evaluate } from '../src/domain/evaluate'
import { solve } from '../src/domain/solver'
import { fmtDuration, toHHMM } from '../src/domain/time'
import { DAY_SHORT, type WeekConfig } from '../src/domain/types'

const t = buildExampleTemplate()
const extras = buildExampleWeekExtras()
const cfg: WeekConfig = { ...t, ...extras, notes: '' }
const { model, shifts } = compile(cfg, null)
const t0 = Date.now()
const res = solve(model, shifts, { iterations: Number(process.argv[2] ?? 250000), restarts: Number(process.argv[3] ?? 3), seed: 42 })
console.log(`cost=${res.cost} in ${Date.now() - t0}ms`)
const ev = evaluate(model, res.shifts)
const sched = toSchedule(model, res.shifts, null)
for (const emp of cfg.employees) {
  const row = model.days.map((d) => {
    const sh = sched[emp.id]?.[d]
    if (!sh) return `${DAY_SHORT[d]}: —`.padEnd(26)
    return `${DAY_SHORT[d]}: ${toHHMM(sh.start)}-${toHHMM(sh.end)}${sh.breakStart != null ? ` (p ${toHHMM(sh.breakStart)})` : ''}`.padEnd(26)
  })
  const st = ev.stats.find((s) => s.employeeId === emp.id)!
  console.log(emp.name.padEnd(9), row.join(' '), `| ${fmtDuration(st.workedMinutes)} + congés ${fmtDuration(st.leaveMinutes)} / ${fmtDuration(st.contractMinutes)} (${st.deltaMinutes >= 0 ? '+' : ''}${fmtDuration(st.deltaMinutes)})`)
}
for (const c of ev.coverage) console.log(DAY_SHORT[c.day], `requis ${fmtDuration(c.requiredMinutes)} présents ${fmtDuration(c.presentMinutes)} manque ${fmtDuration(c.missingMinutes)} surplus ${fmtDuration(c.extraMinutes)}`)
for (const v of ev.violations) console.log(`[${v.severity}] ${v.message}`)
