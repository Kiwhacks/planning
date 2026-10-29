import { Input } from '@/components/ui/input'
import { fromHHMM, roundToSlot, toHHMM } from '@/domain/time'

interface Props {
  value: number | null
  onChange: (v: number | null) => void
  allowEmpty?: boolean
  className?: string
  disabled?: boolean
}

/** Saisie d'une heure (minutes depuis minuit), arrondie au quart d'heure. */
export function TimeInput({ value, onChange, allowEmpty, className, disabled }: Props) {
  return (
    <Input
      type="time"
      step={900}
      disabled={disabled}
      className={className}
      value={value == null ? '' : toHHMM(value)}
      onChange={(e) => {
        const v = e.target.value
        if (!v) {
          if (allowEmpty) onChange(null)
          return
        }
        const m = fromHHMM(v)
        if (m != null) onChange(roundToSlot(m))
      }}
    />
  )
}
