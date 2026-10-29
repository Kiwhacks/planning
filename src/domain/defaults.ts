import { h } from './time'
import { ADULT_ANIMALS, BABY_ANIMALS, pickAnimal } from './animals'
import type { Child, CleaningDay, Employee, Leave, Pin, Requirement, Rules, TemplateConfig, WeekConfig, DayIndex } from './types'

export const EMPLOYEE_COLORS = [
  '#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669',
]

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

export const DEFAULT_RULES: Rules = {
  dayStart: h(6, 30),
  dayEnd: h(19, 0),
  openDays: [0, 1, 2, 3, 4],
  ratio: [
    { minChildren: 1, staff: 1 },
    { minChildren: 4, staff: 2 },
    { minChildren: 8, staff: 3 },
  ],
  minProsWhenTwoOrMore: 2,
  breakWindowStart: h(11, 30),
  breakWindowEnd: h(14, 30),
  breakMinShiftMinutes: 0,
  defaultMaxDailyMinutes: h(10),
  defaultMaxAmplitudeMinutes: h(11, 30),
  defaultMinDailyMinutes: h(3),
  defaultBreakMinutes: 45,
  overtimeStrictness: 2,
  referentImportance: 1,
  defaultCleaningMinutes: 30,
}

export function defaultCleaning(rules: Rules): Partial<Record<DayIndex, CleaningDay>> {
  const out: Partial<Record<DayIndex, CleaningDay>> = {}
  for (const d of rules.openDays) out[d] = { minutes: rules.defaultCleaningMinutes, employeeIds: [] }
  return out
}

export function makeEmployee(partial: Partial<Employee> & { name: string }, rules: Rules, index = 0, existing: Employee[] = []): Employee {
  return {
    id: newId('emp'),
    color: EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length],
    avatar: pickAnimal(ADULT_ANIMALS, existing.map((e) => e.avatar), index),
    role: 'pro',
    weeklyMinutes: h(35),
    workDays: [...rules.openDays],
    fixedDailyMinutes: null,
    minDailyMinutes: rules.defaultMinDailyMinutes,
    maxDailyMinutes: rules.defaultMaxDailyMinutes,
    maxAmplitudeMinutes: rules.defaultMaxAmplitudeMinutes,
    breakMinutes: rules.defaultBreakMinutes,
    canBeAlone: true,
    active: true,
    ...partial,
  }
}

export function makeChild(partial: Partial<Child> & { name: string }, existing: Child[] = []): Child {
  return {
    id: newId('chd'),
    avatar: pickAnimal(BABY_ANIMALS, existing.map((c) => c.avatar), existing.length),
    referentId: null,
    relaisId: null,
    attendance: {},
    ...partial,
  }
}

const R = (start: number, end: number, staff: number): Requirement => ({ start, end, staff })

/** Exemple fourni : besoins types d'une semaine. */
export const EXAMPLE_REQUIREMENTS: Partial<Record<DayIndex, Requirement[]>> = {
  0: [R(h(8), h(9), 2), R(h(9), h(17), 3), R(h(17), h(18), 2), R(h(18), h(18, 30), 1)],
  1: [R(h(6, 45), h(8), 1), R(h(8), h(10), 2), R(h(10), h(17), 3), R(h(17), h(18), 2), R(h(18), h(18, 30), 1)],
  2: [R(h(6, 45), h(8), 1), R(h(8), h(10, 45), 2), R(h(10, 45), h(17), 3), R(h(17), h(18), 2)],
  3: [R(h(8), h(10), 2), R(h(10), h(17), 3), R(h(17), h(18), 2), R(h(18), h(18, 30), 1)],
  4: [R(h(8), h(8, 30), 1), R(h(8, 30), h(10), 2), R(h(10), h(17), 3), R(h(17), h(18), 2), R(h(18), h(18, 30), 1)],
}

export function buildExampleTemplate(): TemplateConfig {
  const rules = { ...DEFAULT_RULES }
  const employees: Employee[] = [
    makeEmployee(
      { id: 'emp_claude', name: 'Claude', weeklyMinutes: h(17, 30), fixedDailyMinutes: h(3, 30), minDailyMinutes: h(3, 30), breakMinutes: 0 },
      rules, 0,
    ),
    makeEmployee({ id: 'emp_isabelle', name: 'Isabelle', weeklyMinutes: h(17), workDays: [0, 1, 3] }, rules, 1),
    makeEmployee({ id: 'emp_elsa', name: 'Elsa', weeklyMinutes: h(33, 30), canBeAlone: false }, rules, 2),
    makeEmployee({ id: 'emp_fanny', name: 'Fanny', weeklyMinutes: h(33, 30) }, rules, 3),
    makeEmployee({ id: 'emp_lucie', name: 'Lucie', weeklyMinutes: h(33, 30) }, rules, 4),
  ]
  return migrateTemplate({ employees, children: [], rules, requirements: structuredClone(EXAMPLE_REQUIREMENTS), cleaning: defaultCleaning(rules) })
}

/** Spécificités de la semaine d'exemple (congés et contraintes fixes). */
export function buildExampleWeekExtras(): { leaves: Leave[]; pins: Pin[] } {
  const leaves: Leave[] = [
    { id: newId('lv'), employeeId: 'emp_claude', day: 4, minutes: h(3, 30), label: 'Congé' },
    { id: newId('lv'), employeeId: 'emp_lucie', day: 0, minutes: h(7), label: 'Congé' },
    { id: newId('lv'), employeeId: 'emp_lucie', day: 1, minutes: h(7), label: 'Congé' },
  ]
  const pin = (employeeId: string, day: DayIndex, start: number | null, end: number | null, note: string): Pin => ({
    id: newId('pin'), employeeId, day, start, end, mustWork: true, note,
  })
  const pins: Pin[] = [
    pin('emp_isabelle', 0, h(8), null, 'Binôme ouverture avec Elsa'),
    pin('emp_elsa', 0, h(8), null, 'Binôme ouverture avec Isabelle'),
    pin('emp_fanny', 0, null, h(18, 30), 'Ferme'),
    pin('emp_fanny', 1, h(6, 45), null, 'Ouvre'),
    pin('emp_lucie', 2, h(6, 45), null, 'Ouvre'),
    pin('emp_isabelle', 3, null, h(18, 30), 'Ferme'),
  ]
  return { leaves, pins }
}

export function weekConfigFromTemplate(t: TemplateConfig): WeekConfig {
  return { ...structuredClone(migrateTemplate(t)), leaves: [], pins: [], notes: '' }
}

/** Complète les données enregistrées par d'anciennes versions de l'application. */
export function migrateTemplate<T extends TemplateConfig>(t: T): T {
  const rules = { ...DEFAULT_RULES, ...t.rules }
  const cleaning = t.cleaning ?? defaultCleaning(rules)
  // attribue un animal à chaque personne / enfant, sans doublon
  const employees: Employee[] = []
  for (const [i, e] of (t.employees ?? []).entries()) {
    const used = employees.map((x) => x.avatar)
    employees.push(e.avatar && !used.includes(e.avatar) ? e : { ...e, avatar: pickAnimal(ADULT_ANIMALS, used, i) })
  }
  const children: Child[] = []
  for (const [i, c] of (t.children ?? []).entries()) {
    const used = children.map((x) => x.avatar)
    children.push(c.avatar && !used.includes(c.avatar) ? c : { ...c, avatar: pickAnimal(BABY_ANIMALS, used, i) })
  }
  return { ...t, rules, cleaning, employees, children, requirements: t.requirements ?? {} }
}

export function migrateWeekConfig(c: WeekConfig): WeekConfig {
  const m = migrateTemplate(c)
  return { ...m, leaves: m.leaves ?? [], pins: m.pins ?? [], notes: m.notes ?? '' }
}
