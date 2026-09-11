import { useRegisterSW } from 'virtual:pwa-register/react'
import { useI18n } from './i18n'

// Invite explicite plutôt qu'un rechargement silencieux en pleine tournée
// (spec v2 §13) : une nouvelle version reste visible jusqu'à ce qu'on
// accepte de recharger.
export default function UpdatePrompt() {
  const { locale } = useI18n()
  const { needRefresh, updateServiceWorker } = useRegisterSW()

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
