// Un `if (error) throw error` sur le résultat d'un appel Supabase (le
// patron partout dans ce dépôt) ne lance PAS un vrai `Error` : postgrest-js
// ne construit un `PostgrestError` (qui hérite d'`Error`) que sur le
// chemin `throwOnError()` — le chemin `{data, error}` standard, utilisé
// ici partout, fait `error = JSON.parse(body)`, un objet PLAT avec un
// champ `message`, jamais `instanceof Error`.
//
// `err instanceof Error ? err.message : String(err)` tombait donc
// systématiquement dans le repli pour une erreur Supabase, et affichait
// littéralement "[object Object]" — le défaut du 17/18 septembre (spec
// 2.35, §3) : l'audit du 15 avait vérifié que l'erreur REMONTE jusqu'à
// l'écran, pas qu'elle y est LISIBLE une fois arrivée. Cette fonction
// remplace le patron partout : elle extrait `message` aussi bien d'un
// vrai `Error` que d'un objet Supabase brut, et ne renvoie JAMAIS l'objet
// lui-même — seulement son message, ou un repli EXPLICITE fourni par
// l'appelant quand il n'y en a pas.
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}
