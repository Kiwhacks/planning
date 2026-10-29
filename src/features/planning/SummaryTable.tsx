import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtDuration } from '@/domain/time'
import { DAY_SHORT, type EmployeeWeekStats, type Week } from '@/domain/types'
import { cn } from '@/lib/utils'

export function SummaryTable({ week, stats }: { week: Week; stats: EmployeeWeekStats[] }) {
  const days = week.config.rules.openDays
  const employees = week.config.employees.filter((e) => e.active)
  const totals = stats.reduce(
    (acc, s) => ({ worked: acc.worked + s.workedMinutes, contract: acc.contract + s.contractMinutes, delta: acc.delta + Math.max(0, s.deltaMinutes) }),
    { worked: 0, contract: 0, delta: 0 },
  )
  return (
    <Card className="print-break-inside-avoid">
      <CardHeader className="py-3"><CardTitle className="text-base">Récapitulatif des heures</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Personne</TableHead>
              {days.map((d) => <TableHead key={d} className="text-right">{DAY_SHORT[d]}</TableHead>)}
              <TableHead className="text-right">Travaillé</TableHead>
              <TableHead className="text-right">Congés</TableHead>
              <TableHead className="text-right">Contrat</TableHead>
              <TableHead className="text-right">Écart</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => {
              const s = stats.find((x) => x.employeeId === e.id)
              if (!s) return null
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: e.color }} />
                    {e.name}
                  </TableCell>
                  {days.map((d) => {
                    const m = s.perDay[d]
                    const leave = week.config.leaves.find((l) => l.employeeId === e.id && l.day === d)
                    return (
                      <TableCell key={d} className="text-right tabular-nums text-muted-foreground">
                        {m != null ? <span className="text-foreground">{fmtDuration(m)}</span> : leave ? <span className="italic">congé</span> : '—'}
                      </TableCell>
                    )
                  })}
                  <TableCell className="text-right tabular-nums">{fmtDuration(s.workedMinutes)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{s.leaveMinutes ? fmtDuration(s.leaveMinutes) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDuration(s.contractMinutes)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', s.deltaMinutes > 0 && 'text-red-700', s.deltaMinutes < 0 && 'text-amber-700', s.deltaMinutes === 0 && 'text-green-700')}>
                    {s.deltaMinutes > 0 ? '+' : ''}{fmtDuration(s.deltaMinutes)}
                  </TableCell>
                </TableRow>
              )
            })}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell>Total</TableCell>
              {days.map((d) => <TableCell key={d} />)}
              <TableCell className="text-right tabular-nums">{fmtDuration(totals.worked)}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{fmtDuration(totals.contract)}</TableCell>
              <TableCell className={cn('text-right tabular-nums', totals.delta > 0 && 'text-red-700')}>{totals.delta > 0 ? `+${fmtDuration(totals.delta)} sup.` : '—'}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
