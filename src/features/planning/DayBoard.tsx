import { Lock } from 'lucide-react'
import { AnimalAvatar } from '@/components/common/AnimalAvatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { dayOpening, normalizeRequirements } from '@/domain/requirements'
import { SLOT, fmtDuration, toHHMM } from '@/domain/time'
import { DAY_LABELS, type DayCoverage, type DayIndex, type Shift, type Week } from '@/domain/types'
import { dayDate } from '@/store/weekKey'
import { cn } from '@/lib/utils'

interface Props {
  day: DayIndex
  week: Week
  coverage: DayCoverage | undefined
  onEdit: (employeeId: string, day: DayIndex, shift: Shift | null) => void
}

export function DayBoard({ day, week, coverage, onEdit }: Props) {
  const { config, schedule } = week
  const { rules } = config
  const span = rules.dayEnd - rules.dayStart
  const pct = (t: number) => ((t - rules.dayStart) / span) * 100
  const reqs = normalizeRequirements(config.requirements[day] ?? [])
  const employees = config.employees.filter((e) => e.active)
  const opening = dayOpening(reqs)
  const cleaning = config.cleaning?.[day]
  const cleanStart = opening?.close ?? null
  const cleanEnd = cleanStart != null && cleaning && cleaning.minutes > 0 ? Math.min(rules.dayEnd, cleanStart + cleaning.minutes) : null
  const isCleaner = (id: string) => !!cleaning?.employeeIds.includes(id)
  const hours: number[] = []
  for (let t = Math.ceil(rules.dayStart / 60) * 60; t <= rules.dayEnd; t += 60) hours.push(t)

  return (
    <Card className="print-break-inside-avoid overflow-hidden">
      <CardHeader className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <CardTitle className="text-base">
            {DAY_LABELS[day]} <span className="text-sm font-normal text-muted-foreground">{dayDate(week.monday, day)}</span>
          </CardTitle>
          {coverage && (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Besoin : <b className="text-foreground">{fmtDuration(coverage.requiredMinutes)}</b></span>
              <span>Présence : <b className="text-foreground">{fmtDuration(coverage.presentMinutes)}</b></span>
              {coverage.missingMinutes > 0 && <span className="text-red-700">Manque : <b>{fmtDuration(coverage.missingMinutes)}</b></span>}
              {coverage.extraMinutes > 0 && <span className="text-sky-700">Surplus : <b>{fmtDuration(coverage.extraMinutes)}</b></span>}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {/* Vue compacte (téléphone) */}
        <div className="sm:hidden">
          <ul className="divide-y rounded-md border">
            {employees.map((e) => {
              const sh = schedule[e.id]?.[day] ?? null
              const leave = config.leaves.find((l) => l.employeeId === e.id && l.day === day)
              const pin = config.pins.find((p) => p.employeeId === e.id && p.day === day)
              const canClick = !leave && !(pin?.mustWork === false)
              const worked = sh ? sh.end - sh.start - (sh.breakStart != null ? e.breakMinutes : 0) : 0
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={!canClick}
                    onClick={() => canClick && onEdit(e.id, day, sh)}
                    className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm disabled:opacity-70"
                  >
                    <AnimalAvatar animal={e.avatar} color={e.color} size="sm" />
                    <span className="w-20 shrink-0 truncate font-medium">{e.name}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {leave ? (
                        <span className="text-muted-foreground italic">{leave.label || 'Congé'} ({fmtDuration(leave.minutes)})</span>
                      ) : pin?.mustWork === false ? (
                        <span className="text-muted-foreground italic">Ne travaille pas</span>
                      ) : sh ? (
                        <>
                          <span className="tabular-nums">{toHHMM(sh.start)}–{toHHMM(sh.end)}</span>
                          <span className="text-muted-foreground"> · {fmtDuration(worked)}</span>
                          {sh.breakStart != null && e.breakMinutes > 0 && <span className="text-muted-foreground"> · pause {toHHMM(sh.breakStart)}</span>}
                          {isCleaner(e.id) && cleanStart != null && sh.end > cleanStart && <span className="text-violet-700"> · ménage</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                    {sh?.locked && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex h-3 overflow-hidden rounded">
            {coverage?.slots.map((s) => {
              const status = s.cleaning ? 'cleaning' : s.required === 0 ? (s.present > 0 ? 'outside' : 'closed') : s.problem ? 'under' : s.present > s.required ? 'over' : 'ok'
              return (
                <div
                  key={s.time}
                  className={cn(
                    'flex-1',
                    status === 'ok' && 'bg-green-300',
                    status === 'under' && 'bg-red-400',
                    status === 'over' && 'bg-sky-300',
                    status === 'outside' && 'bg-amber-300',
                    status === 'cleaning' && 'bg-violet-300',
                    status === 'closed' && 'bg-muted/40',
                  )}
                  title={`${toHHMM(s.time)} : ${s.present} présente${s.present > 1 ? 's' : ''} / besoin ${s.required}`}
                />
              )
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{toHHMM(rules.dayStart)}</span>
            <span>couverture : vert = ok · rouge = manque · bleu = surplus · violet = ménage</span>
            <span>{toHHMM(rules.dayEnd)}</span>
          </div>
        </div>

        {/* Vue graphique (tablette et ordinateur) */}
        <div className="hidden overflow-x-auto sm:block">
        <div className="grid min-w-[560px] grid-cols-[7.5rem_1fr] gap-x-2 text-xs">
          {/* Axe des heures */}
          <div />
          <div className="relative h-5">
            {hours.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 text-[10px] text-muted-foreground" style={{ left: `${pct(t)}%` }}>
                {toHHMM(t)}
              </span>
            ))}
          </div>

          {/* Besoin */}
          <div className="flex items-center text-muted-foreground">Besoin</div>
          <div className="relative h-6 rounded bg-muted/60">
            {reqs.map((r, i) => (
              <div
                key={i}
                className="absolute inset-y-0 flex items-center justify-center border-r border-background bg-foreground/10 font-medium"
                style={{ left: `${pct(r.start)}%`, width: `${pct(r.end) - pct(r.start)}%` }}
                title={`${toHHMM(r.start)}–${toHHMM(r.end)} : ${r.staff} personne${r.staff > 1 ? 's' : ''}`}
              >
                {r.staff}
              </div>
            ))}
            {cleanStart != null && cleanEnd != null && (
              <div
                className="absolute inset-y-0 flex items-center justify-center border-r border-background bg-violet-200/70 text-[10px] text-violet-900"
                style={{ left: `${pct(cleanStart)}%`, width: `${pct(cleanEnd) - pct(cleanStart)}%` }}
                title={`Ménage ${toHHMM(cleanStart)}–${toHHMM(cleanEnd)} : ${cleaning?.employeeIds.length ? cleaning.employeeIds.map((id) => config.employees.find((e) => e.id === id)?.name ?? '?').join(', ') : 'personne affectée'}`}
              >
                ménage
              </div>
            )}
            {reqs.length === 0 && <div className="flex h-full items-center justify-center text-muted-foreground">Fermé / aucun besoin défini</div>}
          </div>

          {/* Personnes */}
          {employees.map((e) => {
            const sh = schedule[e.id]?.[day] ?? null
            const leave = config.leaves.find((l) => l.employeeId === e.id && l.day === day)
            const pin = config.pins.find((p) => p.employeeId === e.id && p.day === day)
            const notWorkDay = !e.workDays.includes(day)
            const canClick = !leave && !(pin?.mustWork === false)
            return (
              <div key={e.id} className="contents">
                <div className="flex items-center gap-1.5 truncate py-0.5">
                  <AnimalAvatar animal={e.avatar} color={e.color} size="xs" />
                  <span className="truncate font-medium" title={e.name}>{e.name}</span>
                </div>
                <div
                  className={cn('relative h-8 rounded border border-dashed border-transparent', canClick && 'cursor-pointer hover:border-border hover:bg-muted/40')}
                  onClick={() => canClick && onEdit(e.id, day, sh)}
                  role={canClick ? 'button' : undefined}
                >
                  {/* grille des heures */}
                  {hours.map((t) => (
                    <div key={t} className="absolute inset-y-0 border-l border-border/40" style={{ left: `${pct(t)}%` }} />
                  ))}
                  {leave && (
                    <div className="absolute inset-0 flex items-center px-2 text-muted-foreground italic">
                      {leave.label || 'Congé'} ({fmtDuration(leave.minutes)} comptées)
                    </div>
                  )}
                  {!leave && pin?.mustWork === false && <div className="absolute inset-0 flex items-center px-2 text-muted-foreground italic">Ne travaille pas</div>}
                  {!leave && !sh && notWorkDay && pin?.mustWork !== false && (
                    <div className="absolute inset-0 flex items-center px-2 text-muted-foreground/70 italic">Jour non travaillé</div>
                  )}
                  {sh && (
                    <div
                      className="absolute inset-y-0.5 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-medium text-white shadow-sm"
                      style={{ left: `${pct(sh.start)}%`, width: `${pct(sh.end) - pct(sh.start)}%`, background: e.color }}
                      title={`${toHHMM(sh.start)}–${toHHMM(sh.end)}${sh.breakStart != null ? ` · pause ${toHHMM(sh.breakStart)}–${toHHMM(sh.breakStart + e.breakMinutes)}` : ''}`}
                    >
                      {sh.breakStart != null && e.breakMinutes > 0 && (
                        <div
                          className="absolute inset-y-0 bg-white/70"
                          style={{
                            left: `${((sh.breakStart - sh.start) / (sh.end - sh.start)) * 100}%`,
                            width: `${(e.breakMinutes / (sh.end - sh.start)) * 100}%`,
                            backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,.18) 0 3px, transparent 3px 7px)',
                          }}
                          title={`Pause ${toHHMM(sh.breakStart)}–${toHHMM(sh.breakStart + e.breakMinutes)}`}
                        />
                      )}
                      {isCleaner(e.id) && cleanStart != null && sh.end > cleanStart && (
                        <div
                          className="absolute inset-y-0 flex items-center overflow-hidden border-l border-white/80 pl-1 text-[9px] font-semibold tracking-wide text-white uppercase"
                          style={{ left: `${((cleanStart - sh.start) / (sh.end - sh.start)) * 100}%`, width: `${((sh.end - cleanStart) / (sh.end - sh.start)) * 100}%`, backgroundColor: 'rgba(0,0,0,.28)', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.95) 1.2px, transparent 1.7px)', backgroundSize: '6px 6px' }}
                          title={`Ménage ${toHHMM(cleanStart)}–${toHHMM(sh.end)}`}
                        >
                          {sh.end - cleanStart >= 60 && <span className="relative z-10 truncate drop-shadow-sm">ménage</span>}
                        </div>
                      )}
                      <span className="relative z-10 truncate drop-shadow-sm">
                        {toHHMM(sh.start)}–{toHHMM(sh.end)}
                        <span className="ml-1 opacity-80">({fmtDuration(sh.end - sh.start - (sh.breakStart != null ? e.breakMinutes : 0))})</span>
                      </span>
                      {sh.locked && <Lock className="relative z-10 ml-auto size-3 shrink-0" />}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Couverture */}
          <div className="flex items-center text-muted-foreground">Présentes</div>
          <div className="relative flex h-5 overflow-hidden rounded">
            {coverage?.slots.map((s) => {
              const status = s.cleaning ? 'cleaning' : s.required === 0 ? (s.present > 0 ? 'outside' : 'closed') : s.problem ? 'under' : s.present > s.required ? 'over' : 'ok'
              return (
                <div
                  key={s.time}
                  className={cn(
                    'flex flex-1 items-center justify-center text-[9px] leading-none',
                    status === 'ok' && 'bg-green-200 text-green-900',
                    status === 'under' && 'bg-red-300 text-red-950',
                    status === 'over' && 'bg-sky-200 text-sky-900',
                    status === 'outside' && 'bg-amber-200 text-amber-900',
                    status === 'cleaning' && 'bg-violet-200 text-violet-900',
                    status === 'closed' && 'bg-muted/40',
                  )}
                  title={s.cleaning ? `${toHHMM(s.time)}–${toHHMM(s.time + SLOT)} : ménage, ${s.present} présente${s.present > 1 ? 's' : ''}` : `${toHHMM(s.time)}–${toHHMM(s.time + SLOT)} : ${s.present} présente${s.present > 1 ? 's' : ''} (${s.pros} pro) pour un besoin de ${s.required}`}
                >
                  {s.required > 0 || s.present > 0 || s.cleaning ? s.present : ''}
                </div>
              )
            })}
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  )
}
