import { existsSync, mkdirSync } from 'node:fs'
import { appendFile, copyFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { SAVE_VERSION, loadSave, readSaveFile } from './saveFormat.js'

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
 *    a crash never leaves a half-written file; the previous file is kept as
 *    players.json.bak and read if the main one is ever damaged).
 *
 * Every save is versioned, upgraded and checked on load (see saveFormat.js). A
 * save from a newer server version is never overwritten, and in MongoDB the
 * write itself refuses to replace a newer-version save (a draining old pod
 * can't clobber what a new one wrote).
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
  'dailyStreak',
  'daily',
  'chestAt',
  'bestStage',
  'quests',
  'counters',
  'records',
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

/** Saves from a newer server version: loaded, never written back. */
const readOnly = new Set()
let flushSoon = null

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
  if (!existsSync(FILE) && !existsSync(`${FILE}.bak`)) return
  const { data, source } = readSaveFile(FILE)
  if (!data) {
    console.error(`[profiles] no readable save file in ${DATA_DIR}; starting empty (the damaged files are left in place)`)
    return
  }
  for (const [uid, raw] of Object.entries(data)) {
    if (isTestUid(uid)) {
      dirty.add(uid)
      continue
    }
    const { save, readOnly: newer } = loadSave(raw, uid)
    if (newer) readOnly.add(uid)
    profiles.set(uid, save)
  }
  console.log(`[profiles] loaded ${profiles.size} profiles from ${source === 'backup' ? `${FILE}.bak (the main file was damaged)` : FILE}`)
}

/** The stored profile, or null for a first-time player. */
export async function loadProfile(uid) {
  if (isTestUid(uid)) return null
  // Unsaved changes made on this pod are the newest copy.
  if (!collection || dirty.has(uid)) return profiles.get(uid) || null
  const doc = await collection.findOne({ _id: uid })
  if (!doc) return null
  const { _id: _ignored, ...raw } = doc
  const { save, readOnly: newer } = loadSave(raw, uid)
  if (newer) readOnly.add(uid)
  else readOnly.delete(uid)
  profiles.set(uid, save)
  return save
}

/** Copies the persisted fields of `state` (a PlayerState or plain object). */
export function saveProfile(uid, state, extra = {}) {
  if (isTestUid(uid) || readOnly.has(uid)) return
  const previous = profiles.get(uid) || {}
  const next = { ...previous, ...extra, version: SAVE_VERSION, updatedAt: Date.now() }
  for (const field of PERSISTED_FIELDS) next[field] = state[field]
  profiles.set(uid, next)
  dirty.add(uid)
}

/** Writes changes out shortly (after rebirths, purchases and claims) instead of waiting for the timer. */
export function saveSoon() {
  if (flushSoon) return
  flushSoon = setTimeout(() => {
    flushSoon = null
    flushProfiles()
  }, 500)
  flushSoon.unref?.()
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
        // Only replace saves at this version or older: a newer server's save wins.
        const notNewer = { $or: [{ version: { $exists: false } }, { version: { $lte: SAVE_VERSION } }] }
        const ops = uids
          .filter((uid) => profiles.has(uid) && !readOnly.has(uid))
          .map((uid) => ({ updateOne: { filter: { _id: uid, ...notNewer }, update: { $set: profiles.get(uid) }, upsert: true } }))
        if (ops.length) {
          try {
            await collection.bulkWrite(ops, { ordered: false })
          } catch (err) {
            // A newer save already exists for these players: the upsert hit its
            // _id. That's the guard working, not a failure.
            const writeErrors = err.writeErrors ?? []
            const blocked = writeErrors.filter((e) => e.code === 11000)
            for (const e of blocked) {
              const uid = ops[e.index]?.updateOne.filter._id
              if (uid) readOnly.add(uid)
              console.warn(`[saves] ${uid} has a newer save; not overwritten`)
            }
            if (!writeErrors.length || blocked.length < writeErrors.length) throw err
          }
        }
      } else {
        mkdirSync(DATA_DIR, { recursive: true })
        const tmp = `${FILE}.tmp`
        await writeFile(tmp, JSON.stringify(Object.fromEntries(profiles)))
        // Keep the last good file as a backup, then swap the new one in.
        if (existsSync(FILE)) await copyFile(FILE, `${FILE}.bak`)
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
