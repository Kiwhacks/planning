import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { fmtDuration, parseDuration, roundToSlot } from '@/domain/time'

interface Props {
  value: number | null
  onChange: (v: number | null) => void
  allowEmpty?: boolean
  placeholder?: string
  className?: string
}

/** Saisie d'une durée au format « 33h30 » (ou « 33:30 », « 33.5 »). */
export function DurationInput({ value, onChange, allowEmpty, placeholder, className }: Props) {
  const [text, setText] = useState(value == null ? '' : fmtDuration(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(value == null ? '' : fmtDuration(value))
    setInvalid(false)
  }, [value])
  return (
    <Input
      className={className}
      placeholder={placeholder ?? 'ex. 33h30'}
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === '') {
          if (allowEmpty) {
            onChange(null)
            setInvalid(false)
          } else setInvalid(true)
          return
        }
        const m = parseDuration(text)
        if (m == null) setInvalid(true)
        else {
          setInvalid(false)
          onChange(roundToSlot(m))
        }
      }}
    />
  )
}
