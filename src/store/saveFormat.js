import { existsSync, readFileSync } from 'node:fs'

/**
 * The player save format: its version, how older saves are upgraded, and how
 * every value is checked before the game trusts it.
 *
 * Every save carries `version`. On load a save is upgraded step by step
 * (MIGRATIONS[n] turns version n-1 into n), then each field is checked against
 * FIELD_RULES: wrong types, impossible numbers and broken JSON are replaced with
 * safe values and logged, so one bad save can't crash a lobby or poison the
 * leaderboards. A save from a *newer* server (during a rollback) is loaded but
 * never written back, so it can't be downgraded.
 *
 * To change the format: bump SAVE_VERSION and add MIGRATIONS[SAVE_VERSION].
 */

export const SAVE_VERSION = 3

const JSON_OBJECT = { type: 'json', fallback: '{}' }

/** Every persisted field: type, limits and the value to fall back to. */
export const FIELD_RULES = {
  name: { type: 'string', max: 20, fallback: 'Rider' },
  level: { type: 'number', min: 1, max: 10_000, integer: true, fallback: 1 },
  xp: { type: 'number', min: 0, max: 1e21, fallback: 0 },
  totalSpeed: { type: 'number', min: 0, max: 1e21, fallback: 0 },
  wins: { type: 'number', min: 0, max: 1e15, integer: true, fallback: 0 },
  rebirths: { type: 'number', min: 0, max: 1_000_000, integer: true, fallback: 0 },
  bikeUpg: { type: 'number', min: 0, max: 1_000, integer: true, fallback: 0 },
  bike: { type: 'string', max: 32, fallback: 'starter' },
  trail: { type: 'string', max: 32, fallback: 'none' },
  aura: { type: 'string', max: 32, fallback: 'none' },
  owned: { type: 'string', max: 4_000, fallback: 'bike:starter,trail:none,aura:none' },
  padsOwned: { type: 'string', max: 1_000, fallback: '' },
  items: { type: 'string', max: 20_000, fallback: '' },
  shop: JSON_OBJECT,
  pass2xSpeed: { type: 'boolean', fallback: false },
  pass2xWins: { type: 'boolean', fallback: false },
  dailyAt: { type: 'number', min: 0, max: 1e14, fallback: 0 },
  dailyStreak: { type: 'number', min: 0, max: 1_000, integer: true, fallback: 0 },
  daily: JSON_OBJECT,
  pets: { type: 'string', max: 2_000, fallback: '' },
  petsEquipped: { type: 'string', max: 200, fallback: '' },
  petIndex: { type: 'string', max: 1_000, fallback: '' },
  spinSeconds: { type: 'number', min: 0, max: 36_000, fallback: 0 },
  continueDay: { type: 'number', min: 0, max: 1e7, integer: true, fallback: 0 },
  continuesUsed: { type: 'number', min: 0, max: 255, integer: true, fallback: 0 },
  starTiers: { type: 'number', min: 0, max: 255, integer: true, fallback: 0 },
  chestAt: { type: 'number', min: 0, max: 1e14, fallback: 0 },
  bestStage: { type: 'number', min: 0, max: 255, integer: true, fallback: 0 },
  quests: JSON_OBJECT,
  counters: JSON_OBJECT,
  records: JSON_OBJECT,
  codes: { type: 'array', max: 200, fallback: [] },
  updatedAt: { type: 'number', min: 0, max: 1e14, fallback: 0 },
}

/** Fields older builds wrote that no longer mean anything. */
const LEGACY_FIELDS = ['coins', 'gems', 'pets', 'petsOwned', 'equippedPets', 'giftAt', 'bux']

/** MIGRATIONS[n]: upgrades a version n-1 save to version n (in place). */
export const MIGRATIONS = {
  // v1: saves from before versioning. Drop the old currencies and pets, make
  // sure the free starter cosmetics are owned.
  1: (save) => {
    for (const field of LEGACY_FIELDS) delete save[field]
    const owned = new Set(String(save.owned || '').split(',').filter(Boolean))
    for (const free of ['bike:starter', 'trail:none', 'aura:none']) owned.add(free)
    save.owned = [...owned].join(',')
  },
  // v2: daily login streak and daily quests. Old saves start a fresh streak.
  2: (save) => {
    save.dailyStreak = 0
    if (save.daily === undefined) save.daily = '{}'
    if (save.records === undefined) save.records = '{}'
  },
  // v3: pets (the new system), lucky spin progress, free continues, star rewards.
  3: (save) => {
    save.pets = ''
    save.petsEquipped = ''
    save.petIndex = ''
    save.spinSeconds = 0
    save.continueDay = 0
    save.continuesUsed = 0
    save.starTiers = 0
  },
}

/**
 * Upgrades a save to SAVE_VERSION. Returns `{ save, from, readOnly }`;
 * `readOnly` is set for a save from a newer server, which is left untouched.
 */
export function migrateSave(raw) {
  const save = { ...(raw && typeof raw === 'object' ? raw : {}) }
  const from = Number.isInteger(save.version) ? save.version : 0
  if (from > SAVE_VERSION) return { save, from, readOnly: true }
  for (let v = from + 1; v <= SAVE_VERSION; v += 1) MIGRATIONS[v]?.(save)
  save.version = SAVE_VERSION
  return { save, from, readOnly: false }
}

/** Checks one value against its rule; returns the safe value. */
function cleanValue(value, rule) {
  switch (rule.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return rule.fallback
      let n = Math.min(rule.max, Math.max(rule.min, value))
      if (rule.integer) n = Math.floor(n)
      return n
    }
    case 'string':
      return typeof value === 'string' ? value.slice(0, rule.max) : rule.fallback
    case 'boolean':
      return typeof value === 'boolean' ? value : rule.fallback
    case 'json': {
      if (typeof value !== 'string') return rule.fallback
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? value : rule.fallback
      } catch {
        return rule.fallback
      }
    }
    case 'array':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, rule.max) : rule.fallback
    default:
      return value
  }
}

/**
 * Makes every known field safe. Missing fields stay missing (the game uses its
 * defaults); bad ones are replaced. Returns `{ save, fixed }` with the names of
 * the fields that had to be repaired.
 */
export function sanitizeSave(save) {
  const fixed = []
  const out = { ...save }
  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    if (out[field] === undefined) continue
    const clean = cleanValue(out[field], rule)
    if (clean !== out[field] && !(Array.isArray(clean) && Array.isArray(out[field]) && clean.length === out[field].length)) fixed.push(field)
    out[field] = clean
  }
  return { save: out, fixed }
}

/** Upgrade + repair in one step, for anything read from storage. */
export function loadSave(raw, label = 'save') {
  const { save, from, readOnly } = migrateSave(raw)
  if (readOnly) {
    console.warn(`[saves] ${label} is version ${from}, newer than this server (${SAVE_VERSION}); it will not be overwritten`)
    return { save, readOnly: true }
  }
  const { save: clean, fixed } = sanitizeSave(save)
  if (from < SAVE_VERSION) console.log(`[saves] upgraded ${label} from version ${from} to ${SAVE_VERSION}`)
  if (fixed.length) console.warn(`[saves] repaired ${label}: ${fixed.join(', ')}`)
  return { save: clean, readOnly: false }
}

/**
 * Reads the JSON save file, falling back to its `.bak` copy (the previous good
 * write) when the main file is missing or damaged. Returns `{ data, source }`.
 */
export function readSaveFile(file) {
  for (const [path, source] of [
    [file, 'main'],
    [`${file}.bak`, 'backup'],
  ]) {
    if (!existsSync(path)) continue
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      if (data && typeof data === 'object' && !Array.isArray(data)) return { data, source }
      console.error(`[saves] ${path} is not a save file`)
    } catch (err) {
      console.error(`[saves] could not read ${path}`, err.message)
    }
  }
  return { data: null, source: null }
}
