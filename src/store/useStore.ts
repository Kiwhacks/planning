import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildExampleTemplate, buildExampleWeekExtras, migrateTemplate, migrateWeekConfig, weekConfigFromTemplate } from '@/domain/defaults'
import type { DayIndex, Schedule, Shift, TemplateConfig, Week, WeekConfig, WeekStatus } from '@/domain/types'
import { mondayISO, weekIdOf } from './weekKey'

export interface PersistedData {
  version: 1
  template: TemplateConfig
  weeks: Record<string, Week>
}

export interface SyncState {
  /** unknown = chargement, local = navigateur seul, remote = base de données, auth = code d'accès requis */
  mode: 'unknown' | 'local' | 'remote' | 'auth'
  status: 'idle' | 'saving' | 'saved' | 'error'
  error: string | null
}

interface StoreState {
  template: TemplateConfig
  weeks: Record<string, Week>
  currentWeekId: string | null
  /** Lundi (YYYY-MM-DD) d'une semaine affichée mais pas encore créée. */
  pendingMonday: string | null
  sync: SyncState

  setSync: (s: Partial<SyncState>) => void
  /** Remplace les données par celles de la base (sans déclencher de sauvegarde). */
  hydrate: (data: { template: TemplateConfig; weeks: Record<string, Week> }) => void

  setPendingMonday: (m: string | null) => void
  setCurrentWeek: (id: string | null) => void
  createWeek: (date: Date, source: { kind: 'template' } | { kind: 'copy'; weekId: string }) => string
  deleteWeek: (id: string) => void
  updateWeekConfig: (id: string, fn: (c: WeekConfig) => void) => void
  setSchedule: (id: string, schedule: Schedule) => void
  updateShift: (id: string, employeeId: string, day: DayIndex, shift: Shift | null) => void
  clearSchedule: (id: string, keepLocked: boolean) => void
  setStatus: (id: string, status: WeekStatus) => void
  saveWeekAsTemplate: (id: string) => void
  resetWeekFromTemplate: (id: string) => void
  updateTemplate: (fn: (t: TemplateConfig) => void) => void
  exportData: () => PersistedData
  importData: (data: PersistedData) => void
}

function initialState(): Pick<StoreState, 'template' | 'weeks' | 'currentWeekId'> {
  const template = buildExampleTemplate()
  const now = new Date()
  const id = weekIdOf(now)
  const extras = buildExampleWeekExtras()
  const week: Week = {
    id,
    monday: mondayISO(now),
    config: { ...weekConfigFromTemplate(template), ...extras, notes: 'Semaine d’exemple : congés et contraintes fixes pré-remplis.' },
    schedule: {},
    status: 'draft',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
  return { template, weeks: { [id]: week }, currentWeekId: id }
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...initialState(),
      pendingMonday: null,
      sync: { mode: 'unknown', status: 'idle', error: null },

      setSync: (p) => set({ sync: { ...get().sync, ...p } }),
      hydrate: ({ template, weeks }) => {
        const current = get().currentWeekId
        const ids = Object.keys(weeks).sort((a, b) => b.localeCompare(a))
        set({ template, weeks, currentWeekId: current && weeks[current] ? current : ids[0] ?? null, pendingMonday: null })
      },

      setPendingMonday: (m) => set({ pendingMonday: m }),
      setCurrentWeek: (id) => set({ currentWeekId: id, pendingMonday: id ? null : get().pendingMonday }),

      createWeek: (date, source) => {
        const id = weekIdOf(date)
        const state = get()
        if (state.weeks[id]) {
          set({ currentWeekId: id })
          return id
        }
        let config: WeekConfig
        let schedule: Schedule = {}
        if (source.kind === 'copy' && state.weeks[source.weekId]) {
          const src = state.weeks[source.weekId]
          config = structuredClone(src.config)
          schedule = structuredClone(src.schedule)
        } else {
          config = weekConfigFromTemplate(state.template)
        }
        const now = new Date().toISOString()
        const week: Week = { id, monday: mondayISO(date), config, schedule, status: 'draft', createdAt: now, updatedAt: now }
        set({ weeks: { ...state.weeks, [id]: week }, currentWeekId: id, pendingMonday: null })
        return id
      },

      deleteWeek: (id) => {
        const weeks = { ...get().weeks }
        delete weeks[id]
        set({ weeks, currentWeekId: get().currentWeekId === id ? null : get().currentWeekId })
      },

      updateWeekConfig: (id, fn) => {
        const w = get().weeks[id]
        if (!w) return
        const config = structuredClone(w.config)
        fn(config)
        set({ weeks: { ...get().weeks, [id]: { ...w, config, updatedAt: new Date().toISOString() } } })
      },

      setSchedule: (id, schedule) => {
        const w = get().weeks[id]
        if (!w) return
        set({ weeks: { ...get().weeks, [id]: { ...w, schedule, updatedAt: new Date().toISOString() } } })
      },

      updateShift: (id, employeeId, day, shift) => {
        const w = get().weeks[id]
        if (!w) return
        const schedule: Schedule = { ...w.schedule, [employeeId]: { ...(w.schedule[employeeId] ?? {}), [day]: shift } }
        set({ weeks: { ...get().weeks, [id]: { ...w, schedule, updatedAt: new Date().toISOString() } } })
      },

      clearSchedule: (id, keepLocked) => {
        const w = get().weeks[id]
        if (!w) return
        const schedule: Schedule = {}
        if (keepLocked) {
          for (const [eid, row] of Object.entries(w.schedule)) {
            const kept: Schedule[string] = {}
            for (const [d, sh] of Object.entries(row)) if (sh?.locked) kept[Number(d) as DayIndex] = sh
            if (Object.keys(kept).length) schedule[eid] = kept
          }
        }
        set({ weeks: { ...get().weeks, [id]: { ...w, schedule, updatedAt: new Date().toISOString() } } })
      },

      setStatus: (id, status) => {
        const w = get().weeks[id]
        if (!w) return
        set({ weeks: { ...get().weeks, [id]: { ...w, status, updatedAt: new Date().toISOString() } } })
      },

      saveWeekAsTemplate: (id) => {
        const w = get().weeks[id]
        if (!w) return
        const { employees, children, rules, requirements, cleaning } = structuredClone(w.config)
        set({ template: { employees, children, rules, requirements, cleaning } })
      },

      resetWeekFromTemplate: (id) => {
        const w = get().weeks[id]
        if (!w) return
        const t = structuredClone(get().template)
        set({ weeks: { ...get().weeks, [id]: { ...w, config: { ...w.config, ...t }, updatedAt: new Date().toISOString() } } })
      },

      updateTemplate: (fn) => {
        const template = structuredClone(get().template)
        fn(template)
        set({ template })
      },

      exportData: () => ({ version: 1, template: get().template, weeks: get().weeks }),

      importData: (data) => {
        if (!data || data.version !== 1 || !data.template || !data.weeks) throw new Error('Fichier invalide')
        const weeks: Record<string, Week> = {}
        for (const w of Object.values(data.weeks)) weeks[w.id] = { ...w, config: migrateWeekConfig(w.config), schedule: w.schedule ?? {} }
        set({ template: migrateTemplate(data.template), weeks, currentWeekId: Object.keys(weeks).sort((a, b) => b.localeCompare(a))[0] ?? null })
      },
    }),
    {
      name: 'planning-creche-v1',
      version: 1,
      partialize: (s) => ({ template: s.template, weeks: s.weeks, currentWeekId: s.currentWeekId }) as unknown as StoreState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<StoreState, 'template' | 'weeks' | 'currentWeekId'>>
        const weeks: Record<string, Week> = {}
        for (const w of Object.values(p.weeks ?? {})) weeks[w.id] = { ...w, config: migrateWeekConfig(w.config), schedule: w.schedule ?? {} }
        return {
          ...current,
          template: p.template ? migrateTemplate(p.template) : current.template,
          weeks: p.weeks ? weeks : current.weeks,
          currentWeekId: p.currentWeekId ?? current.currentWeekId,
        }
      },
    },
  ),
)

export function useCurrentWeek(): Week | null {
  return useStore((s) => (s.currentWeekId ? s.weeks[s.currentWeekId] ?? null : null))
}
