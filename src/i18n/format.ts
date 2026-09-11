import type { Locale } from './types'

// Locale BCP-47 utilisée par les API Intl — le japonais applicatif est 'ja',
// mais 'ja-JP' donne un format de date plus idiomatique.
const INTL_LOCALE: Record<Locale, string> = {
  fr: 'fr-FR',
  ja: 'ja-JP',
  en: 'en-US',
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value)
}

// Dates en relatif (spec v2 §6.7) : "il y a 3 j", pas de calcul manuel.
export function formatRelativeTime(locale: Locale, date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: 'auto' })

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ]

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsInUnit || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit)
    }
  }
  return rtf.format(0, 'second')
}

// Remplacement de placeholders {token} — pas d'interpolation implicite.
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}
