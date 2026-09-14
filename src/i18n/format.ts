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

// Remplacement de placeholders {token} — pas d'interpolation implicite.
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}
