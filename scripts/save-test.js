/**
 * Save system checks (npm run test:saves): upgrading old saves, repairing bad
 * values, never touching saves from a newer server, and recovering from a
 * damaged save file through its backup.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SAVE_VERSION, loadSave, migrateSave, readSaveFile, sanitizeSave } from '../src/store/saveFormat.js'

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

// An unversioned save from an old build: coins, pets, no starter bike listed.
const old = { wins: 50, coins: 900, pets: 'dog,cat', owned: 'bike:angel', level: 7, totalSpeed: 300 }
const { save: upgraded, from } = migrateSave(old)
check('old save upgraded to the current version', from === 0 && upgraded.version === SAVE_VERSION)
check('retired currencies and pets dropped', upgraded.coins === undefined && upgraded.pets === undefined)
check('free starter items added', upgraded.owned.includes('bike:starter') && upgraded.owned.includes('bike:angel'))
check('progress kept', upgraded.wins === 50 && upgraded.totalSpeed === 300)
check('new fields start fresh', upgraded.dailyStreak === 0 && upgraded.daily === '{}')

// Damaged values are repaired, good ones untouched.
const { save: repaired, fixed } = sanitizeSave({
  wins: -5,
  rebirths: 2.7,
  totalSpeed: Number.NaN,
  quests: '{oops',
  bike: 42,
  name: 'x'.repeat(99),
  level: 3,
})
check('negative Wins repaired', repaired.wins === 0)
check('fractional rebirths floored', repaired.rebirths === 2)
check('NaN Speed repaired', repaired.totalSpeed === 0)
check('broken JSON replaced', repaired.quests === '{}')
check('wrong type replaced', repaired.bike === 'starter')
check('long name cut', repaired.name.length === 20)
check(
  'repairs are reported, good values left alone',
  ['wins', 'rebirths', 'totalSpeed', 'quests', 'bike', 'name'].every((f) => fixed.includes(f)) && !fixed.includes('level'),
  fixed.join(','),
)

// A save from a newer server is left exactly as it is.
const newer = { version: SAVE_VERSION + 1, wins: 10, futureField: true }
const loaded = loadSave(newer, 'newer')
check('newer save is read-only and untouched', loaded.readOnly && loaded.save.futureField === true && loaded.save.version === SAVE_VERSION + 1)

// Damaged main file: the backup is used.
const dir = mkdtempSync(path.join(tmpdir(), 'bike-saves-'))
const file = path.join(dir, 'players.json')
writeFileSync(file, '{"guest:a": {"wins": 1')
writeFileSync(`${file}.bak`, JSON.stringify({ 'guest:a': { wins: 99, version: SAVE_VERSION } }))
const read = readSaveFile(file)
check('damaged save file falls back to the backup', read.source === 'backup' && read.data['guest:a'].wins === 99)
writeFileSync(file, JSON.stringify({ 'guest:a': { wins: 100 } }))
check('a good main file is preferred', readSaveFile(file).source === 'main')

console.log(process.exitCode ? 'Some checks failed.' : 'All save checks passed.')
