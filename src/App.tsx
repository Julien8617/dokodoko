import { useEffect, useState } from 'react'
import type { Locale } from './i18n'
import { useI18n } from './i18n'
import UpdatePrompt from './UpdatePrompt'
import ClockDriftWarning from './ClockDriftWarning'
import CacheAgeInfo from './CacheAgeInfo'
import { supabase } from './lib/supabase'
import { refreshReferentielCache } from './lib/referentielCache'
import Settings from './screens/Settings'
import Movement from './screens/Movement'
import Inventory from './screens/Inventory'
import Search from './screens/Search'
import VersionFooter from './components/VersionFooter'

const LOCALES: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'EN' },
]

type Screen = 'home' | 'movement' | 'inventory' | 'settings' | 'search'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')

  // Deux des trois déclencheurs de rafraîchissement du cache de lecture
  // (spec v2 §3) : à l'ouverture, et au retour du réseau. Le troisième —
  // après chaque écriture réussie — est déclenché localement par chaque
  // écran qui écrit (Réglages, Mouvement). Ici et non dans AuthGate : App
  // reste monté en continu tant que la session est active, quel que soit
  // l'écran affiché, donc un seul abonnement pour toute la session.
  useEffect(() => {
    refreshReferentielCache()
    function onOnline() {
      refreshReferentielCache()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (screen === 'settings') return <Settings onBack={() => setScreen('home')} />
  if (screen === 'movement') return <Movement onBack={() => setScreen('home')} />
  if (screen === 'inventory') return <Inventory onBack={() => setScreen('home')} />
  if (screen === 'search') return <Search onBack={() => setScreen('home')} />
  return <Home onNavigate={setScreen} />
}

function Home({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <main className="home">
      <UpdatePrompt />
      <ClockDriftWarning />
      <CacheAgeInfo />

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
        <button className="home-action" onClick={() => onNavigate('search')}>
          {t.nav.search}
        </button>
        <button className="home-action" onClick={() => onNavigate('movement')}>
          {t.nav.movement}
        </button>
        <button className="home-action" onClick={() => onNavigate('inventory')}>
          {t.nav.inventory}
        </button>
        <button className="home-action" onClick={() => onNavigate('settings')}>
          {t.nav.settings}
        </button>
      </div>

      {/* File hors ligne et compteur de mouvements du jour : retirés (spec
          v2 §12) tant qu'ils ne sont pas branchés sur une vraie donnée — un
          texte fixe rassurant est un mensonge en attente. Reviennent avec
          le chantier de file hors ligne. */}

      <button className="sign-out" onClick={() => supabase.auth.signOut()}>
        {t.auth.signOut}
      </button>
      <VersionFooter />
    </main>
  )
}
