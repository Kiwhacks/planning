import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Employee } from '@/domain/types'

interface Props {
  employees: Employee[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  allowNone?: boolean
  className?: string
}

const NONE = '__none__'

export function EmployeeSelect({ employees, value, onChange, placeholder = 'Choisir…', allowNone, className }: Props) {
  return (
    <Select value={value ?? (allowNone ? NONE : '')} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className={className ?? 'w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>— Aucune —</SelectItem>}
        {employees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            <span className="inline-block size-2.5 rounded-full" style={{ background: e.color }} />
            {e.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
