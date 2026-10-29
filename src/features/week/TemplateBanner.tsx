import { toast } from 'sonner'
import { RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Week } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { weekLabel } from '@/store/weekKey'

/** Rappelle que les réglages sont propres à la semaine et permet de les propager. */
export function TemplateBanner({ week, what }: { week: Week; what: string }) {
  const saveWeekAsTemplate = useStore((s) => s.saveWeekAsTemplate)
  const resetWeekFromTemplate = useStore((s) => s.resetWeekFromTemplate)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 text-sm">
      <p className="text-muted-foreground">
        {what} de la <b className="text-foreground">{weekLabel(week.monday)}</b>. Les modifications ne concernent que cette semaine, sauf si vous les enregistrez comme réglages par défaut.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (confirm('Remplacer les réglages de cette semaine (équipe, enfants, règles, besoins types) par les réglages par défaut ?')) {
              resetWeekFromTemplate(week.id)
              toast.success('Réglages par défaut rechargés pour cette semaine.')
            }
          }}
        >
          <RotateCcw /> Recharger les réglages par défaut
        </Button>
        <Button
          size="sm"
          onClick={() => {
            saveWeekAsTemplate(week.id)
            toast.success('Enregistré : les prochaines semaines reprendront ces réglages.')
          }}
        >
          <Save /> Enregistrer comme réglages par défaut
        </Button>
      </div>
    </div>
  )
}
