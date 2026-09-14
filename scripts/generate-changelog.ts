// Source unique du changelog : src/changelog.ts (affiché dans l'app). Ce
// script en dérive CHANGELOG.md (lisible sur GitHub) et la version de
// package.json — pour ne plus avoir trois écritures manuelles à
// synchroniser à la main. Lancé via `npm run changelog`, appelé
// automatiquement en `prebuild`. Node 24+ exécute ce .ts directement (type
// stripping natif), aucune dépendance de build supplémentaire.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGELOG, type ChangelogEntry } from '../src/changelog.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function renderEntry(entry: ChangelogEntry): string {
  const items = entry.items.map((item) => `- ${item}`).join('\n')
  return `## ${entry.version} — ${entry.date}\n\n${items}\n`
}

function renderChangelogMd(): string {
  const header = [
    '# Changelog',
    '',
    "Généré depuis `src/changelog.ts` par `npm run changelog` (appelé en",
    "`prebuild`) — ne pas éditer directement, les modifications seraient",
    'écrasées au prochain build. Modifier `src/changelog.ts`, relancer le',
    'build.',
    '',
  ].join('\n')
  return header + '\n' + CHANGELOG.map(renderEntry).join('\n')
}

function updatePackageVersion(version: string): boolean {
  const path = resolve(root, 'package.json')
  const raw = readFileSync(path, 'utf8')
  const pkg = JSON.parse(raw)
  if (pkg.version === version) return false
  pkg.version = version
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  return true
}

const latest = CHANGELOG[0]
if (!latest) throw new Error('src/changelog.ts : CHANGELOG est vide')

writeFileSync(resolve(root, 'CHANGELOG.md'), renderChangelogMd(), 'utf8')
const versionChanged = updatePackageVersion(latest.version)

console.log(`CHANGELOG.md régénéré depuis src/changelog.ts (${CHANGELOG.length} versions).`)
console.log(
  versionChanged
    ? `package.json mis à jour : version -> ${latest.version}`
    : `package.json déjà à jour (${latest.version}).`,
)
