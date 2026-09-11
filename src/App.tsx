import type { Locale } from './i18n'
import { useI18n, interpolate } from './i18n'
import UpdatePrompt from './UpdatePrompt'

const LOCALES: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'EN' },
]

// Écran d'accueil (spec v2 §6.1). Les quatre destinations sont pour
// l'instant des boutons inertes : le routage et les écrans réels arrivent
// aux étapes suivantes de l'ordre de livraison (§12).
export default function App() {
  const { locale, setLocale, t } = useI18n()

  return (
    <main className="home">
      <UpdatePrompt />

      <h1>{t.app.name}</h1>

      <nav className="locale-switch" aria-label="Langue">
        {LOCALES.map(({ code, label }) => (
          <button
            key={code}
            className={code === locale ? 'active' : ''}
            onClick={() => setLocale(code)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="home-actions">
        <button className="home-action">{t.nav.search}</button>
        <button className="home-action">{t.nav.movement}</button>
        <button className="home-action">{t.nav.inventory}</button>
        <button className="home-action">{t.nav.settings}</button>
      </div>

      <p className="home-status">{t.home.offlineQueueEmpty}</p>
      <p className="home-status">{interpolate(t.home.movementsToday, { count: 0 })}</p>
    </main>
  )
}
