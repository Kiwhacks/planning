import { compile } from './model'
import { evaluate } from './evaluate'
import { dayOpening, normalizeRequirements, requiredMinutes } from './requirements'
import { SLOT, fmtDuration, toHHMM } from './time'
import { DAY_LABELS, type DayIndex, type Employee, type Evaluation, type Schedule, type Shift, type WeekConfig } from './types'

export interface SuggestionApply {
  /** Modification de la configuration de la semaine. */
  config?: (c: WeekConfig) => void
  /** Créneaux à écrire (verrouillés pour survivre à une régénération). */
  shifts?: { employeeId: string; day: DayIndex; shift: Shift }[]
}

export interface Suggestion {
  id: string
  message: string
  detail?: string
  apply?: SuggestionApply
}

const dayName = (d: DayIndex) => DAY_LABELS[d].toLowerCase()

function score(config: WeekConfig, schedule: Schedule): { errors: number; cost: number } {
  const { model, shifts } = compile(config, schedule)
  const ev = evaluate(model, shifts)
  return { errors: ev.violations.filter((v) => v.severity === 'error').length, cost: ev.cost }
}

function withShift(schedule: Schedule, employeeId: string, day: DayIndex, shift: Shift): Schedule {
  return { ...schedule, [employeeId]: { ...(schedule[employeeId] ?? {}), [day]: shift } }
}

function available(config: WeekConfig, e: Employee, day: DayIndex): boolean {
  if (!e.active || !e.workDays.includes(day)) return false
  if (config.leaves.some((l) => l.employeeId === e.id && l.day === day)) return false
  if (config.pins.some((p) => p.employeeId === e.id && p.day === day && p.mustWork === false)) return false
  return true
}

/** Plages consécutives de créneaux en défaut (minutes). */
function problemRanges(ev: Evaluation): { day: DayIndex; start: number; end: number }[] {
  const out: { day: DayIndex; start: number; end: number }[] = []
  for (const c of ev.coverage) {
    let start: number | null = null
    for (let i = 0; i <= c.slots.length; i++) {
      const s = c.slots[i]
      const problem = !!s && s.problem
      if (problem && start == null) start = s.time
      if (!problem && start != null) {
        out.push({ day: c.day, start, end: (c.slots[i - 1].time ?? start) + SLOT })
        start = null
      }
    }
  }
  return out
}

export function computeSuggestions(config: WeekConfig, schedule: Schedule, ev: Evaluation): Suggestion[] {
  const out: Suggestion[] = []
  const employees = config.employees.filter((e) => e.active)
  const hasSchedule = Object.values(schedule).some((row) => Object.values(row).some(Boolean))
  const closeOf = (d: DayIndex) => dayOpening(normalizeRequirements(config.requirements[d] ?? []))?.close ?? null

  // 1. Budget : les contrats ne couvrent pas les besoins
  const required = config.rules.openDays.reduce((acc: number, d) => {
    const cl = config.cleaning?.[d]
    const cleaners = cl && cl.minutes > 0 ? cl.employeeIds.filter((id) => employees.some((e) => e.id === id && available(config, e, d))).length : 0
    return acc + requiredMinutes(normalizeRequirements(config.requirements[d] ?? [])) + (cl ? cl.minutes * cleaners : 0)
  }, 0)
  const availableMinutes = employees.reduce((acc: number, e) => acc + Math.max(0, e.weeklyMinutes - config.leaves.filter((l) => l.employeeId === e.id).reduce((a, l) => a + l.minutes, 0)), 0)
  const gap = required - availableMinutes
  if (gap > 0) {
    const planReduce = (where: 'first' | 'last') => {
      const changes: { day: DayIndex; start: number; end: number; from: number }[] = []
      for (const d of config.rules.openDays) {
        const reqs = normalizeRequirements(config.requirements[d] ?? [])
        if (reqs.length === 0) continue
        const maxStaff = Math.max(...reqs.map((r) => r.staff))
        if (maxStaff < 2) continue
        const seg = reqs.filter((r) => r.staff === maxStaff).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
        if (seg.end - seg.start < 120) continue
        const start = where === 'last' ? seg.end - 60 : seg.start
        changes.push({ day: d, start, end: start + 60, from: maxStaff })
      }
      return changes
    }
    for (const where of ['last', 'first'] as const) {
      const changes = planReduce(where)
      if (changes.length === 0) continue
      const saved = changes.length * 60
      const sample = changes[0]
      out.push({
        id: `budget-${where}`,
        message: `Réduire d’une personne la ${where === 'last' ? 'dernière' : 'première'} heure du créneau le plus chargé (${sample.from} → ${sample.from - 1} personnes, ex. ${dayName(sample.day)} ${toHHMM(sample.start)}–${toHHMM(sample.end)}) sur ${changes.length} jour${changes.length > 1 ? 's' : ''}.`,
        detail: `Économise ${fmtDuration(saved)} sur un manque de ${fmtDuration(gap)}.`,
        apply: {
          config: (c) => {
            for (const ch of changes) {
              const list = normalizeRequirements(c.requirements[ch.day] ?? [])
              const next: typeof list = []
              for (const r of list) {
                if (r.end <= ch.start || r.start >= ch.end) {
                  next.push(r)
                  continue
                }
                if (r.start < ch.start) next.push({ start: r.start, end: ch.start, staff: r.staff })
                next.push({ start: Math.max(r.start, ch.start), end: Math.min(r.end, ch.end), staff: Math.max(1, r.staff - 1) })
                if (r.end > ch.end) next.push({ start: ch.end, end: r.end, staff: r.staff })
              }
              c.requirements[ch.day] = next
            }
          },
        },
      })
    }
    const perPerson = Math.ceil(gap / Math.max(1, employees.length) / SLOT) * SLOT
    out.push({
      id: 'budget-info',
      message: `Sinon, il faut ${fmtDuration(gap)} d’heures supplémentaires, soit environ ${fmtDuration(perPerson)} par personne, ou augmenter un contrat.`,
    })
  }

  // 2. Ménage sans personne affectée
  for (const d of config.rules.openDays) {
    const cl = config.cleaning?.[d]
    const close = closeOf(d)
    if (!cl || cl.minutes <= 0 || close == null) continue
    const assigned = cl.employeeIds.filter((id) => employees.some((e) => e.id === id && available(config, e, d)))
    if (assigned.length > 0) continue
    const candidates = employees.filter((e) => available(config, e, d) && e.fixedDailyMinutes == null)
    if (candidates.length === 0) continue
    const endOf = (e: Employee) => schedule[e.id]?.[d]?.end ?? config.pins.find((p) => p.employeeId === e.id && p.day === d)?.end ?? 0
    const pick = [...candidates].sort((a, b) => endOf(b) - endOf(a))[0]
    const sh = schedule[pick.id]?.[d]
    out.push({
      id: `clean-${d}`,
      message: `Affecter ${pick.name} au ménage du ${dayName(d)}${sh ? ` (elle finit à ${toHHMM(sh.end)})` : ''}.`,
      detail: `Elle restera jusqu’à ${toHHMM(close + cl.minutes)}.`,
      apply: {
        config: (c) => {
          c.cleaning ??= {}
          const cur = (c.cleaning[d] ??= { minutes: cl.minutes, employeeIds: [] })
          if (!cur.employeeIds.includes(pick.id)) cur.employeeIds.push(pick.id)
        },
        shifts: sh && !sh.locked ? [{ employeeId: pick.id, day: d, shift: { ...sh, end: Math.max(sh.end, close + cl.minutes), locked: true } }] : undefined,
      },
    })
  }

  // 3. Créneaux en défaut : prolonger, avancer, déplacer une pause, ajouter une personne
  if (hasSchedule) {
    const base = score(config, schedule)
    const ranges = problemRanges(ev).slice(0, 8)
    for (const r of ranges) {
      const d = r.day
      type Cand = { message: string; employeeId: string; shift: Shift }
      const cands: Cand[] = []
      for (const e of employees) {
        if (!available(config, e, d)) continue
        const sh = schedule[e.id]?.[d]
        const pin = config.pins.find((p) => p.employeeId === e.id && p.day === d)
        if (sh) {
          if (sh.locked) continue
          if (sh.end <= r.start && r.start - sh.end <= 60 && pin?.end == null) cands.push({ message: `Prolonger ${e.name} jusqu’à ${toHHMM(r.end)} le ${dayName(d)}`, employeeId: e.id, shift: { ...sh, end: r.end } })
          if (sh.start >= r.end && sh.start - r.end <= 60 && pin?.start == null) cands.push({ message: `Faire arriver ${e.name} à ${toHHMM(r.start)} le ${dayName(d)}`, employeeId: e.id, shift: { ...sh, start: r.start } })
          if (sh.breakStart != null && e.breakMinutes > 0 && sh.breakStart < r.end && sh.breakStart + e.breakMinutes > r.start) {
            for (let b = sh.start + SLOT; b + e.breakMinutes < sh.end; b += SLOT) {
              if (b === sh.breakStart) continue
              cands.push({ message: `Décaler la pause de ${e.name} à ${toHHMM(b)} le ${dayName(d)}`, employeeId: e.id, shift: { ...sh, breakStart: b } })
            }
          }
        } else if (pin?.mustWork !== false) {
          const dur = e.fixedDailyMinutes ?? Math.max(e.minDailyMinutes, r.end - r.start)
          const amp = dur + (e.breakMinutes > 0 && (config.rules.breakMinShiftMinutes === 0 || dur > config.rules.breakMinShiftMinutes) ? e.breakMinutes : 0)
          let start = r.start
          let end = start + amp
          if (end > config.rules.dayEnd) {
            end = config.rules.dayEnd
            start = end - amp
          }
          const breakStart = amp > dur ? Math.round((start + end) / 2 / SLOT) * SLOT - Math.round(e.breakMinutes / 2 / SLOT) * SLOT : null
          cands.push({ message: `Ajouter ${e.name} le ${dayName(d)} de ${toHHMM(start)} à ${toHHMM(end)}`, employeeId: e.id, shift: { start, end, breakStart } })
        }
      }
      const scored = cands
        .slice(0, 80)
        .map((c) => ({ c, s: score(config, withShift(schedule, c.employeeId, d, c.shift)) }))
        .filter(({ s }) => s.errors < base.errors && s.cost < base.cost)
        .sort((a, b) => a.s.cost - b.s.cost)
        .slice(0, 2)
      for (const { c, s } of scored) {
        out.push({
          id: `fix-${d}-${r.start}-${c.employeeId}-${c.shift.start}-${c.shift.end}-${c.shift.breakStart}`,
          message: `${c.message} pour couvrir ${toHHMM(r.start)}–${toHHMM(r.end)}.`,
          detail: s.errors === 0 ? 'Résout tous les points bloquants. Le créneau sera verrouillé.' : `Reste ${s.errors} point${s.errors > 1 ? 's' : ''} bloquant${s.errors > 1 ? 's' : ''}. Le créneau sera verrouillé.`,
          apply: { shifts: [{ employeeId: c.employeeId, day: d, shift: { ...c.shift, locked: true } }] },
        })
      }
    }

    // 4. Heures manquantes chez une personne alors qu'une autre fait des heures sup.
    const under = ev.stats.filter((s) => s.deltaMinutes < 0)
    const over = ev.stats.filter((s) => s.deltaMinutes > 0)
    if (under.length > 0 && over.length > 0) {
      const u = under[0]
      const o = over[0]
      const nu = employees.find((e) => e.id === u.employeeId)?.name
      const no = employees.find((e) => e.id === o.employeeId)?.name
      out.push({ id: 'rebalance', message: `${nu} manque de ${fmtDuration(-u.deltaMinutes)} alors que ${no} a ${fmtDuration(o.deltaMinutes)} de plus : cliquez sur « Améliorer l’existant » pour rééquilibrer, ou verrouillez les créneaux à conserver puis régénérez.` })
    }
  }

  return out
}
