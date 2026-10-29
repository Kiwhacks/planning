import { addDays, format, getISOWeek, getISOWeekYear, parseISO, startOfISOWeek } from 'date-fns'
import { fr } from 'date-fns/locale'

export function mondayOf(date: Date): Date {
  return startOfISOWeek(date)
}

export function weekIdOf(date: Date): string {
  const m = mondayOf(date)
  return `${getISOWeekYear(m)}-W${String(getISOWeek(m)).padStart(2, '0')}`
}

export function mondayISO(date: Date): string {
  return format(mondayOf(date), 'yyyy-MM-dd')
}

export function weekLabel(monday: string): string {
  const m = parseISO(monday)
  const f = addDays(m, 4)
  const sameMonth = m.getMonth() === f.getMonth()
  return `Semaine ${getISOWeek(m)} · du ${format(m, sameMonth ? 'd' : 'd MMM', { locale: fr })} au ${format(f, 'd MMM yyyy', { locale: fr })}`
}

export function dayDate(monday: string, day: number): string {
  return format(addDays(parseISO(monday), day), 'EEEE d MMM', { locale: fr })
}

export function shiftWeek(monday: string, delta: number): Date {
  return addDays(parseISO(monday), delta * 7)
}
