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

// Règle générale (arbitrage 2026-09-16) : relatif pour l'âge d'un état —
// cache de lecture (§3), file hors ligne à venir — jamais pour le journal
// des `mouvements`, où l'heure exacte du geste est l'information et ne
// doit jamais s'effacer derrière un "il y a 2 h" approximatif.
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
