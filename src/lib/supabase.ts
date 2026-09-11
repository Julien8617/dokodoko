import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// La clé anon est publique par nature (site statique) : la seule barrière
// est le RLS côté Supabase (spec v2 §3). Ne jamais mettre la clé
// service_role ici.
//
// Client factice tant que .env n'est pas renseigné (voir .env.example) :
// permet à l'app de démarrer et d'afficher un message clair plutôt qu'un
// écran blanc — AuthGate vérifie `isSupabaseConfigured` avant tout usage.
// flowType 'pkce' : le lien magique renvoie un `?code=` à usage unique,
// échangé en arrière-plan contre la session — jamais de access_token ni de
// refresh_token exposés dans l'URL (contrairement au flux implicite par
// défaut, où ils apparaissent en clair dans la barre d'adresse et peuvent
// être copiés-collés par erreur, comme constaté en pratique).
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true } })
  : (new Proxy(
      {},
      {
        get() {
          throw new Error('Supabase non configuré — voir .env.example')
        },
      },
    ) as SupabaseClient)
