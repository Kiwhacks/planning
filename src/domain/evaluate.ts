import { SLOT, fmtDuration, toHHMM } from './time'
import { DAY_LABELS, type DayCoverage, type DayIndex, type EmployeeWeekStats, type Evaluation, type Violation } from './types'
import { breakRequired, workedSlots, type CEmployee, type IShift, type Model, type Shifts } from './model'

/** Tampons réutilisés pour éviter les allocations dans la boucle du solveur. */
export class Scratch {
  present: Int16Array
  pros: Int16Array
  last: Int16Array
  by: Uint8Array
  constructor(model: Model) {
    this.present = new Int16Array(model.S)
    this.pros = new Int16Array(model.S)
    this.last = new Int16Array(model.S)
    this.by = new Uint8Array(model.S * Math.max(1, model.employees.length))
  }
}

function fillPresence(model: Model, shifts: Shifts, d: number, sc: Scratch): void {
  const { S } = model
  sc.present.fill(0)
  sc.pros.fill(0)
  sc.last.fill(-1)
  sc.by.fill(0)
  for (let i = 0; i < model.employees.length; i++) {
    const sh = shifts[i][d]
    if (!sh) continue
    const emp = model.employees[i]
    const bs = sh.b
    const be = sh.b >= 0 ? sh.b + emp.breakSlots : -1
    const from = Math.max(0, sh.s)
    const to = Math.min(S, sh.e)
    for (let t = from; t < to; t++) {
      if (bs >= 0 && t >= bs && t < be) continue
      sc.present[t]++
      if (emp.isPro) sc.pros[t]++
      sc.last[t] = i
      sc.by[i * S + t] = 1
    }
  }
}

/** Coût de couverture d'une journée. */
export function dayCost(model: Model, shifts: Shifts, d: number, sc: Scratch): number {
  if (!model.isOpen[d]) {
    let c = 0
    for (let i = 0; i < model.employees.length; i++) if (shifts[i][d]) c += model.W.HARD
    return c
  }
  fillPresence(model, shifts, d, sc)
  const { S, W, minPros } = model
  const req = model.req[d]
  const close = model.closeSlot[d]
  const cleanEnd = model.cleanEnd[d]
  let cost = 0
  for (let t = 0; t < S; t++) {
    const r = req[t]
    const p = sc.present[t]
    if (r === 0 && t >= close && t < cleanEnd) {
      // créneau de ménage : seules les personnes affectées sont attendues
      for (let i = 0; i < model.employees.length; i++) {
        if (sc.by[i * S + t] && !model.employees[i].cleans[d]) cost += W.OUTSIDE
      }
      continue
    }
    if (r > 0) {
      if (p < r) cost += W.UNDER * (r - p)
      else if (p > r) cost += W.OVER * (p - r)
      if (r >= 2) {
        const need = Math.min(r, minPros)
        if (sc.pros[t] < need) cost += W.PRO * (need - sc.pros[t])
      } else if (p >= 1 && sc.pros[t] === 0) {
        cost += W.PRO
      }
    } else if (p > 0) {
      cost += W.OUTSIDE * p
    }
    if (p === 1 && !model.employees[sc.last[t]].canBeAlone) cost += W.ALONE
  }
  if (model.children.length > 0 && (W.NOREF > 0 || W.RELAIS > 0)) {
    for (const c of model.children) {
      const pr = c.present[d]
      for (let t = 0; t < S; t++) {
        if (!pr[t]) continue
        if (c.ref >= 0 && sc.by[c.ref * S + t]) continue
        if (c.relais >= 0 && sc.by[c.relais * S + t]) cost += W.RELAIS
        else cost += W.NOREF
      }
    }
  }
  return cost
}

/** Coût propre à un créneau (durées, amplitude, pause, contraintes fixes). */
export function shiftCost(model: Model, emp: CEmployee, d: number, sh: IShift | null): number {
  const { W } = model
  if (!sh) return emp.mustWork[d] ? W.HARD : 0
  let cost = 0
  if (!emp.canWork[d]) cost += W.HARD
  const brk = sh.b >= 0 ? emp.breakSlots : 0
  const dur = sh.e - sh.s - brk
  const amp = sh.e - sh.s
  if (emp.fixedDaily >= 0) cost += W.HARD * Math.abs(dur - emp.fixedDaily)
  else if (dur < emp.minDaily) cost += W.SHORT * (emp.minDaily - dur)
  if (dur > emp.maxDaily) cost += W.HARD * (dur - emp.maxDaily)
  if (amp > emp.maxAmp) cost += W.HARD * (amp - emp.maxAmp)
  if (emp.pinStart[d] >= 0 && sh.s !== emp.pinStart[d]) cost += W.HARD * Math.abs(sh.s - emp.pinStart[d])
  if (emp.pinEnd[d] >= 0 && sh.e !== emp.pinEnd[d]) cost += W.HARD * Math.abs(sh.e - emp.pinEnd[d])
  if (breakRequired(emp, sh)) {
    if (sh.b < 0 || sh.b <= sh.s || sh.b + emp.breakSlots >= sh.e) cost += W.HARD
    else {
      const bEnd = sh.b + emp.breakSlots
      let outside = 0
      if (sh.b < model.breakWinStart) outside += Math.min(bEnd, model.breakWinStart) - sh.b
      if (bEnd > model.breakWinEnd) outside += bEnd - Math.max(sh.b, model.breakWinEnd)
      cost += W.BREAKWIN * outside
      const edge = 4 // 1h
      if (sh.b - sh.s < edge) cost += W.BREAKEDGE * (edge - (sh.b - sh.s))
      if (sh.e - bEnd < edge) cost += W.BREAKEDGE * (edge - (sh.e - bEnd))
    }
  } else if (sh.b >= 0) cost += W.HARD
  return cost
}

export function weekDelta(emp: CEmployee, row: (IShift | null)[]): number {
  let total = 0
  for (let d = 0; d < 7; d++) {
    const sh = row[d]
    if (sh) total += workedSlots(emp, sh)
    total += emp.leaveSlots[d]
  }
  return total - emp.weekly
}

export function weekCost(model: Model, emp: CEmployee, row: (IShift | null)[]): number {
  const delta = weekDelta(emp, row)
  if (delta > 0) return model.W.OT * delta + model.W.OT2 * delta * delta
  if (delta < 0) return model.W.UNDERHOURS * -delta
  return 0
}

export function totalCost(model: Model, shifts: Shifts, sc = new Scratch(model)): number {
  let cost = 0
  for (let d = 0; d < 7; d++) {
    cost += dayCost(model, shifts, d, sc)
    model.employees.forEach((emp, i) => {
      cost += shiftCost(model, emp, d, shifts[i][d])
    })
  }
  model.employees.forEach((emp, i) => {
    cost += weekCost(model, emp, shifts[i])
  })
  return cost
}

/** Évaluation complète et lisible (diagnostics, statistiques, couverture). */
export function evaluate(model: Model, shifts: Shifts): Evaluation {
  const sc = new Scratch(model)
  const violations: Violation[] = []
  const coverage: DayCoverage[] = []
  const { S, minPros } = model
  const time = (t: number) => toHHMM(model.dayStart + t * SLOT)

  // regroupe des créneaux consécutifs en plages pour des messages lisibles
  const ranges = (flags: boolean[]): [number, number][] => {
    const out: [number, number][] = []
    let start = -1
    for (let t = 0; t <= S; t++) {
      const f = t < S && flags[t]
      if (f && start < 0) start = t
      if (!f && start >= 0) {
        out.push([start, t])
        start = -1
      }
    }
    return out
  }

  for (const d of model.days) {
    fillPresence(model, shifts, d, sc)
    const req = model.req[d]
    const slots: DayCoverage['slots'] = []
    const under: boolean[] = []
    const over: boolean[] = []
    const noPro: boolean[] = []
    const alone: boolean[] = []
    const outside: boolean[] = []
    let requiredMinutes = 0
    let presentMinutes = 0
    let missing = 0
    let extra = 0
    const close = model.closeSlot[d]
    const cleanEnd = model.cleanEnd[d]
    for (let t = 0; t < S; t++) {
      const r = req[t]
      const p = sc.present[t]
      const isCleaning = r === 0 && t >= close && t < cleanEnd
      let nonCleaners = 0
      if (isCleaning) for (let i = 0; i < model.employees.length; i++) if (sc.by[i * S + t] && !model.employees[i].cleans[d]) nonCleaners++
      under[t] = r > 0 && p < r
      over[t] = r > 0 && p > r
      outside[t] = isCleaning ? nonCleaners > 0 : r === 0 && p > 0
      if (r > 0 && p < r) missing += (r - p) * SLOT
      if (r > 0 && p > r) extra += (p - r) * SLOT
      noPro[t] = (r >= 2 && sc.pros[t] < Math.min(r, minPros)) || (r === 1 && p >= 1 && sc.pros[t] === 0)
      alone[t] = !isCleaning && p === 1 && !model.employees[sc.last[t]].canBeAlone
      requiredMinutes += (isCleaning ? model.cleanerCount[d] : r) * SLOT
      presentMinutes += p * SLOT
      slots.push({ time: model.dayStart + t * SLOT, required: r, present: p, pros: sc.pros[t], cleaning: isCleaning, problem: under[t] || noPro[t] || alone[t] })
    }
    const dl = DAY_LABELS[d]
    if (close >= 0 && model.cleanMinutes[d] > 0 && model.cleanerCount[d] === 0) {
      violations.push({ severity: 'warning', day: d, employeeId: null, message: `${dl} : personne n'est affectée au ménage (${fmtDuration(model.cleanMinutes[d])} après ${time(close)}).` })
    }
    for (const [a, b] of ranges(under)) {
      const maxMissing = Math.max(...slots.slice(a, b).map((s) => s.required - s.present))
      violations.push({ severity: 'error', day: d, employeeId: null, message: `${dl} ${time(a)}–${time(b)} : il manque ${maxMissing} personne${maxMissing > 1 ? 's' : ''}.` })
    }
    for (const [a, b] of ranges(noPro)) {
      violations.push({ severity: 'error', day: d, employeeId: null, message: `${dl} ${time(a)}–${time(b)} : pas assez de professionnelles (apprenties / stagiaires non comptés).` })
    }
    for (const [a, b] of ranges(alone)) {
      const who = model.employees[sc.last[a]].name
      violations.push({ severity: 'error', day: d, employeeId: model.employees[sc.last[a]].id, message: `${dl} ${time(a)}–${time(b)} : ${who} est seule alors qu'elle ne peut pas ouvrir ou fermer seule.` })
    }
    for (const [a, b] of ranges(outside)) {
      violations.push({ severity: 'warning', day: d, employeeId: null, message: `${dl} ${time(a)}–${time(b)} : présence en dehors des horaires de besoin.` })
    }
    for (const [a, b] of ranges(over)) {
      if ((b - a) * SLOT >= 60) {
        const maxExtra = Math.max(...slots.slice(a, b).map((s) => s.present - s.required))
        violations.push({ severity: 'info', day: d, employeeId: null, message: `${dl} ${time(a)}–${time(b)} : ${maxExtra} personne${maxExtra > 1 ? 's' : ''} de plus que le besoin.` })
      }
    }
    // référentes / relais
    for (const c of model.children) {
      const pr = c.present[d]
      const none: boolean[] = []
      for (let t = 0; t < S; t++) {
        none[t] = !!pr[t] && !(c.ref >= 0 && sc.by[c.ref * S + t]) && !(c.relais >= 0 && sc.by[c.relais * S + t])
      }
      for (const [a, b] of ranges(none)) {
        if ((b - a) * SLOT >= 30)
          violations.push({ severity: 'info', day: d, employeeId: null, message: `${dl} ${time(a)}–${time(b)} : ni référente ni relais présente pour ${c.name}.` })
      }
    }
    coverage.push({ day: d, slots, requiredMinutes, presentMinutes, missingMinutes: missing, extraMinutes: extra })
  }

  const stats: EmployeeWeekStats[] = model.employees.map((emp, i) => {
    const perDay: Partial<Record<DayIndex, number>> = {}
    let worked = 0
    let leave = 0
    for (let d = 0; d < 7; d++) {
      const sh = shifts[i][d]
      const dl = DAY_LABELS[d]
      if (sh) {
        const w = workedSlots(emp, sh) * SLOT
        perDay[d as DayIndex] = w
        worked += w
        const amp = (sh.e - sh.s) * SLOT
        if (!emp.canWork[d]) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : ${emp.name} est planifiée un jour non travaillé ou en congé.` })
        if (emp.fixedDaily >= 0 && w !== emp.fixedDaily * SLOT) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : ${emp.name} doit faire exactement ${fmtDuration(emp.fixedDaily * SLOT)} (planifié ${fmtDuration(w)}).` })
        if (w > emp.maxDaily * SLOT) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : ${emp.name} dépasse le maximum journalier (${fmtDuration(w)} > ${fmtDuration(emp.maxDaily * SLOT)}).` })
        if (amp > emp.maxAmp * SLOT) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : amplitude de ${emp.name} trop grande (${fmtDuration(amp)} > ${fmtDuration(emp.maxAmp * SLOT)}).` })
        if (emp.fixedDaily < 0 && w < emp.minDaily * SLOT) violations.push({ severity: 'warning', day: d as DayIndex, employeeId: emp.id, message: `${dl} : journée très courte pour ${emp.name} (${fmtDuration(w)}).` })
        if (emp.pinStart[d] >= 0 && sh.s !== emp.pinStart[d]) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : ${emp.name} devrait commencer à ${time(emp.pinStart[d])} (planifié ${time(sh.s)}).` })
        if (emp.pinEnd[d] >= 0 && sh.e !== emp.pinEnd[d]) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: emp.cleans[d] ? `${dl} : ${emp.name} est affectée au ménage et devrait finir à ${time(emp.pinEnd[d])} (planifié ${time(sh.e)}).` : `${dl} : ${emp.name} devrait finir à ${time(emp.pinEnd[d])} (planifié ${time(sh.e)}).` })
        if (breakRequired(emp, sh)) {
          if (sh.b < 0 || sh.b <= sh.s || sh.b + emp.breakSlots >= sh.e) violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: `${dl} : pause manquante ou mal placée pour ${emp.name}.` })
          else if (sh.b < model.breakWinStart || sh.b + emp.breakSlots > model.breakWinEnd) violations.push({ severity: 'info', day: d as DayIndex, employeeId: emp.id, message: `${dl} : pause de ${emp.name} à ${time(sh.b)}, hors de la fenêtre habituelle.` })
        }
      } else if (emp.mustWork[d]) {
        violations.push({ severity: 'error', day: d as DayIndex, employeeId: emp.id, message: emp.cleans[d] ? `${dl} : ${emp.name} est affectée au ménage mais n'est pas planifiée.` : `${dl} : ${emp.name} devrait travailler (contrainte fixe) mais n'est pas planifiée.` })
      }
      leave += emp.leaveSlots[d] * SLOT
    }
    const contract = emp.weekly * SLOT
    const delta = worked + leave - contract
    if (delta > 0) violations.push({ severity: 'warning', day: null, employeeId: emp.id, message: `${emp.name} : ${fmtDuration(delta)} d'heures supplémentaires cette semaine.` })
    if (delta < 0) violations.push({ severity: 'warning', day: null, employeeId: emp.id, message: `${emp.name} : il manque ${fmtDuration(-delta)} pour atteindre ${fmtDuration(contract)}.` })
    return { employeeId: emp.id, workedMinutes: worked, leaveMinutes: leave, contractMinutes: contract, deltaMinutes: delta, perDay }
  })

  const order = { error: 0, warning: 1, info: 2 }
  violations.sort((a, b) => order[a.severity] - order[b.severity] || (a.day ?? 9) - (b.day ?? 9))

  return { cost: totalCost(model, shifts, sc), violations, stats, coverage }
}
