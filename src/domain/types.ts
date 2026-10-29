/** Index de jour : 0 = lundi … 6 = dimanche */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const

/** Statut : seules les « pro » comptent dans le taux d'encadrement. */
export type StaffRole = 'pro' | 'apprenti' | 'stagiaire'

export const ROLE_LABELS: Record<StaffRole, string> = {
  pro: 'Professionnelle',
  apprenti: 'Apprentie',
  stagiaire: 'Stagiaire',
}

export interface Employee {
  id: string
  name: string
  color: string
  role: StaffRole
  /** Heures hebdomadaires contractuelles, en minutes (33h30 = 2010). */
  weeklyMinutes: number
  /** Jours où la personne peut travailler. */
  workDays: DayIndex[]
  /** Si renseigné : chaque jour travaillé dure exactement cette durée (ex. Claude 3h30). */
  fixedDailyMinutes: number | null
  /** Durée minimale d'une journée travaillée (évite les très petites vacations). */
  minDailyMinutes: number
  /** Durée maximale de travail effectif par jour. */
  maxDailyMinutes: number
  /** Amplitude maximale (première arrivée → dernier départ, pause incluse). */
  maxAmplitudeMinutes: number
  /** Pause quotidienne non travaillée (0 = pas de pause). */
  breakMinutes: number
  /** Peut ouvrir / fermer seule (être la seule personne présente). */
  canBeAlone: boolean
  active: boolean
}

export interface TimeRange {
  /** Minutes depuis minuit. */
  start: number
  end: number
}

export interface Child {
  id: string
  name: string
  referentId: string | null
  relaisId: string | null
  /** Présence par jour (null = absent). */
  attendance: Partial<Record<DayIndex, TimeRange | null>>
}

export interface RatioStep {
  /** À partir de ce nombre d'enfants… */
  minChildren: number
  /** … il faut ce nombre de personnes présentes. */
  staff: number
}

export interface Rules {
  /** Première heure possible d'une journée (minutes). */
  dayStart: number
  /** Dernière heure possible d'une journée (minutes). */
  dayEnd: number
  /** Jours ouverts de la structure. */
  openDays: DayIndex[]
  /** Taux d'encadrement utilisé pour calculer les besoins depuis la liste des enfants. */
  ratio: RatioStep[]
  /** Nombre minimum de professionnelles (hors apprenties / stagiaires) dès que ≥ 2 personnes sont requises. */
  minProsWhenTwoOrMore: number
  /** Fenêtre souhaitée pour les pauses. */
  breakWindowStart: number
  breakWindowEnd: number
  /** La pause n'est due que si la journée dépasse cette durée (0 = toujours). */
  breakMinShiftMinutes: number
  /** Valeurs par défaut pour les nouveaux membres de l'équipe. */
  defaultMaxDailyMinutes: number
  defaultMaxAmplitudeMinutes: number
  defaultMinDailyMinutes: number
  defaultBreakMinutes: number
  /** Importance des heures supplémentaires (1 = normal, 3 = très pénalisées). */
  overtimeStrictness: 1 | 2 | 3
  /** Importance de la présence des référentes / relais auprès des enfants. */
  referentImportance: 0 | 1 | 2
  /** Durée de ménage par défaut après le départ du dernier enfant (minutes). */
  defaultCleaningMinutes: number
}

/** Ménage d'un jour : durée après le départ du dernier enfant et personnes affectées. */
export interface CleaningDay {
  minutes: number
  employeeIds: string[]
}

/** Besoin en personnel sur une plage horaire. */
export interface Requirement extends TimeRange {
  staff: number
}

/** Absence / congé : la journée n'est pas travaillée mais `minutes` comptent dans le contrat. */
export interface Leave {
  id: string
  employeeId: string
  day: DayIndex
  minutes: number
  label: string
}

/** Contrainte fixe pour une personne un jour donné. */
export interface Pin {
  id: string
  employeeId: string
  day: DayIndex
  /** Heure d'arrivée imposée (minutes) ou null. */
  start: number | null
  /** Heure de départ imposée (minutes) ou null. */
  end: number | null
  /** true = doit travailler ce jour ; false = ne travaille pas (sans heures comptées) ; null = libre. */
  mustWork: boolean | null
  note: string
}

export interface Shift {
  start: number
  end: number
  /** Début de la pause (minutes) ou null. */
  breakStart: number | null
  /** Verrouillé : le générateur ne modifie pas ce créneau. */
  locked?: boolean
}

/** schedule[employeeId][day] */
export type Schedule = Record<string, Partial<Record<DayIndex, Shift | null>>>

/** Réglages par défaut, repris pour chaque nouvelle semaine. */
export interface TemplateConfig {
  employees: Employee[]
  children: Child[]
  rules: Rules
  requirements: Partial<Record<DayIndex, Requirement[]>>
  cleaning: Partial<Record<DayIndex, CleaningDay>>
}

/** Configuration propre à une semaine (copie modifiable du modèle + spécificités). */
export interface WeekConfig extends TemplateConfig {
  leaves: Leave[]
  pins: Pin[]
  notes: string
}

export type WeekStatus = 'draft' | 'validated'

export interface Week {
  /** Clé ISO, ex. « 2026-W44 ». */
  id: string
  /** Lundi de la semaine, « YYYY-MM-DD ». */
  monday: string
  config: WeekConfig
  schedule: Schedule
  status: WeekStatus
  createdAt: string
  updatedAt: string
}

export type Severity = 'error' | 'warning' | 'info'

export interface Violation {
  severity: Severity
  /** Jour concerné ou null (hebdomadaire). */
  day: DayIndex | null
  employeeId: string | null
  message: string
}

export interface EmployeeWeekStats {
  employeeId: string
  workedMinutes: number
  leaveMinutes: number
  contractMinutes: number
  /** worked + leave - contract (positif = heures sup). */
  deltaMinutes: number
  perDay: Partial<Record<DayIndex, number>>
}

export interface DayCoverage {
  day: DayIndex
  /** Pour chaque créneau : besoin, présentes, pros présentes, créneau de ménage, problème bloquant. */
  slots: { time: number; required: number; present: number; pros: number; cleaning: boolean; problem: boolean }[]
  /** Heures-personnes requises, ménage inclus. */
  requiredMinutes: number
  presentMinutes: number
  missingMinutes: number
  extraMinutes: number
}

export interface Evaluation {
  cost: number
  violations: Violation[]
  stats: EmployeeWeekStats[]
  coverage: DayCoverage[]
}
