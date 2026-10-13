import { Room, ServerError } from '@colyseus/core'

import {
  DOUBLE_PAD_WINS,
  MAX_PLAYERS_PER_LOBBY,
  SPIN_EVERY_MS,
  canUseDoublePad,
  SPEED_TICK_MS,
  padUnlocked,
  roundGain,
  speedBreakdown,
  winsMultiplier,
} from '../shared/gameData.js'
import { LOBBY_FRONT_Z, getLayout, insideBox, minRecordMs, stageAt, trainPadAt } from '../shared/layout.js'
import {
  addSpeed,
  applyOffline,
  bumpCounter,
  buy,
  checkStarRewards,
  claimDailyQuest,
  claimGift,
  hatchEgg,
  setPets,
  releasePet,
  spinWheel,
  useContinue,
  claimQuest,
  claimTimed,
  ensureDaily,
  markDailyStage,
  equip,
  readJSON,
  rebirth,
  redeemCode,
  syncLevel,
} from '../game/economy.js'
import { PERSISTED_FIELDS, leaderboards, loadProfile, recordFeedback, saveProfile, saveSoon } from '../store/profiles.js'
import { BikeState, PlayerState } from './schema.js'

const layout = getLayout()
const SPAWN = layout.worlds[0].spawn

/** Movement (studs) needed inside one speed window to earn a "+speed" tick. */
const MIN_MOVE_PER_TICK = 0.8
/** A position jump bigger than this is a teleport/respawn, not riding. */
const TELEPORT_DISTANCE = 60

/** Lobby numbers in use across every room in this process ("Lobby 1", "Lobby 2"...). */
const usedLobbyNumbers = new Set()
/** uid -> { room, client }: one live session per profile. */
const activeByUid = new Map()
/** Every lobby running in this process. */
const liveRooms = new Set()
/** Set when this server is shutting down: new riders go to another server. */
let draining = false

/** Close code that tells the client to reconnect straight away (to a fresh server). */
export const MOVE_SERVER_CODE = 4002

/**
 * Drains this server before it shuts down (Bloxity Legion sends SIGTERM on a
 * deploy or scale-down): no new joins, and every rider is moved to a fresh
 * server, those on the course once they're back in a lobby (or `force`).
 * Progress is saved first; the client reconnects through the matchmaker.
 * Returns how many riders are still here.
 */
export function drainLobbies(force = false) {
  draining = true
  let remaining = 0
  for (const room of liveRooms) {
    room.lock()
    for (const client of [...room.clients]) {
      const player = room.state.players.get(client.sessionId)
      if (!force && player && stageAt(layout, player.x, player.z)) {
        remaining += 1
        continue
      }
      room.persist(client.sessionId)
      client.leave(MOVE_SERVER_CODE, 'Moving you to a new server')
    }
  }
  return remaining
}

export const lobbyCount = () => liveRooms.size

function claimLobbyNumber() {
  let n = 1
  while (usedLobbyNumbers.has(n)) n += 1
  usedLobbyNumbers.add(n)
  return n
}

const clean = (text, max) =>
  String(text ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max)

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback)
const fail = (error) => ({ ok: false, error })

/**
 * One lobby of up to eight riders.
 *
 * Colyseus locks the room once `maxClients` is reached, so `joinOrCreate` from the
 * ninth player automatically spins up a fresh lobby — no custom matchmaking needed.
 *
 * Movement is client-driven (the client sends its transform ~20x/sec); everything
 * that is worth anything — speed ticks, levels, wins, purchases — is decided
 * here and synced back through the room state.
 */
export class BikeRoom extends Room {
  maxClients = MAX_PLAYERS_PER_LOBBY
  patchRate = 50
  state = new BikeState()

  onAuth() {
    if (draining) throw new ServerError(503, 'This server is restarting')
    return true
  }

  onCreate() {
    liveRooms.add(this)
    this.lobbyNumber = claimLobbyNumber()
    this.state.lobby = this.lobbyNumber
    this.setMetadata({ lobby: this.lobbyNumber })
    /** sessionId -> per-connection bookkeeping that never needs syncing. */
    this.sessions = new Map()

    // The client asks for this once its handlers are registered; anything sent
    // from onJoin itself can arrive before then and be dropped.
    this.handle('hello', (client, _player, session) => {
      client.send('welcome', {
        lobby: this.lobbyNumber,
        roomId: this.roomId,
        maxPlayers: this.maxClients,
        roster: session.roster,
        isNew: session.isNew,
        offline: session.offline,
        // Lets the client line its countdowns up with the server clock.
        serverTime: Date.now(),
      })
      client.send('leaderboards', leaderboards())
    })
    this.handle('move', this.onMove)
    this.handle('jump', this.onJump)
    this.handle('pad', this.onPad)
    this.handle('record', this.onRecord)
    this.handle('chat', this.onChat)
    this.handle('feedback', this.onFeedback)
    this.handle('avatar', (client, player, _session, message) => {
      if (typeof message.avatar === 'string' && message.avatar.length < 4000) {
        player.avatar = message.avatar
      }
    })
    this.handle('buy', (client, player, session, message) => {
      this.reply(client, buy(player, session, message), 'buy')
    })
    this.handle('dailyQuest', (client, player, session, message) => {
      this.reply(client, claimDailyQuest(player, session, Number(message.index)), 'claim')
    })
    this.handle('gift', (client, player) => this.reply(client, claimGift(player), 'gift'))
    this.handle('spin', (client, player) => this.reply(client, spinWheel(player), 'spin'))
    this.handle('hatch', (client, player, _session, message) => this.reply(client, hatchEgg(player, String(message.egg)), 'hatch'))
    this.handle('pets', (client, player, _session, message) => {
      if (message.release) return this.reply(client, releasePet(player, String(message.release)), 'pets')
      return this.reply(client, message.best ? setPets(player, 'best') : setPets(player, message.equip), 'pets')
    })
    this.handle('continue', (client, player, session, message) =>
      this.reply(client, useContinue(player, session, { gid: Number(message.gid), via: message.via }), 'continue'),
    )
    this.handle('equip', (client, player, _session, message) => {
      this.reply(client, equip(player, message), 'equip')
    })
    this.handle('rebirth', (client, player) => {
      this.reply(client, rebirth(player), 'rebirth')
    })
    this.handle('claim', (client, player, session, message) => {
      const result =
        message.what === 'quest'
          ? claimQuest(player, session, message.id)
          : claimTimed(player, message.what)
      this.reply(client, result, 'claim')
    })
    this.handle('code', (client, player, session, message) => {
      this.reply(client, redeemCode(player, session, message.code), 'code')
    })

    this.setSimulationInterval(() => this.tick(), 100)
    this.clock.setInterval(() => this.persistAll(), 10_000)
    this.clock.setInterval(() => this.broadcast('leaderboards', leaderboards()), 15_000)
  }

  /** Registers a message handler that only runs for a fully joined player. */
  handle(type, handler) {
    this.onMessage(type, (client, message) => {
      const player = this.state.players.get(client.sessionId)
      const session = this.sessions.get(client.sessionId)
      if (!player || !session) return
      handler.call(this, client, player, session, message && typeof message === 'object' ? message : {})
    })
  }

  reply(client, result, action) {
    client.send('result', {
      action,
      ok: result.ok,
      error: result.error,
      toast: result.toast,
      reward: result.reward,
      rebirth: result.rebirth,
      celebrate: result.celebrate,
      streakDay: result.streakDay,
      hatch: result.hatch,
      spin: result.spin,
      continued: result.continued,
    })
    if (result.levelUp) client.send('levelup', result.levelUp)
    // Spending, rebirths and rewards are saved straight away, not on the next timer.
    if (result.ok) {
      this.persist(client.sessionId)
      saveSoon()
    }
  }

  async onJoin(client, options = {}) {
    const uid = clean(options.uid, 80) || `anon:${client.sessionId}`

    // The same profile signing in again (second tab, reconnect from another
    // device): save the old session and close it so progress can't fork.
    const previous = activeByUid.get(uid)
    if (previous && previous.client !== client) {
      previous.room.persist(previous.client.sessionId)
      previous.client.leave(4001, 'You joined from another window')
    }

    const profile = await loadProfile(uid)
    const player = new PlayerState()
    if (profile) {
      for (const field of PERSISTED_FIELDS) {
        if (profile[field] !== undefined && typeof profile[field] === typeof player[field]) {
          player[field] = profile[field]
        }
      }
    }
    // Levels come from Speed; keeps older saves consistent with the current curve.
    syncLevel(player)
    // Offline earnings: the best treadmill kept training while you were away.
    const offline = profile?.updatedAt ? applyOffline(player, Date.now() - profile.updatedAt) : null
    // Playtime gifts start over each session; the spin keeps its playtime progress.
    const joinedAt = Date.now()
    player.sessionStart = joinedAt
    player.giftsClaimed = 0
    player.spinReadyAt = joinedAt + Math.max(0, SPIN_EVERY_MS - (profile?.spinSeconds ?? 0) * 1000)
    player.name = clean(options.name, 20) || profile?.name || 'Rider'
    if (typeof options.avatar === 'string' && options.avatar.length < 4000) player.avatar = options.avatar
    player.x = SPAWN.x + (Math.random() - 0.5) * 8
    player.y = SPAWN.y
    player.z = SPAWN.z + (Math.random() - 0.5) * 4
    player.r = SPAWN.yaw

    const roster = []
    this.state.players.forEach((other) => roster.push(other.name))

    this.state.players.set(client.sessionId, player)
    this.sessions.set(client.sessionId, {
      uid,
      client,
      counters: readJSON(player.counters, {}),
      quests: readJSON(player.quests, {}),
      codes: Array.isArray(profile?.codes) ? [...profile.codes] : [],
      moved: 0,
      lastGainAt: 0,
      lastPadAt: 0,
      lastChatAt: 0,
      jumpWindow: { start: 0, count: 0 },
      roster,
      isNew: !profile,
      offline,
      /** Islands stood on since leaving the lobby (where a continue may resume). */
      runIslands: new Set(),
    })
    ensureDaily(player, this.sessions.get(client.sessionId))
    activeByUid.set(uid, { room: this, client })

    this.broadcast('joined', { name: player.name }, { except: client })
    console.log(`[lobby ${this.lobbyNumber}] ${player.name} joined (${this.state.players.size}/${this.maxClients})`)
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    const session = this.sessions.get(client.sessionId)
    this.persist(client.sessionId)
    if (session && activeByUid.get(session.uid)?.client === client) activeByUid.delete(session.uid)
    this.state.players.delete(client.sessionId)
    this.sessions.delete(client.sessionId)
    if (player) {
      this.broadcast('left', { name: player.name })
      console.log(`[lobby ${this.lobbyNumber}] ${player.name} left (${this.state.players.size}/${this.maxClients})`)
    }
  }

  onDispose() {
    liveRooms.delete(this)
    this.persistAll()
    usedLobbyNumbers.delete(this.lobbyNumber)
  }

  persist(sessionId) {
    const player = this.state.players.get(sessionId)
    const session = this.sessions.get(sessionId)
    if (!player || !session) return
    // A newer window owns this profile now; don't overwrite its progress.
    const owner = activeByUid.get(session.uid)
    if (owner && owner.client !== session.client) return
    // Spin progress is playtime: save how much of the wait is already done.
    const spinSeconds = Math.min(SPIN_EVERY_MS, Math.max(0, SPIN_EVERY_MS - (player.spinReadyAt - Date.now()))) / 1000
    saveProfile(session.uid, player, { codes: session.codes, spinSeconds })
  }

  persistAll() {
    for (const sessionId of this.sessions.keys()) this.persist(sessionId)
  }

  /* -------------------------------------------------------------------------
   * Simulation: speed ticks and stage progress
   * ----------------------------------------------------------------------- */

  tick() {
    const now = Date.now()
    const others = Math.max(0, this.state.players.size - 1)

    this.state.players.forEach((player, sessionId) => {
      const session = this.sessions.get(sessionId)
      if (!session) return

      if (now - session.lastGainAt >= SPEED_TICK_MS) {
        const moved = session.moved
        session.moved = 0
        // Riding pays, and so does pedalling on an unlocked treadmill while standing still.
        const pad = trainPadAt(layout, player.x, player.y, player.z)
        const treadmill = pad && !player.air && padUnlocked(pad, player)
        if (moved >= MIN_MOVE_PER_TICK || treadmill) {
          session.lastGainAt = now
          const padMult = treadmill ? pad.mult : 1
          const gain = roundGain(speedBreakdown(player, { padMult, others }).total)
          const levelUp = addSpeed(player, gain)
          bumpCounter(player, session, 'gained', gain)
          if (treadmill) bumpCounter(player, session, 'train', SPEED_TICK_MS / 1000)
          session.client.send('gain', { n: gain, pad: padMult })
          if (levelUp) session.client.send('levelup', levelUp)
        }
      }

      const stage = stageAt(layout, player.x, player.z)
      const onIsland = stage && player.z <= stage.plateauZ0 - 2 && player.y >= stage.floorY - 0.5
      if (onIsland && stage.gid > player.bestStage) player.bestStage = stage.gid
      if (onIsland) markDailyStage(player, session, stage.gid)
      if (onIsland) session.runIslands.add(stage.gid)
      else if (player.z > LOBBY_FRONT_Z) session.runIslands.clear()
      // New day while playing: fresh daily quests.
      if (session.dailyDay !== Math.floor(now / 86_400_000)) ensureDaily(player, session, now)
    })
  }

  /* -------------------------------------------------------------------------
   * Messages
   * ----------------------------------------------------------------------- */

  onMove(_client, player, session, m) {
    const x = num(m.x, player.x)
    const y = num(m.y, player.y)
    const z = num(m.z, player.z)
    const moved = Math.hypot(x - player.x, z - player.z)
    if (moved < TELEPORT_DISTANCE) session.moved += moved

    player.x = x
    player.y = y
    player.z = z
    player.r = num(m.r, player.r)
    player.s = Math.min(Math.max(num(m.s), 0), 400)
    player.air = Boolean(m.a)
    if (Number.isInteger(m.f)) player.flips = m.f & 0xffff
  }

  onJump(_client, player, session, { air }) {
    // Counted for the jump and trick quests; capped so a macro can't farm them.
    const now = Date.now()
    const w = session.jumpWindow
    if (now - w.start > 1000) {
      w.start = now
      w.count = 0
    }
    w.count += 1
    if (w.count > 12) return
    bumpCounter(player, session, 'jumps', 1)
    if (air) bumpCounter(player, session, 'tricks', 1)
  }

  onPad(client, player, session, { stage, kind }) {
    const now = Date.now()
    if (now - session.lastPadAt < 1500) return
    const pad = layout.pads.find((p) => p.stage === stage && p.kind === kind)
    if (!pad || !insideBox(pad, player.x, player.y, player.z, 3)) {
      client.send('result', { action: 'pad', ...fail('Too far from the pad') })
      return
    }
    if (kind === 'double' && !canUseDoublePad(player)) {
      client.send('result', { action: 'pad', ...fail(`Hold ${DOUBLE_PAD_WINS} Wins to use the 2x pad!`) })
      return
    }
    session.lastPadAt = now
    const wins = Math.max(1, Math.round(pad.wins * winsMultiplier(player, { double: kind === 'double' })))
    player.wins += wins
    bumpCounter(player, session, 'wins', wins)
    if (stage > player.bestStage) player.bestStage = stage
    client.send('reward', { wins, stage, source: 'pad' })
  }

  /** A stage reached faster than ever: keep it if it's plausible and the rider is there. */
  onRecord(_client, player, _session, { gid, ms }) {
    const stage = layout.stages.find((s) => s.gid === gid)
    if (!stage || !Number.isFinite(ms) || ms < minRecordMs(stage) || ms > 3_600_000) return
    if (stageAt(layout, player.x, player.z)?.gid !== gid) return
    const records = readJSON(player.records, {})
    if (records[gid] && records[gid] <= ms) return
    records[gid] = Math.round(ms)
    player.records = JSON.stringify(records)
    // New stars can unlock star rewards.
    const stars = checkStarRewards(player)
    if (stars.given.length) {
      _client.send('starReward', { total: stars.total, given: stars.given })
      this.persist(_client.sessionId)
      saveSoon()
    }
  }

  onFeedback(client, player, session, { text }) {
    const now = Date.now()
    if (now - (session.lastFeedbackAt || 0) < 30_000) {
      client.send('result', { action: 'feedback', ...fail('Thanks! Please wait a bit before sending more.') })
      return
    }
    const message = clean(text, 1000)
    if (message.length < 3) return
    session.lastFeedbackAt = now
    recordFeedback({ at: now, uid: session.uid, name: player.name, text: message }).catch((err) => console.error('[feedback] could not save', err))
    client.send('result', { action: 'feedback', ok: true, toast: 'Thanks for the feedback! 💌' })
  }

  onChat(client, player, session, { text }) {
    const now = Date.now()
    if (now - session.lastChatAt < 700) return
    const message = clean(text, 120)
    if (!message) return
    session.lastChatAt = now
    this.broadcast('chat', { sid: client.sessionId, name: player.name, text: message })
  }
}
