import { Scratch, dayCost, shiftCost, totalCost, weekCost } from './evaluate'
import { fixBreak, type CEmployee, type IShift, type Model, type Shifts } from './model'

export interface SolveOptions {
  /** Itérations par redémarrage. */
  iterations?: number
  /** Nombre de redémarrages (on garde le meilleur). */
  restarts?: number
  seed?: number
  /** Budget temps total en ms (approximatif). */
  timeBudgetMs?: number
  onProgress?: (p: { progress: number; bestCost: number }) => void
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cloneShifts = (s: Shifts): Shifts => s.map((row) => row.map((x) => (x ? { ...x } : null)))

function clampShift(model: Model, emp: CEmployee, d: number, sh: IShift): boolean {
  if (emp.pinStart[d] >= 0) sh.s = emp.pinStart[d]
  if (emp.pinEnd[d] >= 0) sh.e = emp.pinEnd[d]
  if (sh.s < 0 || sh.e > model.S || sh.e <= sh.s) return false
  if (emp.fixedDaily >= 0) {
    // durée imposée : on ajuste la fin (ou le début si la fin est fixée)
    const needAmp = emp.fixedDaily + (emp.breakSlots > 0 && (emp.breakMinShift === 0 || emp.fixedDaily + emp.breakSlots > emp.breakMinShift) ? emp.breakSlots : 0)
    if (emp.pinEnd[d] >= 0 && emp.pinStart[d] < 0) sh.s = sh.e - needAmp
    else sh.e = sh.s + needAmp
    if (sh.s < 0 || sh.e > model.S) return false
  }
  fixBreak(model, emp, sh)
  return true
}

/** Point de départ : un créneau par jour travaillé, de durée ≈ heures restantes / jours. */
export function greedyInit(model: Model, base: Shifts, rand: () => number): Shifts {
  const shifts = cloneShifts(base)
  model.employees.forEach((emp, i) => {
    const days = model.days.filter((d) => emp.canWork[d] && !emp.frozen[d])
    const frozenWork = model.days.filter((d) => emp.frozen[d] && shifts[i][d]).reduce((acc: number, d) => {
      const sh = shifts[i][d]!
      return acc + (sh.e - sh.s - (sh.b >= 0 ? emp.breakSlots : 0))
    }, 0)
    const leave = emp.leaveSlots.reduce((a, b) => a + b, 0)
    const remaining = Math.max(0, emp.weekly - leave - frozenWork)
    let perDay = days.length ? Math.round(remaining / days.length) : 0
    if (emp.fixedDaily >= 0) perDay = emp.fixedDaily
    perDay = Math.max(Math.min(perDay, emp.maxDaily), 1)
    days.forEach((d, k) => {
      const open = model.openSlot[d]
      const close = model.closeSlot[d]
      if (open < 0) return
      const brk = emp.breakSlots > 0 && (emp.breakMinShift === 0 || perDay > emp.breakMinShift) ? emp.breakSlots : 0
      const amp = Math.min(perDay + brk, emp.maxAmp)
      let s: number
      if (emp.pinStart[d] >= 0) s = emp.pinStart[d]
      else if (emp.pinEnd[d] >= 0) s = emp.pinEnd[d] - amp
      else {
        const span = Math.max(0, close - open - amp)
        s = open + Math.round(((i + k) % 3) * (span / 2) + rand() * 2)
      }
      const sh: IShift = { s, e: s + amp, b: -1 }
      sh.s = Math.max(0, Math.min(sh.s, model.S - amp))
      sh.e = sh.s + amp
      if (clampShift(model, emp, d, sh)) shifts[i][d] = sh
      else if (emp.mustWork[d]) shifts[i][d] = { s: Math.max(0, emp.pinStart[d]), e: Math.min(model.S, emp.pinEnd[d] >= 0 ? emp.pinEnd[d] : model.S), b: -1 }
    })
  })
  return shifts
}

interface State {
  shifts: Shifts
  dayC: number[]
  shiftC: number[][]
  weekC: number[]
  cost: number
}

function buildState(model: Model, shifts: Shifts, sc: Scratch): State {
  const dayC: number[] = []
  const shiftC: number[][] = model.employees.map(() => Array(7).fill(0) as number[])
  const weekC: number[] = []
  for (let d = 0; d < 7; d++) {
    dayC[d] = dayCost(model, shifts, d, sc)
    model.employees.forEach((emp, i) => {
      shiftC[i][d] = shiftCost(model, emp, d, shifts[i][d])
    })
  }
  model.employees.forEach((emp, i) => {
    weekC[i] = weekCost(model, emp, shifts[i])
  })
  const cost = dayC.reduce((a, b) => a + b, 0) + shiftC.flat().reduce((a, b) => a + b, 0) + weekC.reduce((a, b) => a + b, 0)
  return { shifts, dayC, shiftC, weekC, cost }
}

interface Change {
  e: number
  d: number
  sh: IShift | null
}

function anneal(model: Model, start: Shifts, iterations: number, rand: () => number, T0: number, onTick?: (i: number, best: number) => void): { shifts: Shifts; cost: number } {
  const sc = new Scratch(model)
  const st = buildState(model, start, sc)
  let best = cloneShifts(st.shifts)
  let bestCost = st.cost
  const E = model.employees.length
  const days = model.days
  if (E === 0 || days.length === 0) return { shifts: best, cost: bestCost }

  const T1 = 0.5
  const pickDelta = () => (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 4))

  const movable = (e: number, d: number) => model.employees[e].canWork[d] && !model.employees[e].frozen[d]

  const changes: Change[] = []
  const saved: Change[] = []

  const apply = (c: Change) => {
    saved.push({ e: c.e, d: c.d, sh: st.shifts[c.e][c.d] })
    st.shifts[c.e][c.d] = c.sh
  }

  for (let it = 0; it < iterations; it++) {
    if (onTick && it % 5000 === 0) onTick(it, bestCost)
    const T = T0 * Math.pow(T1 / T0, it / iterations)
    changes.length = 0
    saved.length = 0

    const e = Math.floor(rand() * E)
    const emp = model.employees[e]
    const d = days[Math.floor(rand() * days.length)]
    if (!movable(e, d)) continue
    const cur = st.shifts[e][d]

    if (!cur) {
      // création
      const open = model.openSlot[d]
      const close = model.closeSlot[d]
      if (open < 0) continue
      const dur = emp.fixedDaily >= 0 ? emp.fixedDaily : Math.max(emp.minDaily, Math.min(emp.maxDaily, Math.round(emp.minDaily + rand() * (emp.maxDaily - emp.minDaily))))
      const brk = emp.breakSlots > 0 && (emp.breakMinShift === 0 || dur > emp.breakMinShift) ? emp.breakSlots : 0
      const amp = dur + brk
      const s = Math.max(0, Math.min(model.S - amp, open + Math.floor(rand() * Math.max(1, close - open - amp + 1))))
      const sh: IShift = { s, e: s + amp, b: -1 }
      if (!clampShift(model, emp, d, sh)) continue
      changes.push({ e, d, sh })
    } else {
      const r = rand()
      const sh: IShift = { ...cur }
      const fixed = emp.fixedDaily >= 0
      const pinS = emp.pinStart[d] >= 0
      const pinE = emp.pinEnd[d] >= 0
      if (r < 0.05) {
        // suppression
        if (emp.mustWork[d]) continue
        changes.push({ e, d, sh: null })
      } else if (r < 0.1) {
        // recréation aléatoire (grand saut)
        const open = model.openSlot[d]
        const close = model.closeSlot[d]
        if (open < 0) continue
        const dur = emp.fixedDaily >= 0 ? emp.fixedDaily : Math.max(emp.minDaily, Math.min(emp.maxDaily, Math.round(emp.minDaily + rand() * (emp.maxDaily - emp.minDaily))))
        const brk = emp.breakSlots > 0 && (emp.breakMinShift === 0 || dur > emp.breakMinShift) ? emp.breakSlots : 0
        const amp = dur + brk
        const s = Math.max(0, Math.min(model.S - amp, open + Math.floor(rand() * Math.max(1, close - open - amp + 1))))
        const fresh: IShift = { s, e: s + amp, b: -1 }
        if (!clampShift(model, emp, d, fresh)) continue
        changes.push({ e, d, sh: fresh })
      } else if (r < 0.3 && !fixed && !pinS) {
        sh.s += pickDelta()
        if (!clampShift(model, emp, d, sh)) continue
        changes.push({ e, d, sh })
      } else if (r < 0.5 && !fixed && !pinE) {
        sh.e += pickDelta()
        if (!clampShift(model, emp, d, sh)) continue
        changes.push({ e, d, sh })
      } else if (r < 0.65 && !pinS && !pinE) {
        const k = pickDelta()
        sh.s += k
        sh.e += k
        if (!clampShift(model, emp, d, sh)) continue
        changes.push({ e, d, sh })
      } else if (r < 0.75 && sh.b >= 0) {
        const winLo = Math.max(sh.s + 1, model.breakWinStart)
        const winHi = Math.min(sh.e - 1 - emp.breakSlots, model.breakWinEnd - emp.breakSlots)
        const u = rand()
        if (u < 0.5) sh.b += pickDelta()
        else if (u < 0.8 && winLo <= winHi) sh.b = winLo + Math.floor(rand() * (winHi - winLo + 1))
        else sh.b = sh.s + 1 + Math.floor(rand() * Math.max(1, sh.e - emp.breakSlots - sh.s - 1))
        if (sh.b <= sh.s || sh.b + emp.breakSlots >= sh.e) continue
        changes.push({ e, d, sh })
      } else if (r < 0.9 && !fixed) {
        // transfert d'heures vers un autre jour de la même personne
        const d2 = days[Math.floor(rand() * days.length)]
        if (d2 === d || !movable(e, d2)) continue
        const other = st.shifts[e][d2]
        const k = 1 + Math.floor(rand() * 4)
        const atEnd = rand() < 0.5
        if (atEnd ? pinE : pinS) continue
        if (atEnd) sh.e -= k
        else sh.s += k
        if (!clampShift(model, emp, d, sh)) continue
        let sh2: IShift
        if (other) {
          sh2 = { ...other }
          const atEnd2 = rand() < 0.5
          if (atEnd2 ? emp.pinEnd[d2] >= 0 : emp.pinStart[d2] >= 0) continue
          if (atEnd2) sh2.e += k
          else sh2.s -= k
        } else {
          const open = model.openSlot[d2]
          if (open < 0) continue
          const dur = Math.max(k, emp.minDaily)
          const brk = emp.breakSlots > 0 && (emp.breakMinShift === 0 || dur > emp.breakMinShift) ? emp.breakSlots : 0
          const s2 = Math.max(0, Math.min(model.S - dur - brk, open + Math.floor(rand() * Math.max(1, model.closeSlot[d2] - open - dur - brk + 1))))
          sh2 = { s: s2, e: s2 + dur + brk, b: -1 }
        }
        if (!clampShift(model, emp, d2, sh2)) continue
        changes.push({ e, d, sh }, { e, d: d2, sh: sh2 })
      } else {
        // échange d'heure de début ou de fin avec une autre personne le même jour
        const e2 = Math.floor(rand() * E)
        if (e2 === e || !movable(e2, d)) continue
        const o = st.shifts[e2][d]
        if (!o) continue
        const emp2 = model.employees[e2]
        if (fixed || emp2.fixedDaily >= 0) continue
        const sh2: IShift = { ...o }
        const mode = rand()
        if (mode < 0.34 && sh.b >= 0 && sh2.b >= 0) {
          // échange des pauses (utile pour caler les pauses repas sans trou de couverture)
          ;[sh.b, sh2.b] = [sh2.b, sh.b]
          if (sh.b <= sh.s || sh.b + emp.breakSlots >= sh.e || sh2.b <= sh2.s || sh2.b + emp2.breakSlots >= sh2.e) continue
        } else {
          const swapStart = mode < 0.67
          if (swapStart ? pinS || emp2.pinStart[d] >= 0 : pinE || emp2.pinEnd[d] >= 0) continue
          if (swapStart) [sh.s, sh2.s] = [sh2.s, sh.s]
          else [sh.e, sh2.e] = [sh2.e, sh.e]
          if (!clampShift(model, emp, d, sh) || !clampShift(model, emp2, d, sh2)) continue
        }
        changes.push({ e, d, sh }, { e: e2, d, sh: sh2 })
      }
    }

    // applique et calcule le delta de coût (jours et personnes touchés)
    for (const c of changes) apply(c)
    const touchedDays = [...new Set(changes.map((c) => c.d))]
    const touchedEmps = [...new Set(changes.map((c) => c.e))]
    let delta = 0
    const newDay: number[] = []
    for (const td of touchedDays) {
      const v = dayCost(model, st.shifts, td, sc)
      newDay.push(v)
      delta += v - st.dayC[td]
    }
    const newShift: number[] = []
    for (const c of changes) {
      const v = shiftCost(model, model.employees[c.e], c.d, c.sh)
      newShift.push(v)
      delta += v - st.shiftC[c.e][c.d]
    }
    const newWeek: number[] = []
    for (const te of touchedEmps) {
      const v = weekCost(model, model.employees[te], st.shifts[te])
      newWeek.push(v)
      delta += v - st.weekC[te]
    }

    if (delta <= 0 || rand() < Math.exp(-delta / T)) {
      touchedDays.forEach((td, k) => (st.dayC[td] = newDay[k]))
      changes.forEach((c, k) => (st.shiftC[c.e][c.d] = newShift[k]))
      touchedEmps.forEach((te, k) => (st.weekC[te] = newWeek[k]))
      st.cost += delta
      if (st.cost < bestCost - 1e-9) {
        bestCost = st.cost
        best = cloneShifts(st.shifts)
      }
    } else {
      for (let k = saved.length - 1; k >= 0; k--) st.shifts[saved[k].e][saved[k].d] = saved[k].sh
    }
  }
  return { shifts: best, cost: bestCost }
}

/** Descente locale déterministe : essaie tous les petits déplacements (±1 créneau) tant que le coût baisse. */
export function polish(model: Model, shifts: Shifts, maxPasses = 60): { shifts: Shifts; cost: number } {
  const sc = new Scratch(model)
  const st = buildState(model, shifts, sc)
  const E = model.employees.length
  const tryChange = (e: number, d: number, sh: IShift | null): boolean => {
    const old = st.shifts[e][d]
    st.shifts[e][d] = sh
    const nd = dayCost(model, st.shifts, d, sc)
    const ns = shiftCost(model, model.employees[e], d, sh)
    const nw = weekCost(model, model.employees[e], st.shifts[e])
    const delta = nd - st.dayC[d] + ns - st.shiftC[e][d] + nw - st.weekC[e]
    if (delta < -1e-9) {
      st.dayC[d] = nd
      st.shiftC[e][d] = ns
      st.weekC[e] = nw
      st.cost += delta
      return true
    }
    st.shifts[e][d] = old
    return false
  }
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let e = 0; e < E; e++) {
      const emp = model.employees[e]
      for (const d of model.days) {
        if (!emp.canWork[d] || emp.frozen[d]) continue
        const cur = st.shifts[e][d]
        if (!cur) continue
        const fixed = emp.fixedDaily >= 0
        const candidates: IShift[] = []
        for (const k of [-1, 1, -2, 2]) {
          if (!fixed && emp.pinStart[d] < 0) candidates.push({ ...cur, s: cur.s + k })
          if (!fixed && emp.pinEnd[d] < 0) candidates.push({ ...cur, e: cur.e + k })
          if (emp.pinStart[d] < 0 && emp.pinEnd[d] < 0) candidates.push({ ...cur, s: cur.s + k, e: cur.e + k })
        }
        if (cur.b >= 0) for (let b = cur.s + 1; b + emp.breakSlots < cur.e; b++) if (b !== cur.b) candidates.push({ ...cur, b })
        for (const c of candidates) {
          if (c.b >= 0 && (c.b <= c.s || c.b + emp.breakSlots >= c.e)) continue
          if (!clampShift(model, emp, d, c)) continue
          if (tryChange(e, d, c)) {
            improved = true
            break
          }
        }
      }
    }
    if (!improved) break
  }

  // réparation ciblée : sur les journées encore en défaut, essaie des paires de mouvements (deux personnes)
  const candidatesFor = (e: number, d: number): IShift[] => {
    const emp = model.employees[e]
    const cur = st.shifts[e][d]
    if (!cur || !emp.canWork[d] || emp.frozen[d]) return []
    const fixed = emp.fixedDaily >= 0
    const out: IShift[] = []
    for (const k of [-1, 1, -2, 2, -3, 3]) {
      if (!fixed && emp.pinStart[d] < 0) out.push({ ...cur, s: cur.s + k })
      if (!fixed && emp.pinEnd[d] < 0) out.push({ ...cur, e: cur.e + k })
      if (emp.pinStart[d] < 0 && emp.pinEnd[d] < 0) out.push({ ...cur, s: cur.s + k, e: cur.e + k })
    }
    if (cur.b >= 0) for (let b = cur.s + 1; b + emp.breakSlots < cur.e; b++) if (b !== cur.b) out.push({ ...cur, b })
    return out.filter((c) => !(c.b >= 0 && (c.b <= c.s || c.b + emp.breakSlots >= c.e)) && clampShift(model, emp, d, c))
  }
  for (let pass = 0; pass < 10; pass++) {
    let improved = false
    for (const d of model.days) {
      const breakIssue = st.shiftC.some((row) => row[d] >= model.W.BREAKWIN_HARD)
      if (st.dayC[d] < model.W.UNDER && !breakIssue) continue
      const present = [...Array(E).keys()].filter((e) => st.shifts[e][d])
      let done = false
      for (let i = 0; i < present.length && !done; i++) {
        const e1 = present[i]
        const c1s = candidatesFor(e1, d)
        for (let j = 0; j < present.length && !done; j++) {
          if (i === j) continue
          const e2 = present[j]
          const c2s = candidatesFor(e2, d)
          const old1 = st.shifts[e1][d]
          const old2 = st.shifts[e2][d]
          for (const c1 of c1s) {
            st.shifts[e1][d] = c1
            const s1 = shiftCost(model, model.employees[e1], d, c1)
            const w1 = weekCost(model, model.employees[e1], st.shifts[e1])
            for (const c2 of c2s) {
              st.shifts[e2][d] = c2
              const nd = dayCost(model, st.shifts, d, sc)
              const s2 = shiftCost(model, model.employees[e2], d, c2)
              const w2 = weekCost(model, model.employees[e2], st.shifts[e2])
              const delta = nd - st.dayC[d] + s1 - st.shiftC[e1][d] + s2 - st.shiftC[e2][d] + w1 - st.weekC[e1] + w2 - st.weekC[e2]
              if (delta < -1e-9) {
                st.dayC[d] = nd
                st.shiftC[e1][d] = s1
                st.shiftC[e2][d] = s2
                st.weekC[e1] = w1
                st.weekC[e2] = w2
                st.cost += delta
                improved = true
                done = true
                break
              }
            }
            if (done) break
            st.shifts[e2][d] = old2
          }
          if (!done) {
            st.shifts[e1][d] = old1
            st.shifts[e2][d] = old2
          }
        }
      }
    }
    if (!improved) break
  }
  return { shifts: st.shifts, cost: st.cost }
}

export function solve(model: Model, base: Shifts, opts: SolveOptions = {}): { shifts: Shifts; cost: number } {
  const iterations = opts.iterations ?? 250_000
  const restarts = opts.restarts ?? 3
  const rand = rng(opts.seed ?? 12345)
  const started = Date.now()
  let best: { shifts: Shifts; cost: number } | null = null
  // la solution existante (hors créneaux verrouillés) sert aussi de point de départ
  // nettoie les créneaux impossibles (jour non travaillé / congé) sauf s'ils sont verrouillés
  const sanitized = base.map((row, i) => row.map((x, d) => (x && !model.employees[i].canWork[d] && !model.employees[i].frozen[d] ? null : x)))
  const starts: Shifts[] = [cloneShifts(sanitized)]
  for (let r = 0; r < restarts; r++) {
    let init: Shifts
    let T0 = 400
    if (r === 0 && sanitized.some((row) => row.some(Boolean))) init = starts[0]
    else if (r >= 2 && best) {
      // réchauffage à partir de la meilleure solution connue
      init = cloneShifts(best.shifts)
      T0 = 120
    } else init = greedyInit(model, sanitized.map((row, i) => row.map((x, d) => (model.employees[i].frozen[d] ? x : null))), rand)
    const annealed = anneal(model, init, iterations, rand, T0, (i, b) => {
      opts.onProgress?.({ progress: (r + i / iterations) / restarts, bestCost: Math.min(b, best?.cost ?? Infinity) })
    })
    const result = polish(model, annealed.shifts)
    if (!best || result.cost < best.cost) best = result
    if (opts.timeBudgetMs && Date.now() - started > opts.timeBudgetMs) break
    if (best.cost === 0) break
  }
  opts.onProgress?.({ progress: 1, bestCost: best!.cost })
  // sécurité : recalcul complet
  best!.cost = totalCost(model, best!.shifts)
  return best!
}
