// Mitigation immédiate, sans migration (arbitrage architecture 2026-09-15,
// spec v2 §3.1) : `comptage_lignes.ts` est désormais l'horloge du téléphone,
// pas `default now()` côté serveur (voir saveCasierLigne). Le vrai correctif
// — un compteur monotone par appareil, immunisé à l'horloge — est reporté au
// chantier de clôture. En attendant, on détecte une horloge très décalée
// (le cas réel : téléphone à la mauvaise date, pas une dérive de secondes)
// pour prévenir plutôt que de laisser une correction perdre silencieusement
// face à l'original qu'elle corrige.
const DRIFT_THRESHOLD_MS = 5 * 60 * 1000

// Lit l'en-tête HTTP `Date` de la réponse — présent sur toute réponse, y
// compris une 401 sans apikey, et toujours lisible en CORS (en-tête
// "simple"). Pas besoin de fonction SQL ni de RPC dédiée.
export async function getClockDriftHours(): Promise<number | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!url) return null

  try {
    const before = Date.now()
    const response = await fetch(`${url}/rest/v1/`, { method: 'HEAD' })
    const serverDateHeader = response.headers.get('date')
    if (!serverDateHeader) return null

    const serverTime = new Date(serverDateHeader).getTime()
    if (Number.isNaN(serverTime)) return null

    const roundTripMs = Date.now() - before
    const localTimeAtServerResponse = before + roundTripMs / 2
    const driftMs = localTimeAtServerResponse - serverTime

    if (Math.abs(driftMs) < DRIFT_THRESHOLD_MS) return null
    return driftMs / (60 * 60 * 1000)
  } catch {
    // Pas de réseau au démarrage : ni vrai ni faux, on ne prétend rien.
    return null
  }
}
