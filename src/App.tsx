import { useEffect, useState } from 'react'
import { Baby, CalendarDays, History, Settings2, SlidersHorizontal, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WeekNav } from '@/features/WeekNav'
import { PlanningTab } from '@/features/planning/PlanningTab'
import { WeekSettingsTab } from '@/features/week/WeekSettingsTab'
import { EmployeesTab } from '@/features/employees/EmployeesTab'
import { ChildrenTab } from '@/features/children/ChildrenTab'
import { RulesTab } from '@/features/rules/RulesTab'
import { HistoryTab } from '@/features/history/HistoryTab'
import { useCurrentWeek } from '@/store/useStore'
import { startSync } from '@/store/sync'
import { SyncStatus } from '@/features/SyncStatus'

export default function App() {
  const [tab, setTab] = useState('planning')
  const week = useCurrentWeek()
  useEffect(() => {
    void startSync()
  }, [])
  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <header className="no-print sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarDays className="size-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Planning crèche</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Plannings hebdomadaires sous contraintes</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-3">
            <WeekNav />
            <SyncStatus />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="no-print mb-3 grid h-auto w-full grid-cols-6 gap-1 bg-background p-1 shadow-xs sm:mb-4 sm:flex sm:flex-wrap sm:justify-start">
            <TabsTrigger value="planning" aria-label="Planning"><CalendarDays /><span className="hidden sm:inline">Planning</span></TabsTrigger>
            <TabsTrigger value="week" disabled={!week} aria-label="Semaine"><SlidersHorizontal /><span className="hidden sm:inline">Semaine</span></TabsTrigger>
            <TabsTrigger value="employees" disabled={!week} aria-label="Équipe"><Users /><span className="hidden sm:inline">Équipe</span></TabsTrigger>
            <TabsTrigger value="children" disabled={!week} aria-label="Enfants"><Baby /><span className="hidden sm:inline">Enfants</span></TabsTrigger>
            <TabsTrigger value="rules" disabled={!week} aria-label="Règles"><Settings2 /><span className="hidden sm:inline">Règles</span></TabsTrigger>
            <TabsTrigger value="history" aria-label="Historique"><History /><span className="hidden sm:inline">Historique</span></TabsTrigger>
          </TabsList>
          <TabsContent value="planning"><PlanningTab onGoTo={setTab} /></TabsContent>
          <TabsContent value="week">{week && <WeekSettingsTab week={week} />}</TabsContent>
          <TabsContent value="employees">{week && <EmployeesTab week={week} />}</TabsContent>
          <TabsContent value="children">{week && <ChildrenTab week={week} />}</TabsContent>
          <TabsContent value="rules">{week && <RulesTab week={week} />}</TabsContent>
          <TabsContent value="history"><HistoryTab onOpen={() => setTab('planning')} /></TabsContent>
        </Tabs>
        <footer className="no-print mt-6 text-center text-[11px] text-muted-foreground">
          Illustrations d’animaux : <a className="underline" href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">Twemoji</a> (CC‑BY 4.0).
        </footer>
      </main>
    </div>
  )
}
