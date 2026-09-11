import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useI18n } from '../i18n'

// Porte d'authentification par lien magique (spec v2 §3, §12 étape 1).
// N'importe quelle adresse peut demander un lien : la liste blanche n'est
// pas appliquée ici mais côté RLS (fonction `is_email_allowed`) — un
// utilisateur non autorisé obtient une session valide mais aucune donnée.
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  if (!isSupabaseConfigured) return <ConfigMissing />
  if (session === undefined) return null // chargement initial, évite un flash du formulaire
  if (session === null) return <LoginForm />
  return <>{children}</>
}

function ConfigMissing() {
  return (
    <main className="login">
      <p className="login-status login-error">
        Supabase non configuré — copier .env.example en .env et renseigner
        VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
      </p>
    </main>
  )
}

function LoginForm() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    // Sans emailRedirectTo explicite, Supabase retombe sur
    // window.location.origin — qui ne contient jamais de chemin. Sur un
    // site de projet GitHub Pages (/dokodoko/), ça renvoie à la racine du
    // compte, où rien n'est servi (404). BASE_URL (Vite) porte ce chemin.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
    })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <main className="login">
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">{t.auth.emailLabel}</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t.auth.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'sending' || status === 'sent'}
        />
        <button type="submit" disabled={status === 'sending' || status === 'sent'}>
          {status === 'sending' ? t.auth.sending : t.auth.sendLink}
        </button>
        {status === 'sent' && <p className="login-status">{t.auth.linkSent}</p>}
        {status === 'error' && <p className="login-status login-error">{t.auth.error}</p>}
      </form>
    </main>
  )
}
