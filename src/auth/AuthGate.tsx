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

// Longueur du code à usage unique — doit correspondre au réglage "Email OTP
// length" du projet Supabase (Auth > Sign In / Providers > Email), pas une
// valeur fixée par le SDK. Ce projet est configuré à 8 (pas le défaut de 6).
const OTP_LENGTH = 8

// Une PWA installée sur l'écran d'accueil iOS et Safari n'ont pas le même
// stockage local : le vérificateur PKCE posé par signInWithOtp() depuis
// l'app installée n'est pas visible par Safari, qui traite toujours le
// clic du lien reçu par mail (Mail n'ouvre jamais une PWA installée).
// Résultat vérifié en pratique : demander le lien depuis l'app installée
// puis cliquer dessus dans Safari échoue silencieusement ; demander le
// lien depuis Safari fonctionne. Le code à 6 chiffres évite complètement
// le problème : aucune redirection, la vérification se fait dans le même
// onglet/contexte que la demande, qu'il s'agisse de l'app installée ou de
// Safari.
function LoginForm() {
  const { t } = useI18n()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'error' | 'sendError'>('idle')

  async function handleSendCode(e: FormEvent) {
    e.preventDefault()
    setStatus('busy')
    // emailRedirectTo reste renseigné pour le lien de secours inclus dans le
    // mail (fonctionne si demandé et cliqué depuis Safari) — voir commentaire
    // ci-dessus pour pourquoi le code à 6 chiffres est le chemin principal.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
    })
    if (error) {
      setStatus('sendError')
      return
    }
    setStatus('idle')
    setStep('code')
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault()
    setStatus('busy')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) setStatus('error')
    // succès : onAuthStateChange (AuthGate) bascule automatiquement vers l'app
  }

  if (step === 'code') {
    return (
      <main className="login">
        <form onSubmit={handleVerifyCode}>
          <p className="login-status">{t.auth.linkSent}</p>
          <p className="login-status login-hint">{t.auth.checkSpam}</p>
          <label htmlFor="code">{t.auth.codeLabel}</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={status === 'busy'}
          />
          <button type="submit" disabled={status === 'busy' || code.length < OTP_LENGTH}>
            {status === 'busy' ? t.auth.sending : t.auth.verifyCode}
          </button>
          <button
            type="button"
            className="back-link"
            onClick={() => {
              setStep('email')
              setCode('')
              setStatus('idle')
            }}
          >
            {t.auth.changeEmail}
          </button>
          {status === 'error' && <p className="login-status login-error">{t.auth.error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="login">
      <form onSubmit={handleSendCode}>
        <label htmlFor="email">{t.auth.emailLabel}</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t.auth.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === 'busy'}
        />
        <button type="submit" disabled={status === 'busy'}>
          {status === 'busy' ? t.auth.sending : t.auth.sendLink}
        </button>
        {status === 'sendError' && <p className="login-status login-error">{t.auth.sendError}</p>}
      </form>
    </main>
  )
}
