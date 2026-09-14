import { useEffect, useState } from 'react'
import { useI18n } from './i18n'
import { interpolate } from './i18n/format'
import { getClockDriftHours } from './lib/clockDrift'

export default function ClockDriftWarning() {
  const { t } = useI18n()
  const [driftHours, setDriftHours] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getClockDriftHours().then((hours) => {
      if (!cancelled) setDriftHours(hours)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (driftHours === null) return null

  return (
    <p className="clock-drift-banner">
      {interpolate(t.clockDrift.warning, { hours: Math.round(Math.abs(driftHours)) })}
    </p>
  )
}
