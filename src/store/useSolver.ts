import { useCallback, useEffect, useRef, useState } from 'react'
import type { SolveRequest, SolveResponse } from '@/domain/solver.worker'
import type { Schedule, WeekConfig } from '@/domain/types'

export interface SolverState {
  running: boolean
  progress: number
  bestCost: number | null
}

export function useSolver() {
  const workerRef = useRef<Worker | null>(null)
  const resolveRef = useRef<((s: Schedule) => void) | null>(null)
  const rejectRef = useRef<((e: Error) => void) | null>(null)
  const [state, setState] = useState<SolverState>({ running: false, progress: 0, bestCost: null })

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const w = new Worker(new URL('../domain/solver.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<SolveResponse>) => {
      const msg = ev.data
      if (msg.type === 'progress') setState({ running: true, progress: msg.progress, bestCost: msg.bestCost })
      else if (msg.type === 'done') {
        setState({ running: false, progress: 1, bestCost: msg.cost })
        resolveRef.current?.(msg.schedule)
        resolveRef.current = null
        rejectRef.current = null
      } else if (msg.type === 'error') {
        setState({ running: false, progress: 0, bestCost: null })
        rejectRef.current?.(new Error(msg.message))
        resolveRef.current = null
        rejectRef.current = null
      }
    }
    w.onerror = (e) => {
      setState({ running: false, progress: 0, bestCost: null })
      rejectRef.current?.(new Error(e.message))
    }
    workerRef.current = w
    return w
  }, [])

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    rejectRef.current?.(new Error('Annulé'))
    resolveRef.current = null
    rejectRef.current = null
    setState({ running: false, progress: 0, bestCost: null })
  }, [])

  const run = useCallback(
    (config: WeekConfig, existing: Schedule | null, fresh: boolean) =>
      new Promise<Schedule>((resolve, reject) => {
        const w = ensureWorker()
        resolveRef.current = resolve
        rejectRef.current = reject
        setState({ running: true, progress: 0, bestCost: null })
        const req: SolveRequest = { type: 'solve', config, existing, fresh, seed: Math.floor(Math.random() * 1e9), iterations: 300_000, restarts: 6 }
        w.postMessage(req)
      }),
    [ensureWorker],
  )

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { ...state, run, cancel }
}
