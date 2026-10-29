import { SLOT } from './time'
import type { Child, CleaningDay, DayIndex, RatioStep, Requirement, Rules } from './types'

/** Nettoie une liste de besoins : tri, suppression des plages vides. */
export function normalizeRequirements(reqs: Requirement[]): Requirement[] {
  return reqs
    .filter((r) => r.end > r.start && r.staff > 0)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start)
}

/** Nombre de personnes requis à un instant donné (0 = fermé). */
export function requiredAt(reqs: Requirement[], minute: number): number {
  let max = 0
  for (const r of reqs) if (minute >= r.start && minute < r.end && r.staff > max) max = r.staff
  return max
}

export function staffForChildren(ratio: RatioStep[], children: number): number {
  if (children <= 0) return 0
  let staff = 0
  for (const step of ratio) if (children >= step.minChildren && step.staff > staff) staff = step.staff
  return Math.max(staff, 1)
}

/** Calcule les besoins d'un jour à partir des présences des enfants et du taux d'encadrement. */
export function requirementsFromChildren(children: Child[], day: DayIndex, rules: Rules): Requirement[] {
  const out: Requirement[] = []
  let current: Requirement | null = null
  for (let t = rules.dayStart; t < rules.dayEnd; t += SLOT) {
    let count = 0
    for (const c of children) {
      const a = c.attendance[day]
      if (a && t >= a.start && t < a.end) count++
    }
    const staff = staffForChildren(rules.ratio, count)
    if (current && current.staff === staff) {
      current.end = t + SLOT
    } else {
      if (current && current.staff > 0) out.push(current)
      current = { start: t, end: t + SLOT, staff }
    }
  }
  if (current && current.staff > 0) out.push(current)
  return out
}

/** Heures-personnes requises sur un jour (en minutes). */
export function requiredMinutes(reqs: Requirement[]): number {
  return reqs.reduce((acc, r) => acc + (r.end - r.start) * r.staff, 0)
}

/** Fin de journée effective : au moins la fin réglée, étendue jusqu'à la fin du ménage le plus tardif. */
export function effectiveDayEnd(cfg: { rules: Rules; requirements: Partial<Record<DayIndex, Requirement[]>>; cleaning?: Partial<Record<DayIndex, CleaningDay>> }): number {
  let end = cfg.rules.dayEnd
  for (const d of cfg.rules.openDays) {
    const opening = dayOpening(normalizeRequirements(cfg.requirements[d] ?? []))
    const cl = cfg.cleaning?.[d]
    if (opening && cl && cl.minutes > 0) end = Math.max(end, opening.close + cl.minutes)
  }
  return Math.ceil(end / SLOT) * SLOT
}

export function dayOpening(reqs: Requirement[]): { open: number; close: number } | null {
  if (reqs.length === 0) return null
  return { open: Math.min(...reqs.map((r) => r.start)), close: Math.max(...reqs.map((r) => r.end)) }
}
