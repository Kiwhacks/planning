import { Lightbulb, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Suggestion } from '@/domain/suggestions'

export function Suggestions({ suggestions, onApply }: { suggestions: Suggestion[]; onApply: (s: Suggestion) => void }) {
  return (
    <Card className="print-break-inside-avoid no-print">
      <CardHeader className="py-3"><CardTitle className="text-base">Suggestions</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {suggestions.length === 0 && <p className="text-muted-foreground">Aucune suggestion pour l’instant.</p>}
        {suggestions.map((s) => (
          <div key={s.id} className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p>{s.message}</p>
              {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
            </div>
            {s.apply && (
              <Button size="sm" variant="outline" onClick={() => onApply(s)}><Check /> Appliquer</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
