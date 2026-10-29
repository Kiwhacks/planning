import { compile } from './model'
import { evaluate } from './evaluate'
import { computeSuggestions } from './suggestions'
import { dayOpening, effectiveDayEnd, normalizeRequirements } from './requirements'
import { fmtDuration, toHHMM } from './time'
import { DAY_LABELS, type DayIndex, type Week } from './types'

/** Données structurées d'une semaine, destinées à l'affichage (MCP, exports). */
export interface WeekReport {
  week: { id: string; monday: string; label: string; status: 'draft' | 'validated'; notes: string }
  appUrl?: string
  dayStart: number
  dayEnd: number
  hasSchedule: boolean
  employees: { id: string; name: string; color: string; role: string; avatar?: string }[]
  days: {
    day: DayIndex
    label: string
    date: string
    open: number | null
    close: number | null
    cleaningEnd: number | null
    requirements: { start: number; end: number; staff: number }[]
    shifts: {
      employeeId: string
      employee: string
      color: string
      start: number
      end: number
      breakStart: number | null
      breakEnd: number | null
      worked: number
      cleaning: boolean
      locked: boolean
      text: string
    }[]
    absences: { employeeId: string; employee: string; label: string; minutes: number }[]
    coverage: { time: number; required: number; present: number; cleaning: boolean; problem: boolean }[]
    requiredMinutes: number
    presentMinutes: number
    missingMinutes: number
  }[]
  totals: { employeeId: string; employee: string; color: string; worked: number; cleaning: number; leave: number; contract: number; delta: number; perDay: Partial<Record<DayIndex, number>> }[]
  violations: { severity: 'error' | 'warning' | 'info'; message: string }[]
  suggestions: { message: string; detail?: string }[]
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function frDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function weekLabelOf(monday: string): string {
  const friday = addDays(monday, 4)
  const d = new Date(`${monday}T00:00:00Z`)
  // numéro de semaine ISO
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `Semaine ${weekNo} · du ${frDate(monday)} au ${frDate(friday)} ${d.getUTCFullYear()}`
}

export function buildWeekReport(week: Week, appUrl?: string): WeekReport {
  const { config, schedule } = week
  const { model, shifts } = compile(config, schedule)
  const ev = evaluate(model, shifts)
  const employees = config.employees.filter((e) => e.active)
  const hasSchedule = Object.values(schedule).some((row) => Object.values(row).some(Boolean))
  const suggestions = computeSuggestions(config, schedule, ev)

  const days = config.rules.openDays.map((d) => {
    const reqs = normalizeRequirements(config.requirements[d] ?? [])
    const opening = dayOpening(reqs)
    const cl = config.cleaning?.[d]
    const cleaningEnd = opening && cl && cl.minutes > 0 && cl.employeeIds.length > 0 ? opening.close + cl.minutes : null
    const cov = ev.coverage.find((c) => c.day === d)
    const dayShifts = employees
      .map((e) => {
        const sh = schedule[e.id]?.[d]
        if (!sh) return null
        const worked = sh.end - sh.start - (sh.breakStart != null ? e.breakMinutes : 0)
        const cleaning = !!cl?.employeeIds.includes(e.id) && opening != null && sh.end > opening.close
        const text = `${toHHMM(sh.start)}–${toHHMM(sh.end)}${sh.breakStart != null && e.breakMinutes > 0 ? ` (pause ${toHHMM(sh.breakStart)}–${toHHMM(sh.breakStart + e.breakMinutes)})` : ''}${cleaning ? ' + ménage' : ''}`
        return {
          employeeId: e.id,
          employee: e.name,
          color: e.color,
          start: sh.start,
          end: sh.end,
          breakStart: sh.breakStart,
          breakEnd: sh.breakStart != null ? sh.breakStart + e.breakMinutes : null,
          worked,
          cleaning,
          locked: !!sh.locked,
          text,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => a.start - b.start || a.end - b.end)
    const absences = config.leaves
      .filter((l) => l.day === d)
      .map((l) => ({ employeeId: l.employeeId, employee: employees.find((e) => e.id === l.employeeId)?.name ?? '?', label: l.label || 'Congé', minutes: l.minutes }))
    return {
      day: d,
      label: DAY_LABELS[d],
      date: addDays(week.monday, d),
      open: opening?.open ?? null,
      close: opening?.close ?? null,
      cleaningEnd,
      requirements: reqs,
      shifts: dayShifts,
      absences,
      coverage: (cov?.slots ?? []).map((s) => ({ time: s.time, required: s.required, present: s.present, cleaning: s.cleaning, problem: s.problem })),
      requiredMinutes: cov?.requiredMinutes ?? 0,
      presentMinutes: cov?.presentMinutes ?? 0,
      missingMinutes: cov?.missingMinutes ?? 0,
    }
  })

  const totals = ev.stats.map((s) => {
    const e = employees.find((x) => x.id === s.employeeId)
    return { employeeId: s.employeeId, employee: e?.name ?? '?', color: e?.color ?? '#888', worked: s.workedMinutes, cleaning: s.cleaningMinutes, leave: s.leaveMinutes, contract: s.contractMinutes, delta: s.deltaMinutes, perDay: s.perDay }
  })

  return {
    week: { id: week.id, monday: week.monday, label: weekLabelOf(week.monday), status: week.status, notes: week.config.notes },
    appUrl,
    dayStart: config.rules.dayStart,
    dayEnd: effectiveDayEnd(config),
    hasSchedule,
    employees: employees.map((e) => ({ id: e.id, name: e.name, color: e.color, role: e.role, avatar: e.avatar })),
    days,
    totals,
    violations: ev.violations.map((v) => ({ severity: v.severity, message: v.message })),
    suggestions: suggestions.map((s) => ({ message: s.message, detail: s.detail })),
  }
}

/** Rendu Markdown lisible (pour les assistants sans affichage riche). */
export function weekReportToMarkdown(r: WeekReport): string {
  const lines: string[] = []
  lines.push(`## ${r.week.label} — ${r.week.status === 'validated' ? 'validée' : 'brouillon'}`)
  if (!r.hasSchedule) lines.push('', '_Aucun planning généré pour cette semaine._')
  for (const d of r.days) {
    lines.push('', `### ${d.label} ${d.date}`)
    if (d.open != null && d.close != null) {
      const req = d.requirements.map((q) => `${toHHMM(q.start)}–${toHHMM(q.end)} : ${q.staff}`).join(' · ')
      lines.push(`Besoins : ${req}${d.cleaningEnd ? ` · ménage jusqu’à ${toHHMM(d.cleaningEnd)}` : ''}`)
    }
    if (d.shifts.length > 0) {
      lines.push('', '| Personne | Horaires | Temps de travail |', '|---|---|---|')
      for (const s of d.shifts) lines.push(`| ${s.employee}${s.locked ? ' 🔒' : ''} | ${s.text} | ${fmtDuration(s.worked)} |`)
    }
    for (const a of d.absences) lines.push(`- ${a.employee} : ${a.label} (${fmtDuration(a.minutes)} comptées)`)
    if (d.missingMinutes > 0) lines.push(`⚠️ Il manque ${fmtDuration(d.missingMinutes)} de présence ce jour.`)
  }
  const anyCleaning = r.totals.some((t) => t.cleaning > 0)
  lines.push('', '### Récapitulatif', '', `| Personne | Travaillé |${anyCleaning ? ' dont ménage |' : ''} Congés | Contrat | Écart |`, `|---|---|${anyCleaning ? '---|' : ''}---|---|---|`)
  for (const t of r.totals) lines.push(`| ${t.employee} | ${fmtDuration(t.worked)} |${anyCleaning ? ` ${t.cleaning ? fmtDuration(t.cleaning) : '—'} |` : ''} ${t.leave ? fmtDuration(t.leave) : '—'} | ${fmtDuration(t.contract)} | ${t.delta > 0 ? '+' : ''}${fmtDuration(t.delta)} |`)
  const errors = r.violations.filter((v) => v.severity === 'error')
  const warnings = r.violations.filter((v) => v.severity === 'warning')
  if (errors.length || warnings.length) {
    lines.push('', '### Points de vigilance')
    for (const v of errors) lines.push(`- ❌ ${v.message}`)
    for (const v of warnings) lines.push(`- ⚠️ ${v.message}`)
  }
  if (r.suggestions.length) {
    lines.push('', '### Suggestions')
    for (const s of r.suggestions) lines.push(`- 💡 ${s.message}${s.detail ? ` _(${s.detail})_` : ''}`)
  }
  if (r.appUrl) lines.push('', `[Ouvrir dans l’application](${r.appUrl})`)
  return lines.join('\n')
}
