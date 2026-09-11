import { useEffect, useState, type ReactNode } from 'react'

// Écran d'ouverture : 4 tuiles qui tombent et s'empilent en carré 2×2.
// Purement décoratif — le nom どこどこ est ici stylisé en katakana
// (ドコドコ), jamais traduit, comme le reste de la marque (§6.7).
const TILES = ['ド', 'コ', 'ド', 'コ']
const DROP_MS = 700
const STAGGER_MS = 130
const HOLD_MS = 500
const FADE_MS = 400

export default function Splash({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'falling' | 'fading' | 'done'>('falling')

  useEffect(() => {
    const totalFall = DROP_MS + TILES.length * STAGGER_MS + HOLD_MS
    const fadeTimer = setTimeout(() => setPhase('fading'), totalFall)
    const doneTimer = setTimeout(() => setPhase('done'), totalFall + FADE_MS)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  return (
    <>
      {children}
      {phase !== 'done' && (
        <div className={`splash-overlay${phase === 'fading' ? ' fading' : ''}`}>
          <div className="splash-square">
            {TILES.map((char, i) => (
              <span
                key={i}
                className="splash-tile"
                style={{ animationDelay: `${i * STAGGER_MS}ms` }}
              >
                {char}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
