import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Eraser, Loader2, Printer, Sparkles, Wand2, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { compile } from '@/domain/model'
import { evaluate } from '@/domain/evaluate'
import { requiredMinutes } from '@/domain/requirements'
import { fmtDuration } from '@/domain/time'
import type { DayIndex, Shift } from '@/domain/types'
import { useCurrentWeek, useStore } from '@/store/useStore'
import { useSolver } from '@/store/useSolver'
import { mondayISO, weekIdOf, weekLabel } from '@/store/weekKey'
import { parseISO } from 'date-fns'
import { DayBoard } from './DayBoard'
import { ShiftDialog, type ShiftDialogTarget } from './ShiftDialog'
import { SummaryTable } from './SummaryTable'
import { Diagnostics } from './Diagnostics'
import { Suggestions } from './Suggestions'
import { Legend } from './Legend'
import { computeSuggestions, type Suggestion } from '@/domain/suggestions'

export function PlanningTab({ onGoTo }: { onGoTo: (tab: string) => void }) {
  const week = useCurrentWeek()
  if (!week) return <CreateWeekCard />
  return <WeekPlanning weekId={week.id} onGoTo={onGoTo} />
}

function CreateWeekCard() {
  const pendingMonday = useStore((s) => s.pendingMonday) ?? mondayISO(new Date())
  const weeks = useStore((s) => s.weeks)
  const createWeek = useStore((s) => s.createWeek)
  const date = parseISO(pendingMonday)
  const prevId = weekIdOf(new Date(date.getTime() - 7 * 86400000))
  const prev = weeks[prevId]
  const sorted = Object.values(weeks).sort((a, b) => b.monday.localeCompare(a.monday))
  const latest = sorted[0]
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{weekLabel(pendingMonday)}</CardTitle>
        <CardDescription>Cette semaine n’existe pas encore. Choisissez comment la créer.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button onClick={() => createWeek(date, { kind: 'template' })}>
          <Sparkles /> Créer depuis les réglages par défaut
        </Button>
        {prev && (
          <Button variant="outline" onClick={() => createWeek(date, { kind: 'copy', weekId: prev.id })}>
            Copier la semaine précédente ({weekLabel(prev.monday)})
          </Button>
        )}
        {latest && latest.id !== prevId && (
          <Button variant="outline" onClick={() => createWeek(date, { kind: 'copy', weekId: latest.id })}>
            Copier la dernière semaine ({weekLabel(latest.monday)})
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Une copie reprend l’équipe, les besoins, les congés, les contraintes et le planning de la semaine source. Les réglages par défaut reprennent l’équipe, les enfants, les règles et les besoins types.
        </p>
      </CardContent>
    </Card>
  )
}

function WeekPlanning({ weekId, onGoTo }: { weekId: string; onGoTo: (tab: string) => void }) {
  const week = useStore((s) => s.weeks[weekId])
  const setSchedule = useStore((s) => s.setSchedule)
  const updateShift = useStore((s) => s.updateShift)
  const updateWeekConfig = useStore((s) => s.updateWeekConfig)
  const clearSchedule = useStore((s) => s.clearSchedule)
  const setStatus = useStore((s) => s.setStatus)
  const solver = useSolver()
  const [target, setTarget] = useState<ShiftDialogTarget | null>(null)

  const { config, schedule } = week
  const evaluation = useMemo(() => {
    const { model, shifts } = compile(config, schedule)
    return evaluate(model, shifts)
  }, [config, schedule])

  const suggestions = useMemo(() => computeSuggestions(config, schedule, evaluation), [config, schedule, evaluation])
  const applySuggestion = (s: Suggestion) => {
    if (!s.apply) return
    if (s.apply.config) updateWeekConfig(weekId, s.apply.config)
    for (const sh of s.apply.shifts ?? []) updateShift(weekId, sh.employeeId, sh.day, sh.shift)
    toast.success('Suggestion appliquée.')
  }

  const activeEmployees = config.employees.filter((e) => e.active)
  const hasSchedule = Object.values(schedule).some((row) => Object.values(row).some(Boolean))

  const budget = useMemo(() => {
    const required = config.rules.openDays.reduce((acc: number, d) => {
      const cl = config.cleaning?.[d]
      const cleaners = cl && cl.minutes > 0 ? cl.employeeIds.filter((id) => activeEmployees.some((e) => e.id === id && e.workDays.includes(d) && !config.leaves.some((l) => l.employeeId === id && l.day === d))).length : 0
      return acc + requiredMinutes(config.requirements[d] ?? []) + (cl ? cl.minutes * cleaners : 0)
    }, 0)
    const available = activeEmployees.reduce((acc, e) => {
      const leave = config.leaves.filter((l) => l.employeeId === e.id).reduce((a, l) => a + l.minutes, 0)
      return acc + Math.max(0, e.weeklyMinutes - leave)
    }, 0)
    return { required, available }
  }, [config, activeEmployees])

  const generate = async (fresh: boolean) => {
    try {
      const result = await solver.run(config, schedule, fresh)
      setSchedule(weekId, result)
      const { model, shifts } = compile(config, result)
      const ev = evaluate(model, shifts)
      const errors = ev.violations.filter((v) => v.severity === 'error').length
      if (errors === 0) toast.success('Planning généré sans contrainte bloquante.')
      else toast.warning(`Planning généré avec ${errors} point${errors > 1 ? 's' : ''} à vérifier.`)
    } catch (e) {
      if ((e as Error).message !== 'Annulé') toast.error(`Erreur : ${(e as Error).message}`)
    }
  }

  const errors = evaluation.violations.filter((v) => v.severity === 'error').length
  const warnings = evaluation.violations.filter((v) => v.severity === 'warning').length

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button onClick={() => generate(true)} disabled={solver.running || activeEmployees.length === 0}>
          {solver.running ? <Loader2 className="animate-spin" /> : <Sparkles />} Générer<span className="hidden sm:inline"> le planning</span>
        </Button>
        <Button variant="outline" onClick={() => generate(false)} disabled={solver.running || !hasSchedule}>
          <Wand2 /> Améliorer<span className="hidden sm:inline"> l’existant</span>
        </Button>
        <Button variant="ghost" onClick={() => clearSchedule(weekId, true)} disabled={solver.running || !hasSchedule} title="Efface le planning en gardant les créneaux verrouillés">
          <Eraser /> Effacer<span className="hidden lg:inline"> (garde les créneaux verrouillés)</span>
        </Button>
        <div className="flex items-center gap-2 sm:ml-auto">
          {week.status === 'validated' ? (
            <Button variant="secondary" onClick={() => setStatus(weekId, 'draft')}>Repasser en brouillon</Button>
          ) : (
            <Button variant="secondary" onClick={() => setStatus(weekId, 'validated')} disabled={!hasSchedule}>
              <CheckCircle2 /> Valider<span className="hidden sm:inline"> la semaine</span>
            </Button>
          )}
          <Button variant="outline" className="hidden sm:inline-flex" onClick={() => window.print()} disabled={!hasSchedule}><Printer /> Imprimer</Button>
        </div>
      </div>

      {solver.running && (
        <div className="no-print flex items-center gap-3 rounded-lg border bg-background p-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(solver.progress * 100)}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">Recherche de la meilleure solution… {Math.round(solver.progress * 100)} %</span>
          <Button size="sm" variant="ghost" onClick={solver.cancel}><X /> Annuler</Button>
        </div>
      )}

      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">{weekLabel(week.monday)}</h2>
      </div>

      {activeEmployees.length === 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Aucune membre de l’équipe active</AlertTitle>
          <AlertDescription>
            Ajoutez des personnes dans l’onglet <button className="underline" onClick={() => onGoTo('employees')}>Équipe</button> avant de générer un planning.
          </AlertDescription>
        </Alert>
      )}

      {budget.available < budget.required && (
        <Alert className="no-print">
          <AlertTriangle />
          <AlertTitle>Les contrats ne couvrent pas les besoins de la semaine</AlertTitle>
          <AlertDescription>
            Besoins : {fmtDuration(budget.required)} de présence (ménage inclus) · Disponible (contrats − congés) : {fmtDuration(budget.available)}.
            Il manque {fmtDuration(budget.required - budget.available)} : le planning comportera des heures supplémentaires ou des créneaux non couverts.
            Vous pouvez ajuster les <button className="underline" onClick={() => onGoTo('week')}>besoins de la semaine</button>.
          </AlertDescription>
        </Alert>
      )}
      {budget.available >= budget.required && budget.required > 0 && (
        <p className="no-print text-xs text-muted-foreground">
          Besoins : {fmtDuration(budget.required)} de présence (ménage inclus) · Disponible (contrats − congés) : {fmtDuration(budget.available)}.
        </p>
      )}

      {hasSchedule && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {errors === 0 && warnings === 0 ? (
            <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="size-4" /> Toutes les contraintes sont respectées.</span>
          ) : (
            <>
              {errors > 0 && <span className="rounded-md bg-red-100 px-2 py-0.5 text-red-800">{errors} contrainte{errors > 1 ? 's' : ''} non respectée{errors > 1 ? 's' : ''}</span>}
              {warnings > 0 && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800">{warnings} avertissement{warnings > 1 ? 's' : ''}</span>}
            </>
          )}
        </div>
      )}

      {hasSchedule && <Legend />}

      <div className="grid min-w-0 gap-4">
        {config.rules.openDays.map((d) => (
          <DayBoard
            key={d}
            day={d}
            week={week}
            coverage={evaluation.coverage.find((c) => c.day === d)}
            onEdit={(employeeId, day, shift) => setTarget({ employeeId, day, shift })}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <SummaryTable week={week} stats={evaluation.stats} />
        </div>
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Diagnostics violations={evaluation.violations} />
          <Suggestions suggestions={suggestions} onApply={applySuggestion} />
        </div>
      </div>

      {target && (
        <ShiftDialog
          week={week}
          target={target}
          onClose={() => setTarget(null)}
          onSave={(shift: Shift | null) => {
            updateShift(weekId, target.employeeId, target.day as DayIndex, shift)
            setTarget(null)
          }}
        />
      )}
    </div>
  )
}
