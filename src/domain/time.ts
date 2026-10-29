export const SLOT = 15

export const h = (hours: number, minutes = 0) => hours * 60 + minutes

/** 510 → « 08:30 » */
export function toHHMM(m: number): string {
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** « 8:30 » → 510 ; renvoie null si invalide. */
export function fromHHMM(s: string): number | null {
  const m = /^(\d{1,2})[:h](\d{2})?$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = m[2] ? Number(m[2]) : 0
  if (hh > 24 || mm > 59) return null
  return hh * 60 + mm
}

/** 2010 → « 33h30 », 210 → « 3h30 », 60 → « 1h » */
export function fmtDuration(m: number): string {
  const sign = m < 0 ? '-' : ''
  const abs = Math.abs(Math.round(m))
  const hh = Math.floor(abs / 60)
  const mm = abs % 60
  if (mm === 0) return `${sign}${hh}h`
  return `${sign}${hh}h${String(mm).padStart(2, '0')}`
}

/** « 33h30 », « 33:30 », « 33,5 », « 33.5 » → minutes ; null si invalide. */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase().replace(',', '.')
  let m = /^(\d{1,3})\s*h\s*(\d{1,2})?$/.exec(t)
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)
  m = /^(\d{1,3}):(\d{2})$/.exec(t)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = /^(\d{1,3}(?:\.\d+)?)$/.exec(t)
  if (m) return Math.round(Number(m[1]) * 60)
  return null
}

export function roundToSlot(m: number): number {
  return Math.round(m / SLOT) * SLOT
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
