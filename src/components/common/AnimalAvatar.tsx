import { ADULT_ANIMALS, ALL_ANIMALS, BABY_ANIMALS, animalUrl, type Animal } from '@/domain/animals'
import { cn } from '@/lib/utils'

interface Props {
  animal?: string | null
  color?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  title?: string
}

const SIZES = { xs: 'size-5 p-0.5', sm: 'size-7 p-1', md: 'size-9 p-1.5', lg: 'size-14 p-2' }

/** Petite image d'animal dans un cercle de la couleur de la personne. */
export function AnimalAvatar({ animal, color, size = 'sm', className, title }: Props) {
  const label = ALL_ANIMALS.find((a) => a.key === animal)?.label
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-white', SIZES[size], className)}
      style={{ boxShadow: color ? `inset 0 0 0 2px ${color}` : undefined, background: color ? `${color}22` : undefined }}
      title={title ?? label}
    >
      {animal ? <img src={animalUrl(animal)} alt={label ?? ''} className="size-full object-contain" draggable={false} /> : <span className="size-2.5 rounded-full" style={{ background: color }} />}
    </span>
  )
}

/** Sélecteur d'animal (adultes pour l'équipe, bébés pour les enfants). */
export function AnimalPicker({ kind, value, onChange, taken = [] }: { kind: 'adult' | 'baby'; value?: string | null; onChange: (key: string) => void; taken?: (string | undefined | null)[] }) {
  const list: Animal[] = kind === 'adult' ? ADULT_ANIMALS : BABY_ANIMALS
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((a) => {
        const selected = a.key === value
        const used = !selected && taken.includes(a.key)
        return (
          <button
            key={a.key}
            type="button"
            title={a.label + (used ? ' (déjà utilisé)' : '')}
            onClick={() => onChange(a.key)}
            className={cn('rounded-full border-2 p-1 transition-transform hover:scale-110', selected ? 'border-primary bg-primary/10' : 'border-transparent', used && 'opacity-40')}
          >
            <img src={animalUrl(a.key)} alt={a.label} className="size-8" draggable={false} />
          </button>
        )
      })}
    </div>
  )
}
