// Lecture des fichiers d'import (§7, spec 2.32) : séparateur `,`/`;`
// détecté automatiquement, UTF-8 et Shift-JIS acceptés (un export Excel
// japonais sort en Shift-JIS), codes lus comme du texte brut — aucune
// dépendance nouvelle, SheetJS n'arrive qu'en octobre avec l'export §9.

// L'essai UTF-8 doit être STRICT (fatal: true) et passer EN PREMIER :
// Shift-JIS décode presque n'importe quel flux d'octets sans lever
// d'erreur, y compris un fichier UTF-8 valide — il produirait un charabia
// silencieux plutôt qu'un échec détectable si on l'essayait en premier.
export async function decodeImportFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = hasBom ? bytes.subarray(3) : bytes
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return new TextDecoder('shift_jis').decode(body)
  }
}

function detectSeparator(text: string): ',' | ';' {
  const headerLine = text.split(/\r?\n/, 1)[0] ?? ''
  const commas = (headerLine.match(/,/g) ?? []).length
  const semicolons = (headerLine.match(/;/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

// RFC 4180 simplifié : guillemets compris (séparateur ou retour à la ligne
// dans un champ cité, `""` pour un guillemet littéral) — suffisant pour un
// export Excel/Numbers, pas un parseur CSV général.
export function parseCsv(text: string): string[][] {
  const separator = detectSeparator(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  function pushField() {
    row.push(field)
    field = ''
  }
  function pushRow() {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === separator) {
      pushField()
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      pushRow()
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) pushRow()

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

export interface CsvTable {
  header: string[]
  rows: { line: number; cells: string[] }[]
}

// `line` = numéro de ligne dans le fichier (l'en-tête est la ligne 1),
// pour que le motif de rejet pointe exactement où Julien doit corriger.
export function parseCsvTable(text: string): CsvTable {
  const allRows = parseCsv(text)
  if (allRows.length === 0) return { header: [], rows: [] }
  const header = allRows[0].map((h) => h.trim())
  const rows = allRows.slice(1).map((cells, idx) => ({ line: idx + 2, cells }))
  return { header, rows }
}

export function cellByName(header: string[], cells: string[], name: string): string {
  const idx = header.indexOf(name)
  if (idx === -1) return ''
  return (cells[idx] ?? '').trim()
}

export interface ImportRowResult<T> {
  line: number
  data: T
}

export interface ImportRejection {
  line: number
  reason: string
}

export interface ImportPreview<T> {
  valid: ImportRowResult<T>[]
  rejected: ImportRejection[]
}

export class MissingColumnsError extends Error {
  columns: string[]
  constructor(columns: string[]) {
    super(`Colonnes manquantes : ${columns.join(', ')}`)
    this.columns = columns
  }
}

export function requireColumns(header: string[], required: string[]): void {
  const missing = required.filter((c) => !header.includes(c))
  if (missing.length > 0) throw new MissingColumnsError(missing)
}
