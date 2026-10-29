import { DAY_SHORT, type DayIndex } from '@/domain/types'
import { cn } from '@/lib/utils'

interface Props {
  value: DayIndex[]
  onChange: (v: DayIndex[]) => void
  available?: DayIndex[]
}

export function DayPicker({ value, onChange, available = [0, 1, 2, 3, 4, 5, 6] }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {available.map((d) => {
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            className={cn(
              'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            {DAY_SHORT[d]}
          </button>
        )
      })}
    </div>
  )
}
