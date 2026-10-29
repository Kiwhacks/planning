import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DayPicker } from '@/components/common/DayPicker'
import { DurationInput } from '@/components/common/DurationInput'
import { SectionCard } from '@/components/common/SectionCard'
import { TimeInput } from '@/components/common/TimeInput'
import type { Rules, Week } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { TemplateBanner } from '@/features/week/TemplateBanner'

export function RulesTab({ week }: { week: Week }) {
  const update = useStore((s) => s.updateWeekConfig)
  const r = week.config.rules
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => update(week.id, (c) => { c.rules[k] = v })

  return (
    <div className="space-y-4">
      <TemplateBanner week={week} what="Règles" />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Structure" description="Plage horaire et jours d'ouverture possibles.">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Début de journée au plus tôt</Label>
                <TimeInput value={r.dayStart} onChange={(v) => v != null && set('dayStart', v)} />
              </div>
              <div className="space-y-1">
                <Label>Fin de journée au plus tard</Label>
                <TimeInput value={r.dayEnd} onChange={(v) => v != null && set('dayEnd', v)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Jours d’ouverture</Label>
              <DayPicker value={r.openDays} onChange={(v) => set('openDays', v)} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Encadrement" description="Règles de présence des professionnelles.">
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Professionnelles minimum dès que 2 personnes ou plus sont requises</Label>
              <Input type="number" min={1} max={5} value={r.minProsWhenTwoOrMore} onChange={(e) => set('minProsWhenTwoOrMore', Math.max(1, Number(e.target.value) || 1))} />
              <p className="text-xs text-muted-foreground">Les apprenties et stagiaires complètent l’équipe mais ne comptent pas dans ce minimum. Une personne seule doit toujours être une professionnelle autorisée à ouvrir/fermer seule.</p>
            </div>
            <div className="space-y-1">
              <Label>Taux d’encadrement (pour calculer les besoins depuis les enfants)</Label>
              <div className="space-y-1">
                {r.ratio.map((step, i) => (
                  <div key={i} className="grid grid-cols-[auto_4rem_auto_4rem_auto_1.75rem] items-center gap-1.5 text-sm">
                    <span>À partir de</span>
                    <Input type="number" min={1} value={step.minChildren} onChange={(e) => update(week.id, (c) => { c.rules.ratio[i].minChildren = Math.max(1, Number(e.target.value) || 1) })} />
                    <span>enfant(s) →</span>
                    <Input type="number" min={1} value={step.staff} onChange={(e) => update(week.id, (c) => { c.rules.ratio[i].staff = Math.max(1, Number(e.target.value) || 1) })} />
                    <span>personne(s)</span>
                    <Button size="icon-sm" variant="ghost" aria-label="Supprimer" onClick={() => update(week.id, (c) => { c.rules.ratio.splice(i, 1) })}><Trash2 /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => update(week.id, (c) => { const last = c.rules.ratio[c.rules.ratio.length - 1]; c.rules.ratio.push({ minChildren: (last?.minChildren ?? 0) + 4, staff: (last?.staff ?? 0) + 1 }) })}><Plus /> Palier</Button>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Pauses" description="Fenêtre souhaitée et condition de déclenchement.">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Pauses de préférence à partir de</Label>
                <TimeInput value={r.breakWindowStart} onChange={(v) => v != null && set('breakWindowStart', v)} />
              </div>
              <div className="space-y-1">
                <Label>… et jusqu’à</Label>
                <TimeInput value={r.breakWindowEnd} onChange={(v) => v != null && set('breakWindowEnd', v)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Pause due seulement si la journée dépasse</Label>
              <DurationInput value={r.breakMinShiftMinutes} onChange={(m) => m != null && set('breakMinShiftMinutes', m)} placeholder="0h = toujours" />
              <p className="text-xs text-muted-foreground">0h : la pause de la personne s’applique à chaque journée travaillée.</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Priorités du générateur" description="Comment arbitrer quand tout n'est pas possible.">
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Heures supplémentaires</Label>
              <Select value={String(r.overtimeStrictness)} onValueChange={(v) => set('overtimeStrictness', Number(v) as Rules['overtimeStrictness'])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Tolérées</SelectItem>
                  <SelectItem value="2">Limitées (recommandé)</SelectItem>
                  <SelectItem value="3">Fortement évitées</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">La couverture des besoins reste toujours prioritaire sur les heures supplémentaires.</p>
            </div>
            <div className="space-y-1">
              <Label>Présence des référentes / relais</Label>
              <Select value={String(r.referentImportance)} onValueChange={(v) => set('referentImportance', Number(v) as Rules['referentImportance'])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Ignorée</SelectItem>
                  <SelectItem value="1">Souhaitée</SelectItem>
                  <SelectItem value="2">Importante</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Valeurs par défaut" description="Pour les nouvelles personnes et les nouvelles semaines." className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1">
              <Label>Journée minimale</Label>
              <DurationInput value={r.defaultMinDailyMinutes} onChange={(m) => m != null && set('defaultMinDailyMinutes', m)} />
            </div>
            <div className="space-y-1">
              <Label>Journée maximale</Label>
              <DurationInput value={r.defaultMaxDailyMinutes} onChange={(m) => m != null && set('defaultMaxDailyMinutes', m)} />
            </div>
            <div className="space-y-1">
              <Label>Amplitude maximale</Label>
              <DurationInput value={r.defaultMaxAmplitudeMinutes} onChange={(m) => m != null && set('defaultMaxAmplitudeMinutes', m)} />
            </div>
            <div className="space-y-1">
              <Label>Pause</Label>
              <DurationInput value={r.defaultBreakMinutes} onChange={(m) => m != null && set('defaultBreakMinutes', m)} />
            </div>
            <div className="space-y-1">
              <Label>Ménage quotidien</Label>
              <DurationInput value={r.defaultCleaningMinutes} onChange={(m) => m != null && set('defaultCleaningMinutes', m)} placeholder="0h = aucun" />
              <p className="text-xs text-muted-foreground">Après le départ du dernier enfant ; les personnes sont affectées par jour dans l’onglet Semaine.</p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
