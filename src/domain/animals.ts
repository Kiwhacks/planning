/** Illustrations Twemoji (CC-BY 4.0, https://github.com/jdecked/twemoji) copiées dans public/animals/. */
export interface Animal { key: string; label: string }

/** Animaux adultes : pour les professionnelles. */
export const ADULT_ANIMALS: Animal[] = [
  { key: 'chouette', label: 'Chouette' },
  { key: 'renard', label: 'Renard' },
  { key: 'ours', label: 'Ours' },
  { key: 'lion', label: 'Lion' },
  { key: 'tigre', label: 'Tigre' },
  { key: 'koala', label: 'Koala' },
  { key: 'panda', label: 'Panda' },
  { key: 'cerf', label: 'Cerf' },
  { key: 'elephant', label: 'Éléphant' },
  { key: 'girafe', label: 'Girafe' },
  { key: 'loup', label: 'Loup' },
  { key: 'cheval', label: 'Cheval' },
  { key: 'vache', label: 'Vache' },
  { key: 'mouton', label: 'Mouton' },
  { key: 'kangourou', label: 'Kangourou' },
  { key: 'lama', label: 'Lama' },
  { key: 'loutre', label: 'Loutre' },
  { key: 'herisson', label: 'Hérisson' },
  { key: 'chat', label: 'Chat' },
  { key: 'chien', label: 'Chien' },
]

/** Bébés animaux : pour les enfants. */
export const BABY_ANIMALS: Animal[] = [
  { key: 'poussin', label: 'Poussin qui éclot' },
  { key: 'poussin-jaune', label: 'Poussin' },
  { key: 'poussin-face', label: 'Petit poussin' },
  { key: 'caneton', label: 'Caneton' },
  { key: 'grenouille', label: 'Grenouille' },
  { key: 'coccinelle', label: 'Coccinelle' },
  { key: 'abeille', label: 'Abeille' },
  { key: 'papillon', label: 'Papillon' },
  { key: 'tortue', label: 'Tortue' },
  { key: 'escargot', label: 'Escargot' },
  { key: 'ecureuil', label: 'Écureuil' },
  { key: 'souris', label: 'Souris' },
  { key: 'cochonnet', label: 'Cochonnet' },
  { key: 'poisson', label: 'Poisson' },
  { key: 'phoque', label: 'Bébé phoque' },
  { key: 'pieuvre', label: 'Pieuvre' },
  { key: 'oiseau', label: 'Oiseau' },
  { key: 'pingouin', label: 'Pingouin' },
  { key: 'hamster', label: 'Hamster' },
  { key: 'lapin', label: 'Lapin' },
]

export const ALL_ANIMALS: Animal[] = [...ADULT_ANIMALS, ...BABY_ANIMALS]

export function animalUrl(key: string): string {
  return `/animals/${key}.svg`
}

/** Choisit un animal non encore utilisé (ou le suivant dans la liste). */
export function pickAnimal(list: Animal[], used: (string | undefined | null)[], index: number): string {
  const free = list.find((a) => !used.includes(a.key))
  return (free ?? list[index % list.length]).key
}
