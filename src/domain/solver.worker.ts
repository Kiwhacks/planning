import { compile, toSchedule } from './model'
import { solve } from './solver'
import type { Schedule, WeekConfig } from './types'

export interface SolveRequest {
  type: 'solve'
  config: WeekConfig
  existing: Schedule | null
  /** true = repartir de zéro (hors créneaux verrouillés). */
  fresh: boolean
  seed: number
  iterations?: number
  restarts?: number
}

export type SolveResponse =
  | { type: 'progress'; progress: number; bestCost: number }
  | { type: 'done'; schedule: Schedule; cost: number }
  | { type: 'error'; message: string }

self.onmessage = (ev: MessageEvent<SolveRequest>) => {
  const msg = ev.data
  if (msg.type !== 'solve') return
  try {
    const { model, shifts } = compile(msg.config, msg.existing)
    const base = msg.fresh ? shifts.map((row, i) => row.map((x, d) => (model.employees[i].frozen[d] ? x : null))) : shifts
    const result = solve(model, base, {
      seed: msg.seed,
      iterations: msg.iterations,
      restarts: msg.restarts,
      onProgress: (p) => {
        const r: SolveResponse = { type: 'progress', ...p }
        self.postMessage(r)
      },
    })
    const schedule = toSchedule(model, result.shifts, msg.existing)
    const done: SolveResponse = { type: 'done', schedule, cost: result.cost }
    self.postMessage(done)
  } catch (err) {
    const r: SolveResponse = { type: 'error', message: err instanceof Error ? err.message : String(err) }
    self.postMessage(r)
  }
}
