/**
 * Game rules shared by the client and the Colyseus server.
 *
 * The server repo keeps an identical copy in `src/shared/` — after editing anything
 * in this folder run `npm run sync-shared` in the server repo. Everything that
 * decides a reward (prices, multipliers, pad positions) lives here so both sides
 * always agree.
 */

export const GAME_TITLE = '+1 Double Jump Bike Escape'
export const ROOM_NAME = 'bike_escape'
/** Colyseus locks a room at this size; the next `joinOrCreate` opens a new lobby. */
export const MAX_PLAYERS_PER_LOBBY = 8

/** Units are Roblox-style studs: a character is ~5 tall. */
export const PHYSICS = Object.freeze({
  gravity: 150,
  jumpVelocity: 44,
  radius: 1.1,
  height: 5.4,
  stepHeight: 1.3,
  maxMoveSpeed: 120,
  /** Terminal falling speed. */
  maxFallSpeed: 160,
})

/** Server awards "+speed" at most this often while a player keeps moving. */
export const SPEED_TICK_MS = 400
export const DAILY_COOLDOWN_MS = 24 * 60 * 60_000
export const CHEST_COOLDOWN_MS = 15 * 60_000
export const ITEM_RESTOCK_MS = 5 * 60_000
export const RESTOCK_WINS = 25
export const SHOP_SLOTS = 4

/** Small seeded PRNG so every client and the server generate the same things. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------------------------------
 * Progression formulas
 * ------------------------------------------------------------------------- */

/** Speed XP needed to finish `level` (Lvl 10 -> 283, Lvl 11 -> 410). */
export function xpForLevel(level) {
  if (level <= 12) return Math.floor(10 * 1.45 ** (level - 1))
  return Math.floor(10 * 1.45 ** 11 * 1.18 ** (level - 12))
}

/** "Max Bike Speed" — also the bike's top speed in studs/sec. Lvl 11 -> 40. */
export const bikeSpeedFor = (level, upgrades = 0) => 10 + 3 * (level - 1) + upgrades

/** Total jumps per air-time: the ground jump plus (level - 1) mid-air jumps. */
export const jumpsFor = (level) => Math.max(1, level)

/** Level needed to rebirth (it resets your level to 1). */
export const REBIRTH_LEVEL = 10
export const rebirthLevelFor = () => REBIRTH_LEVEL
/**
 * Rebirths gained by rebirthing at `level`: 1 at level 10, then growing fast, so
 * the higher you climb before rebirthing the more you get (lvl 20 -> 46, lvl 40 -> 243).
 */
export const rebirthGainFor = (level) => (level < REBIRTH_LEVEL ? 0 : Math.max(1, Math.floor((level - REBIRTH_LEVEL + 1) ** 1.6)))
/** Each rebirth is a permanent +50% Speed XP. */
export const rebirthBonus = (rebirths) => rebirths * 0.5
export const bikeSpeedUpgradeCost = (upgrades) => 5 * (upgrades + 1)
/** +10% per other player in the lobby, capped at +50%. */
export const friendBonus = (others) => Math.min(Math.max(others, 0), 5) * 0.1

/* ---------------------------------------------------------------------------
 * Worlds and stages.
 *
 * All of a world's stages sit at the same height, separated by gaps with a
 * deadly floor. `jumps` is the level (= jumps per air-time) needed to get into
 * that stage: for stage 1 it's the wall up from the lobby, for every other
 * stage it's the gap in front of it (see `gapLengthFor` in layout.js). Every
 * stage has a global id (gid): World 1 is 1-10 plus its finish (11), World 2 is
 * 12-21 plus its finish (22).
 * ------------------------------------------------------------------------- */

const W1_STAGES = [
  { name: 'Starter Stage', theme: 'starter', wins: 1, jumps: 2, color: '#f4f4f4' },
  { name: 'Forest Stage', theme: 'forest', wins: 3, jumps: 4, color: '#3fd16b' },
  { name: 'Cloud Stage', theme: 'cloud', wins: 5, jumps: 7, color: '#2f9cf6' },
  { name: 'Volcano Stage', theme: 'volcano', wins: 10, jumps: 10, color: '#d8302c' },
  { name: 'Desert Stage', theme: 'desert', wins: 20, jumps: 14, color: '#3fd16b' },
  { name: 'Ice Stage', theme: 'ice', wins: 40, jumps: 18, color: '#1f7ca8' },
  { name: 'Candy Stage', theme: 'candy', wins: 75, jumps: 23, color: 'rainbow' },
  { name: 'Neon Stage', theme: 'neon', wins: 150, jumps: 28, color: '#b13fe0' },
  { name: 'Space Stage', theme: 'space', wins: 300, jumps: 34, color: '#8fd12f' },
  { name: 'Rainbow Stage', theme: 'rainbow', wins: 600, jumps: 40, color: '#2f9cf6' },
]

const W2_STAGES = [
  { name: 'Jungle Stage', theme: 'jungle', wins: 1500, jumps: 42, color: '#2f9e3a' },
  { name: 'Beach Stage', theme: 'beach', wins: 2500, jumps: 45, color: '#ffcf5a' },
  { name: 'Toxic Stage', theme: 'toxic', wins: 4000, jumps: 48, color: '#8cff3a' },
  { name: 'Haunted Stage', theme: 'haunted', wins: 6500, jumps: 51, color: '#7a4dff' },
  { name: 'Crystal Stage', theme: 'crystal', wins: 10000, jumps: 54, color: '#7ff3ff' },
  { name: 'Factory Stage', theme: 'factory', wins: 15000, jumps: 57, color: '#9aa3b2' },
  { name: 'Sakura Stage', theme: 'sakura', wins: 25000, jumps: 60, color: '#ff8fd1' },
  { name: 'Magma Stage', theme: 'magma', wins: 40000, jumps: 63, color: '#ff5a1f' },
  { name: 'Galaxy Stage', theme: 'galaxy', wins: 65000, jumps: 66, color: '#9b5cff' },
  { name: 'Golden Stage', theme: 'golden', wins: 100000, jumps: 70, color: 'rainbow' },
]

export const WORLDS = [
  {
    id: 1,
    name: 'World 1',
    originX: 0,
    stages: W1_STAGES,
    finish: { name: 'You Escaped!', theme: 'finish', wins: 1000, jumps: 46 },
    /** Best stage (gid) and rebirths needed before the world opens. */
    unlock: { stage: 0, rebirths: 0 },
    gidOffset: 0,
  },
  {
    id: 2,
    name: 'World 2',
    originX: 3000,
    stages: W2_STAGES,
    finish: { name: 'World 2 Escaped!', theme: 'finish', wins: 150000, jumps: 75 },
    unlock: { stage: 11, rebirths: 10 },
    gidOffset: 11,
  },
]

/** Kept for code that only deals with World 1 (quests, HUD defaults). */
export const STAGES = W1_STAGES
export const WORLD2_UNLOCK = WORLDS[1].unlock

export function worldUnlocked(worldId, player) {
  const unlock = WORLDS[worldId - 1]?.unlock
  if (!unlock) return false
  return (player?.bestStage ?? 0) >= unlock.stage && (player?.rebirths ?? 0) >= unlock.rebirths
}

/** World 2 sits this far along +X; anything past the midpoint is World 2. */
export const worldAtX = (x) => (x > WORLDS[1].originX / 2 ? 2 : 1)

/* ---------------------------------------------------------------------------
 * Bikes. `mult` multiplies speed gained.
 *  shop 'pad'  - cheaper bikes on the cyan pads by the World 1 course entrance
 *  shop 'wins' - the World 1 Wins Shop gallery
 *  shop 'w2'   - the World 2 bike gallery (needs World 2 unlocked)
 * ------------------------------------------------------------------------- */

export const BIKES = [
  { id: 'starter', name: 'Starter Bike', mult: 1, price: 0, currency: 'wins', shop: 'free', frame: '#2b2f3a', accent: '#f6d33c', rim: '#f6d33c' },
  { id: 'angel', name: 'Angel Bike', mult: 1.5, price: 15, currency: 'wins', shop: 'pad', frame: '#f6f2e8', accent: '#ffd76a', rim: '#ffffff', extra: 'wings' },
  { id: 'dragon', name: 'Dragon Bike', mult: 2, price: 25, currency: 'wins', shop: 'pad', frame: '#3aa14a', accent: '#e0463c', rim: '#1d5e28', extra: 'dragon' },
  { id: 'six7', name: '67 Bike', mult: 3, price: 40, currency: 'wins', shop: 'pad', frame: '#2f7bff', accent: '#ffffff', rim: '#7fd4ff', extra: 'plate' },
  { id: 'ufo', name: 'UFO Bike', mult: 5, price: 60, currency: 'wins', shop: 'pad', frame: '#4b5563', accent: '#36f0ff', rim: '#36f0ff', extra: 'ufo', glow: true },
  { id: 'shark', name: 'Shark Bike', mult: 7, price: 90, currency: 'wins', shop: 'pad', frame: '#5f8fb8', accent: '#ffffff', rim: '#c9e6ff', extra: 'fin' },
  { id: 'pumpkin', name: 'Pumpkin Bike', mult: 10, price: 130, currency: 'wins', shop: 'pad', frame: '#ff8a1f', accent: '#2f9e3a', rim: '#3b2a1a', extra: 'horns' },
  { id: 'neon', name: 'Neon Bike', mult: 14, price: 150, currency: 'wins', shop: 'wins', frame: '#ff3df2', accent: '#3dfffa', rim: '#3dfffa', glow: true },
  { id: 'lava', name: 'Lava Bike', mult: 20, price: 400, currency: 'wins', shop: 'wins', frame: '#2a1a14', accent: '#ff7a1a', rim: '#ff4d00', glow: true, extra: 'flames' },
  { id: 'frost', name: 'Frost Bike', mult: 28, price: 900, currency: 'wins', shop: 'wins', frame: '#bfefff', accent: '#ffffff', rim: '#6fd2ff', extra: 'crystals' },
  { id: 'galaxy', name: 'Galaxy Bike', mult: 40, price: 1500, currency: 'wins', shop: 'wins', frame: '#5b2bd9', accent: '#ff9df5', rim: '#b98bff', glow: true, extra: 'stars' },
  { id: 'candy', name: 'Candy Bike', mult: 55, price: 2500, currency: 'wins', shop: 'wins', frame: '#ff7ac8', accent: '#ffffff', rim: '#7ad8ff', extra: 'stripes' },
  { id: 'rainbow', name: 'Rainbow Bike', mult: 75, price: 4000, currency: 'wins', shop: 'wins', frame: '#ff4d4d', accent: '#ffffff', rim: '#ffd23f', extra: 'rainbow' },
  { id: 'golden', name: 'Golden Bike', mult: 110, price: 10000, currency: 'wins', shop: 'wins', frame: '#ffc933', accent: '#fff2b0', rim: '#ffe27a', metal: true, extra: 'crown' },
  { id: 'diamond', name: 'Diamond Bike', mult: 160, price: 25000, currency: 'wins', shop: 'wins', frame: '#8ff6ff', accent: '#ffffff', rim: '#c9fbff', metal: true, glow: true, extra: 'crystals' },
  { id: 'crystal', name: 'Crystal Bike', mult: 250, price: 50000, currency: 'wins', shop: 'w2', frame: '#b07bff', accent: '#7ff3ff', rim: '#e3c9ff', glow: true, extra: 'crystals' },
  { id: 'toxic', name: 'Toxic Bike', mult: 380, price: 100000, currency: 'wins', shop: 'w2', frame: '#2b2f3a', accent: '#8cff3a', rim: '#8cff3a', glow: true, extra: 'fin' },
  { id: 'phoenix', name: 'Phoenix Bike', mult: 550, price: 250000, currency: 'wins', shop: 'w2', frame: '#ff5a1f', accent: '#ffe14d', rim: '#ffb21f', glow: true, extra: 'flamewings' },
  { id: 'void', name: 'Void Bike', mult: 800, price: 500000, currency: 'wins', shop: 'w2', frame: '#140b2e', accent: '#b45cff', rim: '#7a2bff', glow: true, extra: 'stars' },
  { id: 'royal', name: 'Royal Bike', mult: 1200, price: 1_000_000, currency: 'wins', shop: 'w2', frame: '#6b2bd9', accent: '#ffd23a', rim: '#ffd23a', metal: true, extra: 'crown' },
  { id: 'cosmic', name: 'Cosmic Bike', mult: 2000, price: 2_500_000, currency: 'wins', shop: 'w2', frame: '#1b2a6b', accent: '#ff6ef7', rim: '#2fd0ff', glow: true, extra: 'rainbow' },
]

/** `bonus` adds to the speed multiplier while equipped. */
export const TRAILS = [
  { id: 'none', name: 'No Trail', bonus: 0, price: 0, colors: [] },
  { id: 'red', name: 'Red Streak', bonus: 0.05, price: 10, colors: ['#ff3b3b', '#ffb03b'] },
  { id: 'ocean', name: 'Ocean Wave', bonus: 0.1, price: 30, colors: ['#3fd2ff', '#2f5bff'] },
  { id: 'toxic', name: 'Toxic Slime', bonus: 0.15, price: 75, colors: ['#c6ff3b', '#2fff7a'] },
  { id: 'fire', name: 'Fire Blaze', bonus: 0.25, price: 200, colors: ['#fff07a', '#ff4d00'], glow: true },
  { id: 'galaxy', name: 'Galaxy Dust', bonus: 0.4, price: 600, colors: ['#ff6ef7', '#7b3bff', '#2fd0ff'], glow: true },
  { id: 'rainbow', name: 'Rainbow Road', bonus: 0.6, price: 1500, colors: ['#ff3b3b', '#ffb03b', '#fff03b', '#3bff6e', '#3bb5ff', '#a03bff'], glow: true },
]

/** `winsMult` multiplies wins from Return pads while equipped. */
export const AURAS = [
  { id: 'none', name: 'No Aura', winsMult: 1, price: 0, currency: 'wins', color: '#ffffff' },
  { id: 'sparkle', name: 'Sparkle Aura', winsMult: 1.25, price: 25, currency: 'wins', color: '#fff27a' },
  { id: 'frost', name: 'Frost Aura', winsMult: 1.5, price: 120, currency: 'wins', color: '#8ee8ff' },
  { id: 'flame', name: 'Flame Aura', winsMult: 2, price: 400, currency: 'wins', color: '#ff7a2f' },
  { id: 'shadow', name: 'Shadow Aura', winsMult: 3, price: 1200, currency: 'wins', color: '#9b5cff' },
  { id: 'unchained', name: 'Unchained Aura', winsMult: 10, price: 5000, currency: 'wins', color: '#ff2f4d' },
]

export const RARITY_COLORS = {
  Common: '#9aa6b2',
  Uncommon: '#4fc94f',
  Rare: '#3fa8ff',
  Epic: '#b45cff',
  Legendary: '#ffb21f',
  Mythic: '#ff3f6c',
}

/**
 * Speed treadmills. Unlocked by rebirths, or bought once with Wins; World 2 ones
 * also need World 2 open. Laid out in the lobbies by `buildLayout()`.
 */
export const TRAIN_PADS = [
  { id: 'starter', label: 'STARTER', mult: 1, world: 1, color: '#b8c0ca' },
  { id: 'pink', label: 'PINK', mult: 2.5, world: 1, rebirths: 5, color: '#ff8fd1' },
  { id: 'mint', label: 'MINT', mult: 3.5, world: 1, rebirths: 20, color: '#7dffc8' },
  { id: 'purple', label: 'PURPLE', mult: 5, world: 1, rebirths: 50, color: '#a46bff' },
  { id: 'rocks', label: 'ROCKS', mult: 8, world: 1, rebirths: 120, color: '#9a8a76' },
  { id: 'quartz', label: 'QUARTZ', mult: 12, world: 1, rebirths: 250, color: '#efe2ff' },
  { id: 'sky', label: 'SKY', mult: 18, world: 1, rebirths: 500, color: '#6fd0ff' },
  { id: 'cotton', label: 'COTTON CANDY', mult: 25, world: 1, rebirths: 900, color: '#ffc2ee' },
  { id: 'lava', label: 'LAVA', mult: 35, world: 1, rebirths: 1500, color: '#ff6a2f' },
  { id: 'peridot', label: 'PERIDOT', mult: 50, world: 1, rebirths: 2500, color: '#b7e34a' },
  { id: 'emerald', label: 'EMERALD', mult: 75, world: 1, rebirths: 4000, color: '#2fd27a' },
  { id: 'ruby', label: 'RUBY', mult: 100, world: 1, rebirths: 6000, color: '#ff3b5c' },
  { id: 'gold', label: 'GOLD', mult: 150, world: 1, wins: 2500, color: '#ffcc33' },
  { id: 'diamond', label: 'DIAMOND', mult: 300, world: 1, wins: 6000, color: '#7ff3ff' },
  { id: 'poison', label: 'POISON', mult: 600, world: 1, wins: 15000, color: '#8cff3a' },
  { id: 'admin', label: 'ADMIN', mult: 1000, world: 1, wins: 40000, color: '#ff3a3a' },
  { id: 'crystal', label: 'CRYSTAL', mult: 800, world: 2, color: '#c9a2ff' },
  { id: 'nebula', label: 'NEBULA', mult: 1200, world: 2, rebirths: 12000, color: '#7a5cff' },
  { id: 'magma', label: 'MAGMA', mult: 2000, world: 2, rebirths: 16000, color: '#ff5a1f' },
  { id: 'frostbite', label: 'FROSTBITE', mult: 3000, world: 2, rebirths: 22000, color: '#9fe8ff' },
  { id: 'void', label: 'VOID', mult: 5000, world: 2, rebirths: 30000, color: '#3b1d6e' },
  { id: 'cosmic', label: 'COSMIC', mult: 8000, world: 2, rebirths: 45000, color: '#ff6ef7' },
  { id: 'celestial', label: 'CELESTIAL', mult: 12000, world: 2, wins: 400000, color: '#fff3a0' },
  { id: 'omega', label: 'OMEGA', mult: 25000, world: 2, wins: 1200000, color: '#ffffff' },
]

/**
 * Item Shop stock. Each item is a permanent +speed% boost and can be bought again
 * for more. The shop restocks every 5 minutes (see `shopOffer`).
 */
export const ITEMS = [
  { id: 'bell', name: 'Rusty Bell', rarity: 'Common', price: 10, bonus: 0.02, stock: 5, icon: '🔔' },
  { id: 'pump', name: 'Bike Pump', rarity: 'Common', price: 20, bonus: 0.04, stock: 5, icon: '🎈' },
  { id: 'bottle', name: 'Water Bottle', rarity: 'Common', price: 45, bonus: 0.08, stock: 5, icon: '🧴' },
  { id: 'chain', name: 'Chain', rarity: 'Common', price: 65, bonus: 0.1, stock: 5, icon: '⛓️' },
  { id: 'helmet', name: 'Helmet', rarity: 'Uncommon', price: 150, bonus: 0.18, stock: 3, icon: '⛑️' },
  { id: 'gloves', name: 'Grip Gloves', rarity: 'Uncommon', price: 250, bonus: 0.25, stock: 3, icon: '🧤' },
  { id: 'pedals', name: 'Turbo Pedals', rarity: 'Rare', price: 600, bonus: 0.45, stock: 2, icon: '⚙️' },
  { id: 'nitro', name: 'Nitro Tank', rarity: 'Epic', price: 1500, bonus: 0.8, stock: 1, icon: '🚀' },
  { id: 'wings', name: 'Golden Wings', rarity: 'Legendary', price: 5000, bonus: 1.5, stock: 1, icon: '🪽' },
]

const RARITY_WEIGHT = { Common: 60, Uncommon: 25, Rare: 10, Epic: 4, Legendary: 1 }

export const shopCycle = (now = Date.now()) => Math.floor(now / ITEM_RESTOCK_MS)
export const nextRestockAt = (now = Date.now()) => (shopCycle(now) + 1) * ITEM_RESTOCK_MS

/**
 * The item ids on sale for a restock cycle. Deterministic, so the server and every
 * client agree; `rerolls` (paid restocks) give that one player a fresh roll.
 */
export function shopOffer(cycle, rerolls = 0) {
  const rng = mulberry32((Math.imul(cycle, 2654435761) + rerolls * 7919 + 12345) >>> 0)
  const perRarity = {}
  for (const item of ITEMS) perRarity[item.rarity] = (perRarity[item.rarity] || 0) + 1
  const weights = ITEMS.map((item) => RARITY_WEIGHT[item.rarity] / perRarity[item.rarity])
  const chosen = []
  let guard = 0
  while (chosen.length < SHOP_SLOTS && guard < 100) {
    guard += 1
    const total = weights.reduce((sum, w, i) => sum + (chosen.includes(ITEMS[i].id) ? 0 : w), 0)
    let roll = rng() * total
    for (let i = 0; i < ITEMS.length; i += 1) {
      if (chosen.includes(ITEMS[i].id)) continue
      roll -= weights[i]
      if (roll <= 0) {
        chosen.push(ITEMS[i].id)
        break
      }
    }
  }
  // Cheapest first, like a shop shelf.
  return chosen.sort((a, b) => ITEM_BY_ID[a].price - ITEM_BY_ID[b].price)
}

/** Passes and speed packs, all bought with Wins. */
export const PRODUCTS = {
  pass2xSpeed: { name: '2x Speed', price: 50 },
  pass2xWins: { name: '2x Wins', price: 120 },
  speed100: { name: '+100 Speed', price: 2, speed: 100 },
  speed1k: { name: '+1000 Speed', price: 10, speed: 1000 },
  speed10k: { name: '+10k Speed', price: 60, speed: 10_000 },
  speed100k: { name: '+100k Speed', price: 300, speed: 100_000 },
}

export const CODES = {
  RELEASE: { wins: 25 },
  BIKEFLIP: { wins: 15 },
  ESCAPE: { wins: 10 },
  DOUBLEJUMP: { wins: 15 },
  WORLD2: { wins: 50 },
}

/**
 * Quest lines. Progress is `counters[counter] - base` for the current tier, except
 * `absolute` quests which compare the counter directly.
 */
export const QUESTS = [
  { id: 'speed', title: 'Gain {n} Speed', icon: '⚡', counter: 'gained', target: (t) => 150 * 3 ** t, reward: (t) => ({ wins: 3 + 2 * t }) },
  { id: 'tricks', title: 'Pull off {n} Tricks', icon: '🤸', counter: 'tricks', target: (t) => 25 * 2 ** t, reward: (t) => ({ wins: 3 + 3 * t }) },
  { id: 'wins', title: 'Earn {n} Wins', icon: '🏆', counter: 'wins', target: (t) => 5 * 3 ** t, reward: (t) => ({ speed: 200 * 3 ** t }) },
  { id: 'jumps', title: 'Jump {n} Times', icon: '⏫', counter: 'jumps', target: (t) => 40 * 2 ** t, reward: (t) => ({ wins: 2 + t }) },
  { id: 'stage', title: 'Reach Stage {n}', icon: '🚩', counter: 'bestStage', absolute: true, target: (t) => t + 2, max: 22, reward: (t) => ({ wins: 5 + 3 * t }) },
]

/* ---------------------------------------------------------------------------
 * Lookups & helpers
 * ------------------------------------------------------------------------- */

const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]))
export const BIKE_BY_ID = byId(BIKES)
export const TRAIL_BY_ID = byId(TRAILS)
export const AURA_BY_ID = byId(AURAS)
export const TRAIN_PAD_BY_ID = byId(TRAIN_PADS)
export const ITEM_BY_ID = byId(ITEMS)

/** Owned/equipped lists travel as comma-separated strings in the room state. */
export const parseList = (value) => (value ? String(value).split(',').filter(Boolean) : [])

export function itemBonus(itemsCsv) {
  return parseList(itemsCsv).reduce((sum, id) => sum + (ITEM_BY_ID[id]?.bonus ?? 0), 0)
}

/** Whether a player can use a treadmill. */
export function padUnlocked(pad, player) {
  if (!pad) return false
  if (pad.world === 2 && !worldUnlocked(2, player)) return false
  if (pad.wins) return parseList(player.padsOwned).includes(pad.id)
  return (player.rebirths ?? 0) >= (pad.rebirths ?? 0)
}

/** Whether a bike can be bought (World 2 bikes need World 2 open). */
export const bikeAvailable = (bike, player) => bike.shop !== 'w2' || worldUnlocked(2, player)

/** Every multiplier that applies to one speed tick, split out for the UI. */
export function speedBreakdown(player, { padMult = 1, others = 0 } = {}) {
  const bike = BIKE_BY_ID[player.bike]?.mult ?? 1
  const extras = (TRAIL_BY_ID[player.trail]?.bonus ?? 0) + itemBonus(player.items)
  const rebirth = 1 + rebirthBonus(player.rebirths ?? 0)
  const friends = 1 + friendBonus(others)
  const pass = player.pass2xSpeed ? 2 : 1
  return {
    pad: padMult,
    bike,
    extras,
    rebirth,
    friends,
    pass,
    total: padMult * bike * (1 + extras) * rebirth * friends * pass,
  }
}

/** Wins from a stage pad: the aura multiplier, doubled on the purple pad with the 2x Wins pass. */
export function winsMultiplier(player, { double = false } = {}) {
  return (AURA_BY_ID[player.aura]?.winsMult ?? 1) * (double && canUseDoublePad(player) ? 2 : 1)
}

/** Wins you need to be holding to use the purple 2x Wins pads (the 2x Wins pass skips this). */
export const DOUBLE_PAD_WINS = 200
export const canUseDoublePad = (player) => Boolean(player?.pass2xWins) || (player?.wins ?? 0) >= DOUBLE_PAD_WINS

/** Rounds a gain to two decimals so "+1.25" style numbers stay tidy. */
export const roundGain = (n) => Math.round(n * 100) / 100

/** 1160 -> "1.16K", 1000 -> "1K", 12.5 -> "12.5". */
export function formatNumber(value) {
  let n = Number(value) || 0
  const sign = n < 0 ? '-' : ''
  n = Math.abs(n)
  if (n < 1000) {
    return sign + String(parseFloat(n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)))
  }
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx']
  let unit = -1
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000
    unit += 1
  }
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2
  return sign + String(parseFloat(n.toFixed(digits))) + units[unit]
}

/** "4:05" style countdown. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v) => String(v).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function describeReward(reward) {
  const parts = []
  if (reward.wins) parts.push(`+${formatNumber(reward.wins)} Wins`)
  if (reward.speed) parts.push(`+${formatNumber(reward.speed)} Speed`)
  return parts.join('  ')
}
