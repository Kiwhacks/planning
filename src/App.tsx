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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarDays className="size-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Planning crèche</h1>
              <p className="text-xs text-muted-foreground">Plannings hebdomadaires sous contraintes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <WeekNav />
            <SyncStatus />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="no-print mb-4 flex h-auto w-full flex-wrap justify-start gap-1 bg-background p-1 shadow-xs">
            <TabsTrigger value="planning"><CalendarDays />Planning</TabsTrigger>
            <TabsTrigger value="week" disabled={!week}><SlidersHorizontal />Semaine</TabsTrigger>
            <TabsTrigger value="employees" disabled={!week}><Users />Équipe</TabsTrigger>
            <TabsTrigger value="children" disabled={!week}><Baby />Enfants</TabsTrigger>
            <TabsTrigger value="rules" disabled={!week}><Settings2 />Règles</TabsTrigger>
            <TabsTrigger value="history"><History />Historique</TabsTrigger>
          </TabsList>
          <TabsContent value="planning"><PlanningTab onGoTo={setTab} /></TabsContent>
          <TabsContent value="week">{week && <WeekSettingsTab week={week} />}</TabsContent>
          <TabsContent value="employees">{week && <EmployeesTab week={week} />}</TabsContent>
          <TabsContent value="children">{week && <ChildrenTab week={week} />}</TabsContent>
          <TabsContent value="rules">{week && <RulesTab week={week} />}</TabsContent>
          <TabsContent value="history"><HistoryTab onOpen={() => setTab('planning')} /></TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
