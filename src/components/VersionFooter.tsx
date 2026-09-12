import { useState } from 'react'
import { CHANGELOG } from '../changelog'

// Discret : juste "vX.Y.Z" par défaut, le détail ne s'affiche qu'au tap.
export default function VersionFooter() {
  const [open, setOpen] = useState(false)

  return (
    <div className="version-footer">
      <button type="button" className="build-version" onClick={() => setOpen((v) => !v)}>
        v{__APP_VERSION__}
      </button>
      {open && (
        <ul className="changelog">
          {CHANGELOG.map((entry) => (
            <li key={entry.version}>
              <p className="changelog-heading">
                v{entry.version} — {entry.date}
              </p>
              <ul>
                {entry.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
