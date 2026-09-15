import { useEffect, useState } from 'react'
import { useI18n, formatRelativeTime, interpolate } from './i18n'
import { getReferentielAgeMs } from './lib/referentielCache'

// Affiche l'âge du cache de lecture en permanence, jamais seulement au-delà
// d'un seuil (spec v2 §3) : un cache périmé en silence est le même piège
// que le « tout est synchronisé » codé en dur retiré la semaine dernière.
// Relit l'âge à intervalle régulier — App.tsx rafraîchit le cache lui-même
// (ouverture, écriture réussie, retour réseau) ; ce composant ne fait que
// refléter l'état, sans jamais déclencher de réseau.
const TICK_MS = 60 * 1000

export default function CacheAgeInfo() {
  const { locale, t } = useI18n()
  const [ageMs, setAgeMs] = useState<number | null>(getReferentielAgeMs())

  useEffect(() => {
    const interval = setInterval(() => setAgeMs(getReferentielAgeMs()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  return (
    <p className="cache-age-info">
      {ageMs === null
        ? t.home.cacheNeverLoaded
        : interpolate(t.home.cacheAge, {
            when: formatRelativeTime(locale, new Date(Date.now() - ageMs)),
          })}
    </p>
  )
}
