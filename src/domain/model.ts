import { SLOT } from './time'
import { normalizeRequirements, requiredAt } from './requirements'
import type { DayIndex, Schedule, Shift, WeekConfig } from './types'

/** Créneau interne : en indices de créneaux de 15 min depuis `dayStart`. b = -1 → pas de pause. */
export interface IShift {
  s: number
  e: number
  b: number
}

export interface CEmployee {
  id: string
  name: string
  isPro: boolean
  canBeAlone: boolean
  weekly: number
  /** -1 si non fixe */
  fixedDaily: number
  minDaily: number
  maxDaily: number
  maxAmp: number
  breakSlots: number
  breakMinShift: number
  canWork: boolean[]
  leaveSlots: number[]
  pinStart: number[]
  pinEnd: number[]
  mustWork: boolean[]
  /** Créneau verrouillé par l'utilisateur (non modifiable par le solveur). */
  frozen: boolean[]
}

export interface CChild {
  id: string
  name: string
  ref: number
  relais: number
  /** present[day][slot] */
  present: Uint8Array[]
}

export interface Weights {
  HARD: number
  UNDER: number
  PRO: number
  ALONE: number
  OUTSIDE: number
  OT: number
  OT2: number
  UNDERHOURS: number
  OVER: number
  SHORT: number
  BREAKWIN: number
  BREAKEDGE: number
  NOREF: number
  RELAIS: number
}

export interface Model {
  S: number
  dayStart: number
  days: DayIndex[]
  isOpen: boolean[]
  req: Uint8Array[]
  openSlot: number[]
  closeSlot: number[]
  employees: CEmployee[]
  children: CChild[]
  minPros: number
  breakWinStart: number
  breakWinEnd: number
  W: Weights
}

export type Shifts = (IShift | null)[][]

export function makeWeights(cfg: WeekConfig): Weights {
  const ot = { 1: 30, 2: 60, 3: 150 }[cfg.rules.overtimeStrictness] ?? 60
  const refImp = cfg.rules.referentImportance
  return {
    HARD: 10000,
    UNDER: 1000,
    PRO: 1000,
    ALONE: 1000,
    OUTSIDE: 300,
    OT: ot,
    OT2: ot / 20,
    UNDERHOURS: 50,
    OVER: 4,
    SHORT: 40,
    BREAKWIN: 15,
    BREAKEDGE: 40,
    NOREF: refImp * 2,
    RELAIS: refImp * 0.5,
  }
}

export function compile(cfg: WeekConfig, existing: Schedule | null): { model: Model; shifts: Shifts } {
  const { rules } = cfg
  const dayStart = rules.dayStart
  const S = Math.max(1, Math.ceil((rules.dayEnd - rules.dayStart) / SLOT))
  const toSlot = (m: number) => Math.round((m - dayStart) / SLOT)
  const days = [...rules.openDays].sort() as DayIndex[]
  const isOpen = Array.from({ length: 7 }, (_, d) => days.includes(d as DayIndex))

  const req: Uint8Array[] = []
  const openSlot: number[] = []
  const closeSlot: number[] = []
  for (let d = 0; d < 7; d++) {
    const arr = new Uint8Array(S)
    const list = normalizeRequirements(cfg.requirements[d as DayIndex] ?? [])
    let o = -1
    let c = -1
    if (isOpen[d]) {
      for (let t = 0; t < S; t++) {
        const n = requiredAt(list, dayStart + t * SLOT)
        arr[t] = n
        if (n > 0) {
          if (o < 0) o = t
          c = t + 1
        }
      }
    }
    req.push(arr)
    openSlot.push(o)
    closeSlot.push(c)
  }

  const activeEmployees = cfg.employees.filter((e) => e.active)
  const employees: CEmployee[] = activeEmployees.map((e) => {
    const canWork = Array.from({ length: 7 }, (_, d) => isOpen[d] && e.workDays.includes(d as DayIndex))
    const leaveSlots = Array(7).fill(0) as number[]
    const pinStart = Array(7).fill(-1) as number[]
    const pinEnd = Array(7).fill(-1) as number[]
    const mustWork = Array(7).fill(false) as boolean[]
    const frozen = Array(7).fill(false) as boolean[]
    for (const lv of cfg.leaves) {
      if (lv.employeeId !== e.id) continue
      leaveSlots[lv.day] += Math.round(lv.minutes / SLOT)
      canWork[lv.day] = false
    }
    for (const p of cfg.pins) {
      if (p.employeeId !== e.id) continue
      if (p.mustWork === false) canWork[p.day] = false
      if (!canWork[p.day]) continue
      if (p.start != null) pinStart[p.day] = toSlot(p.start)
      if (p.end != null) pinEnd[p.day] = toSlot(p.end)
      if (p.mustWork === true || p.start != null || p.end != null) mustWork[p.day] = true
    }
    const breakSlots = Math.round(e.breakMinutes / SLOT)
    return {
      id: e.id,
      name: e.name,
      isPro: e.role === 'pro',
      canBeAlone: e.canBeAlone,
      weekly: Math.round(e.weeklyMinutes / SLOT),
      fixedDaily: e.fixedDailyMinutes != null ? Math.round(e.fixedDailyMinutes / SLOT) : -1,
      minDaily: Math.round(e.minDailyMinutes / SLOT),
      maxDaily: Math.round(e.maxDailyMinutes / SLOT),
      maxAmp: Math.round(e.maxAmplitudeMinutes / SLOT),
      breakSlots,
      breakMinShift: Math.round(rules.breakMinShiftMinutes / SLOT),
      canWork,
      leaveSlots,
      pinStart,
      pinEnd,
      mustWork,
      frozen,
    }
  })

  const empIndex = new Map(employees.map((e, i) => [e.id, i]))
  const children: CChild[] = cfg.children.map((c) => {
    const present: Uint8Array[] = []
    for (let d = 0; d < 7; d++) {
      const arr = new Uint8Array(S)
      const a = c.attendance[d as DayIndex]
      if (a && isOpen[d]) {
        for (let t = Math.max(0, toSlot(a.start)); t < Math.min(S, toSlot(a.end)); t++) arr[t] = 1
      }
      present.push(arr)
    }
    return {
      id: c.id,
      name: c.name,
      ref: c.referentId ? (empIndex.get(c.referentId) ?? -1) : -1,
      relais: c.relaisId ? (empIndex.get(c.relaisId) ?? -1) : -1,
      present,
    }
  })

  const model: Model = {
    S,
    dayStart,
    days,
    isOpen,
    req,
    openSlot,
    closeSlot,
    employees,
    children,
    minPros: rules.minProsWhenTwoOrMore,
    breakWinStart: toSlot(rules.breakWindowStart),
    breakWinEnd: toSlot(rules.breakWindowEnd),
    W: makeWeights(cfg),
  }

  const shifts: Shifts = employees.map((ce) => {
    const row: (IShift | null)[] = Array(7).fill(null)
    const sched = existing?.[ce.id]
    if (!sched) return row
    for (let d = 0; d < 7; d++) {
      const sh = sched[d as DayIndex]
      if (!sh) continue
      const ish: IShift = { s: toSlot(sh.start), e: toSlot(sh.end), b: sh.breakStart != null ? toSlot(sh.breakStart) : -1 }
      if (ish.e <= ish.s) continue
      row[d] = ish
      if (sh.locked) ce.frozen[d] = true
    }
    return row
  })

  return { model, shifts }
}

export function toSchedule(model: Model, shifts: Shifts, existing: Schedule | null): Schedule {
  const out: Schedule = {}
  model.employees.forEach((ce, i) => {
    const row: Partial<Record<DayIndex, Shift | null>> = {}
    for (let d = 0; d < 7; d++) {
      const sh = shifts[i][d]
      if (!sh) {
        row[d as DayIndex] = null
        continue
      }
      row[d as DayIndex] = {
        start: model.dayStart + sh.s * SLOT,
        end: model.dayStart + sh.e * SLOT,
        breakStart: sh.b >= 0 ? model.dayStart + sh.b * SLOT : null,
        locked: existing?.[ce.id]?.[d as DayIndex]?.locked ?? false,
      }
    }
    out[ce.id] = row
  })
  return out
}

export function workedSlots(emp: CEmployee, sh: IShift): number {
  return sh.e - sh.s - (sh.b >= 0 ? emp.breakSlots : 0)
}

export function breakRequired(emp: CEmployee, sh: IShift): boolean {
  if (emp.breakSlots <= 0) return false
  if (emp.breakMinShift > 0 && sh.e - sh.s <= emp.breakMinShift) return false
  return true
}

/** Replace la pause dans le créneau si nécessaire (au milieu, dans la fenêtre si possible). */
export function fixBreak(model: Model, emp: CEmployee, sh: IShift): void {
  if (!breakRequired(emp, sh)) {
    sh.b = -1
    return
  }
  const brk = emp.breakSlots
  const lo = sh.s + 1
  const hi = sh.e - 1 - brk
  if (hi < lo) {
    sh.b = -1
    return
  }
  if (sh.b >= lo && sh.b <= hi) return
  const mid = Math.round((sh.s + sh.e) / 2 - brk / 2)
  let b = Math.max(lo, Math.min(hi, mid))
  // essayer de rentrer dans la fenêtre de pause
  const winLo = Math.max(lo, model.breakWinStart)
  const winHi = Math.min(hi, model.breakWinEnd - brk)
  if (winLo <= winHi) b = Math.max(winLo, Math.min(winHi, mid))
  sh.b = b
}
