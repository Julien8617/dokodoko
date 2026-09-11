import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useI18n } from './i18n'

// Invite explicite plutôt qu'un rechargement silencieux en pleine tournée
// (spec v2 §13) : une nouvelle version reste visible jusqu'à ce qu'on
// accepte de recharger — jamais de reload forcé pendant une saisie en
// cours (un inventaire à moitié compté, un mouvement à moitié rempli).
//
// Le point qui casse en pratique sur iOS : une PWA en standalone reste
// souvent « endormie » en arrière-plan sans jamais revérifier d'elle-même.
// On force donc une vérification à intervalle régulier et à chaque retour
// au premier plan, plutôt que de compter sur le comportement par défaut
// (qui ne revérifie qu'au rechargement complet de la page).
const CHECK_INTERVAL_MS = 30 * 60 * 1000

export default function UpdatePrompt() {
  const { locale } = useI18n()
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration ?? null
    },
  })

  useEffect(() => {
    function checkForUpdate() {
      registrationRef.current?.update().catch(() => {
        // pas grave : on retentera au prochain intervalle ou retour au premier plan
      })
    }

    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS)

    function onVisible() {
      if (document.visibilityState === 'visible') checkForUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!needRefresh[0]) return null

  const label =
    locale === 'ja'
      ? '新しいバージョンがあります — 再読み込み'
      : locale === 'en'
        ? 'New version available — reload'
        : 'Nouvelle version disponible — recharger'

  return (
    <button className="update-banner" onClick={() => updateServiceWorker(true)}>
      {label}
    </button>
  )
}
