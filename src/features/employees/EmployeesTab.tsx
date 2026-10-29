import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DayPicker } from '@/components/common/DayPicker'
import { DurationInput } from '@/components/common/DurationInput'
import { SectionCard } from '@/components/common/SectionCard'
import { EMPLOYEE_COLORS, makeEmployee } from '@/domain/defaults'
import { fmtDuration } from '@/domain/time'
import { DAY_SHORT, ROLE_LABELS, type Employee, type StaffRole, type Week } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { TemplateBanner } from '@/features/week/TemplateBanner'

export function EmployeesTab({ week }: { week: Week }) {
  const update = useStore((s) => s.updateWeekConfig)
  const [editing, setEditing] = useState<Employee | null>(null)
  const { employees, rules } = week.config

  const save = (e: Employee) => {
    update(week.id, (c) => {
      const i = c.employees.findIndex((x) => x.id === e.id)
      if (i >= 0) c.employees[i] = e
      else c.employees.push(e)
    })
    setEditing(null)
  }

  return (
    <div className="space-y-4">
      <TemplateBanner week={week} what="Équipe" />
      <SectionCard
        title="Équipe"
        description="Contrats, jours travaillés, pauses et règles individuelles."
        actions={<Button size="sm" onClick={() => setEditing(makeEmployee({ name: '' }, rules, employees.length))}><Plus /> Ajouter une personne</Button>}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Contrat</TableHead>
              <TableHead>Jours</TableHead>
              <TableHead>Journée</TableHead>
              <TableHead>Pause</TableHead>
              <TableHead>Particularités</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => (
              <TableRow key={e.id} className={!e.active ? 'opacity-50' : undefined}>
                <TableCell className="font-medium">
                  <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: e.color }} />
                  {e.name}
                  {!e.active && <Badge variant="outline" className="ml-2">inactif</Badge>}
                </TableCell>
                <TableCell>{ROLE_LABELS[e.role]}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDuration(e.weeklyMinutes)}</TableCell>
                <TableCell className="text-muted-foreground">{e.workDays.map((d) => DAY_SHORT[d]).join(' ')}</TableCell>
                <TableCell className="text-muted-foreground">
                  {e.fixedDailyMinutes != null ? `${fmtDuration(e.fixedDailyMinutes)} fixe` : `${fmtDuration(e.minDailyMinutes)} à ${fmtDuration(e.maxDailyMinutes)}`}
                  <span className="block text-xs">amplitude ≤ {fmtDuration(e.maxAmplitudeMinutes)}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{e.breakMinutes ? fmtDuration(e.breakMinutes) : 'aucune'}</TableCell>
                <TableCell className="space-x-1">
                  {!e.canBeAlone && <Badge variant="secondary">jamais seule</Badge>}
                  {e.role !== 'pro' && <Badge variant="secondary">hors taux d’encadrement</Badge>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="icon-sm" variant="ghost" aria-label="Modifier" onClick={() => setEditing(e)}><Pencil /></Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Supprimer"
                    onClick={() => {
                      if (confirm(`Supprimer ${e.name} de l’équipe de cette semaine ?`)) update(week.id, (c) => { c.employees = c.employees.filter((x) => x.id !== e.id) })
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {employees.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Aucune personne. Ajoutez votre équipe.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </SectionCard>

      {editing && <EmployeeDialog employee={editing} week={week} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  )
}

function EmployeeDialog({ employee, week, onClose, onSave }: { employee: Employee; week: Week; onClose: () => void; onSave: (e: Employee) => void }) {
  const [e, setE] = useState<Employee>(employee)
  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setE({ ...e, [k]: v })
  const isNew = !week.config.employees.some((x) => x.id === employee.id)
  const [fixed, setFixed] = useState(e.fixedDailyMinutes != null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Nouvelle personne' : `Modifier ${employee.name}`}</DialogTitle>
          <DialogDescription>Les durées se saisissent au format « 33h30 ».</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1">
              <Label>Prénom / nom</Label>
              <Input value={e.name} onChange={(ev) => set('name', ev.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Couleur</Label>
              <div className="flex gap-1">
                {EMPLOYEE_COLORS.map((c) => (
                  <button key={c} type="button" className="size-6 rounded-full border-2" style={{ background: c, borderColor: e.color === c ? '#000' : 'transparent' }} onClick={() => set('color', c)} aria-label={c} />
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Statut</Label>
              <Select value={e.role} onValueChange={(v) => set('role', v as StaffRole)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as StaffRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Apprenties et stagiaires ne comptent pas dans le taux d’encadrement.</p>
            </div>
            <div className="space-y-1">
              <Label>Heures hebdomadaires</Label>
              <DurationInput value={e.weeklyMinutes} onChange={(m) => m != null && set('weeklyMinutes', m)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Jours travaillés possibles</Label>
            <DayPicker value={e.workDays} onChange={(v) => set('workDays', v)} available={week.config.rules.openDays} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Durée de journée fixe</Label>
              <p className="text-xs text-muted-foreground">Chaque jour travaillé dure exactement la même durée (ex. 3h30).</p>
            </div>
            <Switch checked={fixed} onCheckedChange={(c) => { setFixed(c); set('fixedDailyMinutes', c ? e.weeklyMinutes / Math.max(1, e.workDays.length) : null) }} />
          </div>
          {fixed ? (
            <div className="space-y-1">
              <Label>Durée quotidienne</Label>
              <DurationInput value={e.fixedDailyMinutes} onChange={(m) => m != null && set('fixedDailyMinutes', m)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Journée minimale</Label>
                <DurationInput value={e.minDailyMinutes} onChange={(m) => m != null && set('minDailyMinutes', m)} />
              </div>
              <div className="space-y-1">
                <Label>Journée maximale</Label>
                <DurationInput value={e.maxDailyMinutes} onChange={(m) => m != null && set('maxDailyMinutes', m)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amplitude maximale</Label>
              <DurationInput value={e.maxAmplitudeMinutes} onChange={(m) => m != null && set('maxAmplitudeMinutes', m)} />
              <p className="text-xs text-muted-foreground">Arrivée → départ, pause incluse.</p>
            </div>
            <div className="space-y-1">
              <Label>Pause quotidienne</Label>
              <DurationInput value={e.breakMinutes} onChange={(m) => m != null && set('breakMinutes', m)} placeholder="0h = aucune" />
              <p className="text-xs text-muted-foreground">Non comptée dans le temps de travail.</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Peut ouvrir / fermer seule</Label>
              <p className="text-xs text-muted-foreground">Décochez si la personne ne doit jamais être seule.</p>
            </div>
            <Switch checked={e.canBeAlone} onCheckedChange={(c) => set('canBeAlone', c)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Active cette semaine</Label>
              <p className="text-xs text-muted-foreground">Une personne inactive est ignorée par le planning.</p>
            </div>
            <Switch checked={e.active} onCheckedChange={(c) => set('active', c)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={() => onSave(e)} disabled={!e.name.trim() || e.workDays.length === 0}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
