import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TimeInput } from '@/components/common/TimeInput'
import { AnimalAvatar } from '@/components/common/AnimalAvatar'
import { dayOpening, effectiveDayEnd, normalizeRequirements } from '@/domain/requirements'
import { fmtDuration, toHHMM } from '@/domain/time'
import { DAY_LABELS, type DayIndex, type Shift, type Week } from '@/domain/types'

export interface ShiftDialogTarget {
  employeeId: string
  day: DayIndex
  shift: Shift | null
}

interface Props {
  week: Week
  target: ShiftDialogTarget
  onClose: () => void
  onSave: (shift: Shift | null) => void
}

export function ShiftDialog({ week, target, onClose, onSave }: Props) {
  const employee = week.config.employees.find((e) => e.id === target.employeeId)!
  const opening = dayOpening(normalizeRequirements(week.config.requirements[target.day] ?? []))
  const initial: Shift = useMemo(() => {
    if (target.shift) return target.shift
    const start = opening?.open ?? week.config.rules.dayStart
    const dur = employee.fixedDailyMinutes ?? Math.min(employee.maxDailyMinutes, Math.round(employee.weeklyMinutes / Math.max(1, employee.workDays.length) / 15) * 15)
    const end = Math.min(effectiveDayEnd(week.config), start + dur + employee.breakMinutes)
    return { start, end, breakStart: employee.breakMinutes > 0 ? Math.round((start + end) / 2 / 15) * 15 - 30 : null, locked: true }
  }, [target, employee, opening, week.config.rules])

  const [shift, setShift] = useState<Shift>(initial)
  const worked = shift.end - shift.start - (shift.breakStart != null ? employee.breakMinutes : 0)
  const valid = shift.end > shift.start && (shift.breakStart == null || (shift.breakStart > shift.start && shift.breakStart + employee.breakMinutes < shift.end))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AnimalAvatar animal={employee.avatar} color={employee.color} size="md" />
            {employee.name} · {DAY_LABELS[target.day]}
          </DialogTitle>
          <DialogDescription>
            {opening ? `Besoins de ${toHHMM(opening.open)} à ${toHHMM(opening.close)}.` : 'Aucun besoin défini ce jour.'}
            {employee.fixedDailyMinutes != null && ` Journée fixe de ${fmtDuration(employee.fixedDailyMinutes)}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Arrivée</Label>
            <TimeInput value={shift.start} onChange={(v) => v != null && setShift({ ...shift, start: v })} />
          </div>
          <div className="space-y-1">
            <Label>Départ</Label>
            <TimeInput value={shift.end} onChange={(v) => v != null && setShift({ ...shift, end: v })} />
          </div>
          {employee.breakMinutes > 0 && (
            <div className="col-span-2 space-y-1">
              <Label>Début de pause ({fmtDuration(employee.breakMinutes)}) — vide = pas de pause</Label>
              <TimeInput value={shift.breakStart} allowEmpty onChange={(v) => setShift({ ...shift, breakStart: v })} />
            </div>
          )}
          <div className="col-span-2 flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="locked">Verrouiller ce créneau</Label>
              <p className="text-xs text-muted-foreground">Le générateur ne le modifiera pas.</p>
            </div>
            <Switch id="locked" checked={!!shift.locked} onCheckedChange={(c) => setShift({ ...shift, locked: c })} />
          </div>
          <p className="col-span-2 text-sm text-muted-foreground">
            Temps de travail : <b className="text-foreground">{fmtDuration(Math.max(0, worked))}</b>
            {!valid && <span className="ml-2 text-red-700">Horaires incohérents.</span>}
          </p>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="destructive" onClick={() => onSave(null)} disabled={!target.shift}>Supprimer</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button onClick={() => onSave(shift)} disabled={!valid}>Enregistrer</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
