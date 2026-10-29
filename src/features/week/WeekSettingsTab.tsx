import { Copy, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DurationInput } from '@/components/common/DurationInput'
import { EmployeeSelect } from '@/components/common/EmployeeSelect'
import { SectionCard } from '@/components/common/SectionCard'
import { TimeInput } from '@/components/common/TimeInput'
import { newId } from '@/domain/defaults'
import { dayOpening, normalizeRequirements, requiredMinutes, requirementsFromChildren } from '@/domain/requirements'
import { fmtDuration, h, toHHMM } from '@/domain/time'
import { DAY_LABELS, type DayIndex, type Leave, type Pin, type Week } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { cn } from '@/lib/utils'
import { AnimalAvatar } from '@/components/common/AnimalAvatar'
import { TemplateBanner } from './TemplateBanner'

export function WeekSettingsTab({ week }: { week: Week }) {
  const update = useStore((s) => s.updateWeekConfig)
  const { config } = week
  const employees = config.employees.filter((e) => e.active)
  const days = config.rules.openDays

  return (
    <div className="space-y-4">
      <TemplateBanner week={week} what="Besoins, congés et contraintes" />

      <SectionCard
        title="Besoins en personnel par jour"
        description="Nombre de personnes présentes requis sur chaque plage. Les besoins types sont repris des réglages par défaut ; ajustez-les pour cette semaine."
        actions={
          config.children.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                update(week.id, (c) => {
                  for (const d of c.rules.openDays) c.requirements[d] = requirementsFromChildren(c.children, d, c.rules)
                })
                toast.success('Besoins recalculés depuis les présences des enfants.')
              }}
            >
              <Wand2 /> Calculer depuis les enfants
            </Button>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => {
            const reqs = config.requirements[d] ?? []
            return (
              <div key={d} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-medium">{DAY_LABELS[d]}</h3>
                  <span className="text-xs text-muted-foreground">{fmtDuration(requiredMinutes(normalizeRequirements(reqs)))} de présence</span>
                </div>
                <div className="space-y-1.5">
                  {reqs.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_3.5rem_1.75rem] items-center gap-1">
                      <TimeInput value={r.start} onChange={(v) => v != null && update(week.id, (c) => { c.requirements[d]![i].start = v })} />
                      <TimeInput value={r.end} onChange={(v) => v != null && update(week.id, (c) => { c.requirements[d]![i].end = v })} />
                      <Input
                        type="number"
                        min={1}
                        max={9}
                        value={r.staff}
                        onChange={(e) => update(week.id, (c) => { c.requirements[d]![i].staff = Math.max(1, Number(e.target.value) || 1) })}
                        title="Personnes requises"
                      />
                      <Button size="icon-sm" variant="ghost" aria-label="Supprimer" onClick={() => update(week.id, (c) => { c.requirements[d]!.splice(i, 1) })}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {reqs.length === 0 && <p className="text-xs text-muted-foreground italic">Aucun besoin : la structure est considérée fermée ce jour.</p>}
                </div>
                <CleaningEditor week={week} day={d} />
                <div className="mt-2 flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update(week.id, (c) => {
                        const list = (c.requirements[d] ??= [])
                        const last = list[list.length - 1]
                        list.push({ start: last ? last.end : h(8), end: last ? Math.min(last.end + 60, c.rules.dayEnd) : h(18), staff: last ? last.staff : 1 })
                      })
                    }
                  >
                    <Plus /> Plage
                  </Button>
                  <Select onValueChange={(v) => update(week.id, (c) => { c.requirements[Number(v) as DayIndex] = structuredClone(c.requirements[d] ?? []) })}>
                    <SelectTrigger size="sm" className="h-7" aria-label="Copier vers">
                      <Copy className="size-3.5" />
                      <SelectValue placeholder="Copier vers…" />
                    </SelectTrigger>
                    <SelectContent>
                      {days.filter((x) => x !== d).map((x) => <SelectItem key={x} value={String(x)}>{DAY_LABELS[x]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Congés et absences"
          description="La journée n'est pas travaillée ; les heures indiquées comptent dans le contrat hebdomadaire."
          actions={
            <Button
              size="sm"
              disabled={employees.length === 0}
              onClick={() =>
                update(week.id, (c) => {
                  const e = c.employees.find((x) => x.active)!
                  const perDay = Math.round(e.weeklyMinutes / Math.max(1, e.workDays.length) / 15) * 15
                  const lv: Leave = { id: newId('lv'), employeeId: e.id, day: c.rules.openDays[0] ?? 0, minutes: e.fixedDailyMinutes ?? perDay, label: 'Congé' }
                  c.leaves.push(lv)
                })
              }
            >
              <Plus /> Ajouter
            </Button>
          }
        >
          <div className="space-y-2">
            {config.leaves.length === 0 && <p className="text-sm text-muted-foreground italic">Aucune absence cette semaine.</p>}
            {config.leaves.map((lv) => (
              <div key={lv.id} className="grid grid-cols-[1fr_1fr_1.75rem] items-center gap-1.5 sm:grid-cols-[1fr_1fr_5rem_1fr_1.75rem]">
                <EmployeeSelect
                  employees={employees}
                  value={lv.employeeId}
                  onChange={(id) =>
                    update(week.id, (c) => {
                      const l = c.leaves.find((x) => x.id === lv.id)!
                      l.employeeId = id ?? l.employeeId
                      const e = c.employees.find((x) => x.id === l.employeeId)
                      if (e) l.minutes = e.fixedDailyMinutes ?? Math.round(e.weeklyMinutes / Math.max(1, e.workDays.length) / 15) * 15
                    })
                  }
                />
                <DaySelect value={lv.day} days={days} onChange={(d) => update(week.id, (c) => { c.leaves.find((x) => x.id === lv.id)!.day = d })} />
                <Button size="icon-sm" variant="ghost" className="sm:order-last" aria-label="Supprimer" onClick={() => update(week.id, (c) => { c.leaves = c.leaves.filter((x) => x.id !== lv.id) })}><Trash2 /></Button>
                <DurationInput value={lv.minutes} onChange={(m) => m != null && update(week.id, (c) => { c.leaves.find((x) => x.id === lv.id)!.minutes = m })} />
                <Input className="col-span-2 sm:col-span-1" value={lv.label} placeholder="Motif" onChange={(e) => update(week.id, (c) => { c.leaves.find((x) => x.id === lv.id)!.label = e.target.value })} />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Colonnes : personne · jour · heures comptées · motif.</p>
          </div>
        </SectionCard>

        <SectionCard
          title="Contraintes fixes"
          description="Imposer une heure d'arrivée ou de départ, obliger ou interdire une journée (ex. « Fanny ouvre à 6h45 mardi »)."
          actions={
            <Button
              size="sm"
              disabled={employees.length === 0}
              onClick={() =>
                update(week.id, (c) => {
                  const p: Pin = { id: newId('pin'), employeeId: c.employees.find((x) => x.active)!.id, day: c.rules.openDays[0] ?? 0, start: null, end: null, mustWork: true, note: '' }
                  c.pins.push(p)
                })
              }
            >
              <Plus /> Ajouter
            </Button>
          }
        >
          <div className="space-y-2">
            {config.pins.length === 0 && <p className="text-sm text-muted-foreground italic">Aucune contrainte fixe cette semaine.</p>}
            {config.pins.map((p) => (
              <div key={p.id} className="space-y-1.5 rounded-md border p-2">
                <div className="grid grid-cols-[1fr_1fr_1.75rem] items-center gap-1.5 sm:grid-cols-[1fr_1fr_1fr_1.75rem]">
                  <EmployeeSelect employees={employees} value={p.employeeId} onChange={(id) => id && update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.employeeId = id })} />
                  <DaySelect value={p.day} days={days} onChange={(d) => update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.day = d })} />
                  <Button size="icon-sm" variant="ghost" className="sm:order-last" aria-label="Supprimer" onClick={() => update(week.id, (c) => { c.pins = c.pins.filter((x) => x.id !== p.id) })}><Trash2 /></Button>
                  <Select value={p.mustWork === null ? 'free' : p.mustWork ? 'work' : 'off'} onValueChange={(v) => update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.mustWork = v === 'free' ? null : v === 'work' })}>
                    <SelectTrigger className="col-span-2 w-full sm:col-span-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="work">Travaille ce jour</SelectItem>
                      <SelectItem value="off">Ne travaille pas</SelectItem>
                      <SelectItem value="free">Au choix</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {p.mustWork !== false && (
                  <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1.5 sm:grid-cols-[auto_1fr_auto_1fr_1.5fr]">
                    <Label className="text-xs">Arrive à</Label>
                    <TimeInput value={p.start} allowEmpty onChange={(v) => update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.start = v })} />
                    <Label className="text-xs">Part à</Label>
                    <TimeInput value={p.end} allowEmpty onChange={(v) => update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.end = v })} />
                    <Input className="col-span-4 sm:col-span-1" value={p.note} placeholder="Note (ex. ouvre)" onChange={(e) => update(week.id, (c) => { c.pins.find((x) => x.id === p.id)!.note = e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Notes de la semaine">
        <Textarea value={config.notes} rows={3} placeholder="Informations utiles pour cette semaine…" onChange={(e) => update(week.id, (c) => { c.notes = e.target.value })} />
      </SectionCard>
    </div>
  )
}

function DaySelect({ value, days, onChange }: { value: DayIndex; days: DayIndex[]; onChange: (d: DayIndex) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as DayIndex)}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {days.map((d) => <SelectItem key={d} value={String(d)}>{DAY_LABELS[d]}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function CleaningEditor({ week, day }: { week: Week; day: DayIndex }) {
  const update = useStore((s) => s.updateWeekConfig)
  const { config } = week
  const cl = config.cleaning?.[day] ?? { minutes: config.rules.defaultCleaningMinutes, employeeIds: [] }
  const close = dayOpening(normalizeRequirements(config.requirements[day] ?? []))?.close
  const candidates = config.employees.filter((e) => e.active && e.workDays.includes(day) && !config.leaves.some((l) => l.employeeId === e.id && l.day === day))
  const setCl = (fn: (c: { minutes: number; employeeIds: string[] }) => void) =>
    update(week.id, (c) => {
      c.cleaning ??= {}
      const cur = (c.cleaning[day] ??= { minutes: c.rules.defaultCleaningMinutes, employeeIds: [] })
      fn(cur)
    })
  return (
    <div className="mt-3 rounded-md bg-violet-50 p-2 text-xs dark:bg-violet-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-violet-700" />
        <span className="font-medium">Ménage</span>
        <DurationInput className="h-7 w-20" value={cl.minutes} onChange={(m) => m != null && setCl((c) => { c.minutes = m })} />
        <span className="text-muted-foreground">{close != null && cl.minutes > 0 ? `après ${toHHMM(close)} (jusqu’à ${toHHMM(close + cl.minutes)})` : 'après le départ du dernier enfant'}</span>
      </div>
      {cl.minutes > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-muted-foreground">Qui :</span>
          {candidates.map((e) => {
            const on = cl.employeeIds.includes(e.id)
            return (
              <button
                key={e.id}
                type="button"
                className={cn('inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 transition-colors', on ? 'border-transparent text-white' : 'border-border bg-background text-muted-foreground hover:bg-muted')}
                style={on ? { background: e.color } : undefined}
                onClick={() => setCl((c) => { c.employeeIds = on ? c.employeeIds.filter((x) => x !== e.id) : [...c.employeeIds, e.id] })}
              >
                <AnimalAvatar animal={e.avatar} size="xs" />
                {e.name}
              </button>
            )
          })}
          {candidates.length === 0 && <span className="text-muted-foreground italic">personne de disponible ce jour</span>}
        </div>
      )}
    </div>
  )
}
