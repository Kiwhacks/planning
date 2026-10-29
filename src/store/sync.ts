import { migrateTemplate, migrateWeekConfig } from '@/domain/defaults'
import type { Week } from '@/domain/types'
import { api, ApiError, setAccessKey } from './api'
import { useStore } from './useStore'

/**
 * Synchronisation avec l'API (base Neon) :
 *  - au démarrage : charge les données distantes (ou initialise la base avec les données locales) ;
 *  - ensuite : chaque modification de semaine / réglages est envoyée (avec un léger délai de regroupement).
 * Sans API (développement avec `vite dev`, ou DATABASE_URL absente), l'application reste en mode local.
 */

let started = false
let hydrating = false
let unsubscribe: (() => void) | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const tasks = new Map<string, () => Promise<unknown>>()
let chain: Promise<void> = Promise.resolve()
let retryTimer: ReturnType<typeof setTimeout> | null = null

function setSync(partial: Partial<ReturnType<typeof useStore.getState>['sync']>) {
  useStore.getState().setSync(partial)
}

export async function startSync(): Promise<void> {
  if (started) return
  started = true
  setSync({ mode: 'unknown', status: 'idle', error: null })
  try {
    const remote = await api.load()
    const store = useStore.getState()
    if (!remote.template) {
      // base vide : on l'initialise avec les données locales
      await api.replaceAll(store.exportData())
    } else {
      hydrating = true
      try {
        const weeks: Record<string, Week> = {}
        for (const w of Object.values(remote.weeks)) weeks[w.id] = { ...w, config: migrateWeekConfig(w.config), schedule: w.schedule ?? {} }
        store.hydrate({ template: migrateTemplate(remote.template), weeks })
      } finally {
        hydrating = false
      }
    }
    setSync({ mode: 'remote', status: 'saved', error: null })
    subscribe()
  } catch (e) {
    started = false
    if (e instanceof ApiError && e.status === 401) setSync({ mode: 'auth', status: 'idle' })
    else setSync({ mode: 'local', status: 'idle', error: e instanceof ApiError && e.status >= 500 ? e.message : null })
  }
}

export async function retryWithKey(key: string): Promise<void> {
  setAccessKey(key)
  await startSync()
}

function subscribe() {
  unsubscribe?.()
  unsubscribe = useStore.subscribe((state, prev) => {
    if (hydrating || state.sync.mode !== 'remote') return
    if (state.template !== prev.template) queue('template', () => api.saveTemplate(useStore.getState().template))
    for (const id of Object.keys(state.weeks)) {
      if (state.weeks[id] !== prev.weeks[id]) {
        queue(`week:${id}`, () => {
          const w = useStore.getState().weeks[id]
          return w ? api.saveWeek(w) : Promise.resolve()
        })
      }
    }
    for (const id of Object.keys(prev.weeks)) {
      if (!state.weeks[id]) queue(`week:${id}`, () => api.deleteWeek(id))
    }
  })
}

function queue(key: string, task: () => Promise<unknown>) {
  tasks.set(key, task)
  const t = timers.get(key)
  if (t) clearTimeout(t)
  setSync({ status: 'saving' })
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      const fn = tasks.get(key)
      tasks.delete(key)
      if (!fn) return
      chain = chain.then(async () => {
        try {
          await fn()
          if (timers.size === 0 && tasks.size === 0) setSync({ status: 'saved', error: null })
        } catch (e) {
          // on remet la tâche en attente et on réessaie plus tard
          tasks.set(key, fn)
          setSync({ status: 'error', error: e instanceof Error ? e.message : String(e) })
          if (e instanceof ApiError && e.status === 401) setSync({ mode: 'auth' })
          scheduleRetry()
        }
      })
    }, 600),
  )
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    flush()
  }, 8000)
}

/** Relance immédiatement les sauvegardes en attente (après une erreur). */
export function flush(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  for (const [key, fn] of [...tasks.entries()]) {
    if (timers.has(key)) continue
    tasks.delete(key)
    setSync({ status: 'saving' })
    chain = chain.then(async () => {
      try {
        await fn()
        if (timers.size === 0 && tasks.size === 0) setSync({ status: 'saved', error: null })
      } catch (e) {
        tasks.set(key, fn)
        setSync({ status: 'error', error: e instanceof Error ? e.message : String(e) })
        if (e instanceof ApiError && e.status === 401) setSync({ mode: 'auth' })
        scheduleRetry()
      }
    })
  }
}
