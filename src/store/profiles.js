import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { appendFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Player profiles.
 *
 * Two backends behind one small API (`initProfiles`, `loadProfile`,
 * `saveProfile`, `flushProfiles`, `leaderboards`):
 *
 *  - MongoDB when MONGODB_URI is set (Bloxity Legion injects it: an isolated
 *    database per game and channel). Pods come and go, so a profile is read from
 *    the database each time its player joins, changes are written back in
 *    batches every few seconds, and the leaderboards are a cached query.
 *  - A JSON file in DATA_DIR otherwise (local development): everything lives in
 *    memory and is flushed to disk every few seconds (write-to-temp + rename, so
 *    a crash never leaves a half-written file).
 */

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const FILE = path.join(DATA_DIR, 'players.json')
const MONGODB_URI = process.env.MONGODB_URI || ''
const FLUSH_INTERVAL_MS = 4000
const LEADERBOARD_REFRESH_MS = 30_000

/** Fields copied between a profile and the room's PlayerState. */
export const PERSISTED_FIELDS = [
  'name',
  'level',
  'xp',
  'totalSpeed',
  'wins',
  'rebirths',
  'bikeUpg',
  'bike',
  'trail',
  'aura',
  'owned',
  'padsOwned',
  'items',
  'shop',
  'pass2xSpeed',
  'pass2xWins',
  'dailyAt',
  'chestAt',
  'bestStage',
  'quests',
  'counters',
]

const LEADERBOARD_STATS = ['totalSpeed', 'wins', 'rebirths', 'level']

/** uid -> profile. File mode: every profile. Mongo mode: players seen by this pod. */
const profiles = new Map()
/** uids changed since the last flush. */
const dirty = new Set()
let flushing = null
let database = null
let collection = null
let mongoClient = null
let cachedBoards = emptyBoards()

/** Smoke-test bots (scripts/lobby-test.js) play with `test:` uids and are never saved. */
const isTestUid = (uid) => uid.startsWith('test:')

function emptyBoards() {
  return Object.fromEntries(LEADERBOARD_STATS.map((stat) => [stat, []]))
}

/** Connects to MongoDB (or reads the JSON file). Call once before listening. */
export async function initProfiles() {
  if (MONGODB_URI) {
    const { MongoClient } = await import('mongodb')
    mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 })
    await mongoClient.connect()
    database = mongoClient.db()
    collection = database.collection('profiles')
    await collection.createIndexes(LEADERBOARD_STATS.map((stat) => ({ key: { [stat]: -1 }, name: `top_${stat}` })))
    console.log('[profiles] using MongoDB')
    await refreshLeaderboards()
    setInterval(() => refreshLeaderboards().catch((err) => console.error('[profiles] leaderboards failed', err)), LEADERBOARD_REFRESH_MS).unref()
  } else {
    loadFile()
  }
  setInterval(flushProfiles, FLUSH_INTERVAL_MS).unref()
}

function loadFile() {
  if (!existsSync(FILE)) return
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'))
    for (const [uid, profile] of Object.entries(raw)) {
      if (isTestUid(uid)) dirty.add(uid)
      else profiles.set(uid, profile)
    }
    console.log(`[profiles] loaded ${profiles.size} profiles from ${FILE}`)
  } catch (err) {
    console.error(`[profiles] could not read ${FILE}; starting empty`, err)
  }
}

/** The stored profile, or null for a first-time player. */
export async function loadProfile(uid) {
  if (isTestUid(uid)) return null
  // Unsaved changes made on this pod are the newest copy.
  if (!collection || dirty.has(uid)) return profiles.get(uid) || null
  const doc = await collection.findOne({ _id: uid })
  if (!doc) return null
  const { _id: _ignored, ...profile } = doc
  profiles.set(uid, profile)
  return profile
}

/** Copies the persisted fields of `state` (a PlayerState or plain object). */
export function saveProfile(uid, state, extra = {}) {
  if (isTestUid(uid)) return
  const previous = profiles.get(uid) || {}
  const next = { ...previous, ...extra, updatedAt: Date.now() }
  for (const field of PERSISTED_FIELDS) next[field] = state[field]
  profiles.set(uid, next)
  dirty.add(uid)
}

/** Writes every changed profile out (to MongoDB or the JSON file). */
export async function flushProfiles() {
  if (flushing) return flushing
  if (!dirty.size) return undefined
  const uids = [...dirty]
  dirty.clear()
  flushing = (async () => {
    try {
      if (collection) {
        const ops = uids
          .filter((uid) => profiles.has(uid))
          .map((uid) => ({ updateOne: { filter: { _id: uid }, update: { $set: profiles.get(uid) }, upsert: true } }))
        if (ops.length) await collection.bulkWrite(ops, { ordered: false })
      } else {
        mkdirSync(DATA_DIR, { recursive: true })
        const tmp = `${FILE}.tmp`
        await writeFile(tmp, JSON.stringify(Object.fromEntries(profiles)))
        await rename(tmp, FILE)
      }
    } catch (err) {
      for (const uid of uids) dirty.add(uid)
      console.error('[profiles] save failed', err)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Stores a feedback message from the lobby mailbox. */
export async function recordFeedback(entry) {
  if (collection) {
    await database.collection('feedback').insertOne(entry)
    return
  }
  const file = path.join(DATA_DIR, 'feedback.log')
  mkdirSync(DATA_DIR, { recursive: true })
  const line = [new Date(entry.at).toISOString(), entry.uid, entry.name, entry.text.replace(/\s+/g, ' ')].join('\t') + '\n'
  await appendFile(file, line)
}

/** Saves what's left and closes the database (on shutdown). */
export async function closeProfiles() {
  await flushProfiles()
  await flushing
  await mongoClient?.close()
}

async function refreshLeaderboards() {
  const result = {}
  for (const stat of LEADERBOARD_STATS) {
    const rows = await collection
      .find({ [stat]: { $gt: 0 } }, { projection: { name: 1, [stat]: 1 } })
      .sort({ [stat]: -1 })
      .limit(10)
      .toArray()
    result[stat] = rows.map((p) => ({ name: p.name || 'Rider', value: p[stat] || 0 }))
  }
  cachedBoards = result
}

/** Top 10 per stat across every saved profile. */
export function leaderboards() {
  if (collection) return cachedBoards
  const all = [...profiles.values()]
  const result = {}
  for (const stat of LEADERBOARD_STATS) {
    result[stat] = all
      .filter((p) => (p[stat] || 0) > 0)
      .sort((a, b) => (b[stat] || 0) - (a[stat] || 0))
      .slice(0, 10)
      .map((p) => ({ name: p.name || 'Rider', value: p[stat] || 0 }))
  }
  return result
}
