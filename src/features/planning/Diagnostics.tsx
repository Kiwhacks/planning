import { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Violation } from '@/domain/types'

export function Diagnostics({ violations }: { violations: Violation[] }) {
  const [showInfo, setShowInfo] = useState(false)
  const errors = violations.filter((v) => v.severity === 'error')
  const warnings = violations.filter((v) => v.severity === 'warning')
  const infos = violations.filter((v) => v.severity === 'info')
  return (
    <Card className="print-break-inside-avoid">
      <CardHeader className="py-3"><CardTitle className="text-base">Points de vigilance</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {violations.length === 0 && (
          <p className="flex items-center gap-2 text-green-700"><CheckCircle2 className="size-4" /> Rien à signaler.</p>
        )}
        {errors.length > 0 && (
          <ul className="space-y-1">
            {errors.map((v, i) => (
              <li key={i} className="flex gap-2 text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{v.message}</span></li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-1">
            {warnings.map((v, i) => (
              <li key={i} className="flex gap-2 text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{v.message}</span></li>
            ))}
          </ul>
        )}
        {infos.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" className="no-print -ml-2" onClick={() => setShowInfo(!showInfo)}>
              <Info /> {showInfo ? 'Masquer' : 'Afficher'} {infos.length} remarque{infos.length > 1 ? 's' : ''}
            </Button>
            {showInfo && (
              <ul className="mt-1 space-y-1">
                {infos.map((v, i) => (
                  <li key={i} className="flex gap-2 text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" /><span>{v.message}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
