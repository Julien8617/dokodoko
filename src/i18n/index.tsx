import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Dictionary, Locale } from './types'
import fr from './fr'
import ja from './ja'
import en from './en'

export type { Dictionary, Locale, MotifKey } from './types'
export { formatNumber, formatRelativeTime, interpolate } from './format'

const DICTIONARIES: Record<Locale, Dictionary> = { fr, ja, en }
const SUPPORTED_LOCALES: Locale[] = ['fr', 'ja', 'en']
const STORAGE_KEY = 'dokodoko:locale'

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(value)
}

// Choix explicite de langue conservé par appareil (localStorage) : ce n'est
// pas une donnée métier, elle ne va jamais dans Supabase (spec v2 §6.7).
function detectInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) return stored
  } catch {
    // localStorage indisponible (navigation privée, etc.) — on retombe sur navigator.language
  }

  const candidates = [navigator.language, ...(navigator.languages ?? [])]
  for (const candidate of candidates) {
    const primary = candidate.split('-')[0]
    if (primary && isLocale(primary)) return primary
  }
  return 'fr'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Dictionary
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = detectInitialLocale()
    document.documentElement.lang = initial
    return initial
  })

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.documentElement.lang = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // pas bloquant : le choix ne survivra simplement pas à cette session
    }
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: DICTIONARIES[locale] }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
