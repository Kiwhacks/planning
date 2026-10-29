import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentWeek, useStore } from '@/store/useStore'
import { mondayISO, shiftWeek, weekIdOf, weekLabel } from '@/store/weekKey'

export function WeekNav() {
  const week = useCurrentWeek()
  const currentWeekId = useStore((s) => s.currentWeekId)
  const weeks = useStore((s) => s.weeks)
  const setCurrentWeek = useStore((s) => s.setCurrentWeek)
  const pendingMonday = useStore((s) => s.pendingMonday)
  const setPendingMonday = useStore((s) => s.setPendingMonday)

  const monday = week?.monday ?? pendingMonday ?? mondayISO(new Date())

  const go = (delta: number) => {
    const d = shiftWeek(monday, delta)
    const id = weekIdOf(d)
    if (weeks[id]) {
      setCurrentWeek(id)
      setPendingMonday(null)
    } else {
      setCurrentWeek(null)
      setPendingMonday(mondayISO(d))
    }
  }
  const today = () => {
    const id = weekIdOf(new Date())
    if (weeks[id]) {
      setCurrentWeek(id)
      setPendingMonday(null)
    } else {
      setCurrentWeek(null)
      setPendingMonday(mondayISO(new Date()))
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" onClick={() => go(-1)} aria-label="Semaine précédente"><ChevronLeft /></Button>
      <div className="min-w-56 text-center">
        <div className="text-sm font-medium">{weekLabel(monday)}</div>
        <div className="text-xs text-muted-foreground">
          {week ? (
            <Badge variant={week.status === 'validated' ? 'default' : 'secondary'}>{week.status === 'validated' ? 'Validé' : 'Brouillon'}</Badge>
          ) : (
            <span>Semaine non créée</span>
          )}
        </div>
      </div>
      <Button variant="outline" size="icon-sm" onClick={() => go(1)} aria-label="Semaine suivante"><ChevronRight /></Button>
      <Button variant="ghost" size="sm" onClick={today} disabled={currentWeekId === weekIdOf(new Date())}>Aujourd’hui</Button>
    </div>
  )
}
