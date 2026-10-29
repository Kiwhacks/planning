import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmployeeSelect } from '@/components/common/EmployeeSelect'
import { SectionCard } from '@/components/common/SectionCard'
import { TimeInput } from '@/components/common/TimeInput'
import { AnimalAvatar, AnimalPicker } from '@/components/common/AnimalAvatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { makeChild } from '@/domain/defaults'
import { h } from '@/domain/time'
import { DAY_SHORT, type Week } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { TemplateBanner } from '@/features/week/TemplateBanner'

export function ChildrenTab({ week }: { week: Week }) {
  const update = useStore((s) => s.updateWeekConfig)
  const { children, employees, rules } = week.config
  const active = employees.filter((e) => e.active)
  const days = rules.openDays

  return (
    <div className="space-y-4">
      <TemplateBanner week={week} what="Enfants" />
      <SectionCard
        title="Enfants, référentes et relais"
        description="Les présences servent à calculer les besoins en personnel (onglet Semaine → « Calculer depuis les enfants ») et le planning favorise la présence de la référente, sinon de la relais, pendant la présence de l'enfant."
        actions={<Button size="sm" onClick={() => update(week.id, (c) => { c.children.push(makeChild({ name: '' }, c.children)) })}><Plus /> Ajouter un enfant</Button>}
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-32">Enfant</TableHead>
                <TableHead className="min-w-36">Référente</TableHead>
                <TableHead className="min-w-36">Relais</TableHead>
                {days.map((d) => <TableHead key={d} className="min-w-44">{DAY_SHORT[d]}</TableHead>)}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {children.map((ch) => (
                <TableRow key={ch.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="rounded-full transition-transform hover:scale-110" title="Choisir un animal">
                            <AnimalAvatar animal={ch.avatar} color="#f59e0b" size="md" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <p className="mb-2 text-xs text-muted-foreground">Bébé animal de {ch.name || 'l’enfant'}</p>
                          <AnimalPicker kind="baby" value={ch.avatar} onChange={(k) => update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.avatar = k })} taken={children.filter((x) => x.id !== ch.id).map((x) => x.avatar)} />
                        </PopoverContent>
                      </Popover>
                      <Input value={ch.name} placeholder="Prénom" onChange={(e) => update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.name = e.target.value })} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <EmployeeSelect employees={active} value={ch.referentId} allowNone onChange={(id) => update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.referentId = id })} />
                  </TableCell>
                  <TableCell>
                    <EmployeeSelect employees={active} value={ch.relaisId} allowNone onChange={(id) => update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.relaisId = id })} />
                  </TableCell>
                  {days.map((d) => {
                    const a = ch.attendance[d]
                    return (
                      <TableCell key={d}>
                        <div className="flex items-center gap-1">
                          <Checkbox
                            checked={!!a}
                            aria-label={`Présent ${DAY_SHORT[d]}`}
                            onCheckedChange={(v) => update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.attendance[d] = v ? { start: h(8, 30), end: h(17, 30) } : null })}
                          />
                          {a && (
                            <>
                              <TimeInput className="w-24" value={a.start} onChange={(v) => v != null && update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.attendance[d]!.start = v })} />
                              <TimeInput className="w-24" value={a.end} onChange={(v) => v != null && update(week.id, (c) => { c.children.find((x) => x.id === ch.id)!.attendance[d]!.end = v })} />
                            </>
                          )}
                        </div>
                      </TableCell>
                    )
                  })}
                  <TableCell>
                    <Button size="icon-sm" variant="ghost" aria-label="Supprimer" onClick={() => update(week.id, (c) => { c.children = c.children.filter((x) => x.id !== ch.id) })}><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {children.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4 + days.length} className="text-center text-muted-foreground">
                    Aucun enfant renseigné. Facultatif : sans enfants, les besoins en personnel sont saisis directement dans l’onglet Semaine.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
    </div>
  )
}
