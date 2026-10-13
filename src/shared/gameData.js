/**
 * Game rules shared by the client and the Colyseus server.
 *
 * The server repo keeps an identical copy in `src/shared/` — after editing anything
 * in this folder run `npm run sync-shared` in the server repo. Everything that
 * decides a reward (prices, multipliers, pad positions) lives here so both sides
 * always agree. The numbers themselves (gates, prices, multipliers, rewards) live
 * in config/balance.ts.
 */

import { BALANCE } from '../../config/balance.ts'

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
export const SPEED_TICK_MS = BALANCE.speed.tickMs
export const DAILY_COOLDOWN_MS = BALANCE.rewards.daily.cooldownMinutes * 60_000
export const CHEST_COOLDOWN_MS = BALANCE.rewards.chest.cooldownMinutes * 60_000
export const ITEM_RESTOCK_MS = 5 * 60_000
export const RESTOCK_WINS = BALANCE.restockWins
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

/**
 * Speed needed to finish `level` (from level to level + 1). Levels come from
 * Speed: see `levelForSpeed`.
 */
export const xpForLevel = (level) => BALANCE.levels.first * BALANCE.levels.growth ** (level - 1)

/** Total Speed at which `level` starts (level 1 at 0). */
export function speedForLevel(level) {
  const { first, growth } = BALANCE.levels
  return level <= 1 ? 0 : (first * (growth ** (level - 1) - 1)) / (growth - 1)
}

/** The level a rider with `speed` Total Speed is at. */
export function levelForSpeed(speed) {
  const { first, growth } = BALANCE.levels
  const level = 1 + Math.floor(Math.log(1 + (Math.max(0, speed) * (growth - 1)) / first) / Math.log(growth) + 1e-9)
  return Math.max(1, level)
}

/**
 * "Max Bike Speed": the bike's top speed in studs/sec, from Total Speed. It rises
 * with the log of Speed so every 10x Speed adds about the same.
 */
export function bikeSpeedFor(speed) {
  const { min, max, maxAtSpeed, knee } = BALANCE.bike
  const t = Math.log10(1 + Math.max(0, speed) / knee) / Math.log10(1 + maxAtSpeed / knee)
  return Math.round((min + (max - min) * Math.min(1, t)) * 10) / 10
}

/** Total jumps per air-time: the ground jump plus (level - 1) mid-air jumps. */
export const jumpsFor = (level) => Math.max(1, level)

/** Total Speed needed for the next rebirth (it resets Speed to 0). */
export const rebirthSpeedFor = (rebirths) => BALANCE.rebirth.firstSpeed * BALANCE.rebirth.growth ** Math.max(0, rebirths || 0)
/** Rebirths gained per rebirth. */
export const REBIRTH_GAIN = BALANCE.rebirth.perRebirth
/** Permanent Speed-gain bonus from rebirths (0.5 = +50%). */
export const rebirthBonus = (rebirths) => (rebirths || 0) * BALANCE.rebirth.bonusPerRebirth

/** Bike tune-ups ("Bike Speed" button): each one is +bonus Speed gain. */
export const TUNE_UP_MAX = BALANCE.tuneUps.max
export const tuneUpBonus = (count) => Math.min(count || 0, TUNE_UP_MAX) * BALANCE.tuneUps.bonus
export const tuneUpCost = (count) => Math.round(BALANCE.tuneUps.firstPrice * BALANCE.tuneUps.priceGrowth ** (count || 0))

/** Bonus per other player in the lobby. */
export const friendBonus = (others) => Math.min(Math.max(others, 0), BALANCE.friends.maxFriends) * BALANCE.friends.perFriend

/* ---------------------------------------------------------------------------
 * Worlds and stages.
 *
 * Each stage is an island across a gap with a deadly river. `speed` is the
 * Total Speed its gate asks for: the gap is built so that much Speed clears it
 * and less falls short (see `gapLengthFor` in layout.js). `speed` and `wins`
 * come from config/balance.ts. Every stage has a global id (gid): World 1 is
 * 1-10 plus its finish (11), World 2 is 12-21 plus its finish (22).
 * ------------------------------------------------------------------------- */

const W1_STAGES = [
  { name: 'Starter Stage', theme: 'starter', color: '#f4f4f4', ...BALANCE.world1.stages[0] },
  { name: 'Forest Stage', theme: 'forest', color: '#3fd16b', ...BALANCE.world1.stages[1] },
  { name: 'Cloud Stage', theme: 'cloud', color: '#2f9cf6', ...BALANCE.world1.stages[2] },
  { name: 'Volcano Stage', theme: 'volcano', color: '#d8302c', ...BALANCE.world1.stages[3] },
  { name: 'Desert Stage', theme: 'desert', color: '#3fd16b', ...BALANCE.world1.stages[4] },
  { name: 'Ice Stage', theme: 'ice', color: '#1f7ca8', ...BALANCE.world1.stages[5] },
  { name: 'Candy Stage', theme: 'candy', color: 'rainbow', ...BALANCE.world1.stages[6] },
  { name: 'Neon Stage', theme: 'neon', color: '#b13fe0', ...BALANCE.world1.stages[7] },
  { name: 'Space Stage', theme: 'space', color: '#8fd12f', ...BALANCE.world1.stages[8] },
  { name: 'Rainbow Stage', theme: 'rainbow', color: '#2f9cf6', ...BALANCE.world1.stages[9] },
]

const W2_STAGES = [
  { name: 'Jungle Stage', theme: 'jungle', color: '#2f9e3a', ...BALANCE.world2.stages[0] },
  { name: 'Beach Stage', theme: 'beach', color: '#ffcf5a', ...BALANCE.world2.stages[1] },
  { name: 'Toxic Stage', theme: 'toxic', color: '#8cff3a', ...BALANCE.world2.stages[2] },
  { name: 'Haunted Stage', theme: 'haunted', color: '#7a4dff', ...BALANCE.world2.stages[3] },
  { name: 'Crystal Stage', theme: 'crystal', color: '#7ff3ff', ...BALANCE.world2.stages[4] },
  { name: 'Factory Stage', theme: 'factory', color: '#9aa3b2', ...BALANCE.world2.stages[5] },
  { name: 'Sakura Stage', theme: 'sakura', color: '#ff8fd1', ...BALANCE.world2.stages[6] },
  { name: 'Magma Stage', theme: 'magma', color: '#ff5a1f', ...BALANCE.world2.stages[7] },
  { name: 'Galaxy Stage', theme: 'galaxy', color: '#9b5cff', ...BALANCE.world2.stages[8] },
  { name: 'Golden Stage', theme: 'golden', color: 'rainbow', ...BALANCE.world2.stages[9] },
]

export const WORLDS = [
  {
    id: 1,
    name: 'World 1',
    originX: 0,
    stages: W1_STAGES,
    finish: { name: 'You Escaped!', theme: 'finish', ...BALANCE.world1.finish },
    /** Best stage (gid) and rebirths needed before the world opens. */
    unlock: { stage: 0, rebirths: 0 },
    gidOffset: 0,
  },
  {
    id: 2,
    name: 'World 2',
    originX: 3000,
    stages: W2_STAGES,
    finish: { name: 'World 2 Escaped!', theme: 'finish', ...BALANCE.world2.finish },
    unlock: { stage: 11, rebirths: BALANCE.world2.unlockRebirths },
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
 *  shop 'rebirth' - exclusive: given at a rebirth milestone, never sold
 * ------------------------------------------------------------------------- */

export const BIKES = [
  { id: 'starter', ...BALANCE.bikes.starter, name: 'Starter Bike', rarity: 'Common', currency: 'wins', shop: 'free', frame: '#2b2f3a', accent: '#f6d33c', rim: '#f6d33c' },
  { id: 'angel', ...BALANCE.bikes.angel, name: 'Angel Bike', rarity: 'Common', currency: 'wins', shop: 'pad', frame: '#f6f2e8', accent: '#ffd76a', rim: '#ffffff', extra: 'wings' },
  { id: 'dragon', ...BALANCE.bikes.dragon, name: 'Dragon Bike', rarity: 'Common', currency: 'wins', shop: 'pad', frame: '#3aa14a', accent: '#e0463c', rim: '#1d5e28', extra: 'dragon' },
  { id: 'six7', ...BALANCE.bikes.six7, name: '67 Bike', rarity: 'Uncommon', currency: 'wins', shop: 'pad', frame: '#2f7bff', accent: '#ffffff', rim: '#7fd4ff', extra: 'plate' },
  { id: 'ufo', ...BALANCE.bikes.ufo, name: 'UFO Bike', rarity: 'Uncommon', currency: 'wins', shop: 'pad', frame: '#4b5563', accent: '#36f0ff', rim: '#36f0ff', extra: 'ufo', glow: true },
  { id: 'shark', ...BALANCE.bikes.shark, name: 'Shark Bike', rarity: 'Uncommon', currency: 'wins', shop: 'pad', frame: '#5f8fb8', accent: '#ffffff', rim: '#c9e6ff', extra: 'fin' },
  { id: 'pumpkin', ...BALANCE.bikes.pumpkin, name: 'Pumpkin Bike', rarity: 'Rare', currency: 'wins', shop: 'pad', frame: '#ff8a1f', accent: '#2f9e3a', rim: '#3b2a1a', extra: 'horns' },
  { id: 'neon', ...BALANCE.bikes.neon, name: 'Neon Bike', rarity: 'Rare', currency: 'wins', shop: 'wins', frame: '#ff3df2', accent: '#3dfffa', rim: '#3dfffa', glow: true },
  { id: 'lava', ...BALANCE.bikes.lava, name: 'Lava Bike', rarity: 'Rare', currency: 'wins', shop: 'wins', frame: '#2a1a14', accent: '#ff7a1a', rim: '#ff4d00', glow: true, extra: 'flames' },
  { id: 'frost', ...BALANCE.bikes.frost, name: 'Frost Bike', rarity: 'Epic', currency: 'wins', shop: 'wins', frame: '#bfefff', accent: '#ffffff', rim: '#6fd2ff', extra: 'crystals' },
  { id: 'galaxy', ...BALANCE.bikes.galaxy, name: 'Galaxy Bike', rarity: 'Epic', currency: 'wins', shop: 'wins', frame: '#5b2bd9', accent: '#ff9df5', rim: '#b98bff', glow: true, extra: 'stars' },
  { id: 'candy', ...BALANCE.bikes.candy, name: 'Candy Bike', rarity: 'Epic', currency: 'wins', shop: 'wins', frame: '#ff7ac8', accent: '#ffffff', rim: '#7ad8ff', extra: 'stripes' },
  { id: 'rainbow', ...BALANCE.bikes.rainbow, name: 'Rainbow Bike', rarity: 'Legendary', currency: 'wins', shop: 'wins', frame: '#ff4d4d', accent: '#ffffff', rim: '#ffd23f', extra: 'rainbow' },
  { id: 'golden', ...BALANCE.bikes.golden, name: 'Golden Bike', rarity: 'Legendary', currency: 'wins', shop: 'wins', frame: '#ffc933', accent: '#fff2b0', rim: '#ffe27a', metal: true, extra: 'crown' },
  { id: 'diamond', ...BALANCE.bikes.diamond, name: 'Diamond Bike', rarity: 'Legendary', currency: 'wins', shop: 'wins', frame: '#8ff6ff', accent: '#ffffff', rim: '#c9fbff', metal: true, glow: true, extra: 'crystals' },
  { id: 'reborn', ...BALANCE.bikes.reborn, name: 'Reborn Bike', rarity: 'Epic', currency: 'wins', shop: 'rebirth', milestone: 5, frame: '#ff4f8b', accent: '#ffffff', rim: '#ffd23a', glow: true, extra: 'wings' },
  { id: 'eclipse', ...BALANCE.bikes.eclipse, name: 'Eclipse Bike', rarity: 'Legendary', currency: 'wins', shop: 'rebirth', milestone: 10, frame: '#1b1030', accent: '#ffb21f', rim: '#ff5a1f', glow: true, extra: 'crown' },
  { id: 'ascended', ...BALANCE.bikes.ascended, name: 'Ascended Bike', rarity: 'Mythic', currency: 'wins', shop: 'rebirth', milestone: 25, frame: '#fff6d6', accent: '#7ff3ff', rim: '#ffffff', metal: true, glow: true, extra: 'flamewings' },
  { id: 'star', ...BALANCE.bikes.star, name: 'Star Bike', rarity: 'Legendary', currency: 'wins', shop: 'stars', frame: '#ffd23a', accent: '#ffffff', rim: '#fff3a0', metal: true, glow: true, extra: 'wings' },
  { id: 'crystal', ...BALANCE.bikes.crystal, name: 'Crystal Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#b07bff', accent: '#7ff3ff', rim: '#e3c9ff', glow: true, extra: 'crystals' },
  { id: 'toxic', ...BALANCE.bikes.toxic, name: 'Toxic Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#2b2f3a', accent: '#8cff3a', rim: '#8cff3a', glow: true, extra: 'fin' },
  { id: 'phoenix', ...BALANCE.bikes.phoenix, name: 'Phoenix Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#ff5a1f', accent: '#ffe14d', rim: '#ffb21f', glow: true, extra: 'flamewings' },
  { id: 'void', ...BALANCE.bikes.void, name: 'Void Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#140b2e', accent: '#b45cff', rim: '#7a2bff', glow: true, extra: 'stars' },
  { id: 'royal', ...BALANCE.bikes.royal, name: 'Royal Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#6b2bd9', accent: '#ffd23a', rim: '#ffd23a', metal: true, extra: 'crown' },
  { id: 'cosmic', ...BALANCE.bikes.cosmic, name: 'Cosmic Bike', rarity: 'Mythic', currency: 'wins', shop: 'w2', frame: '#1b2a6b', accent: '#ff6ef7', rim: '#2fd0ff', glow: true, extra: 'rainbow' },
]

/** `bonus` adds to the speed multiplier while equipped. */
export const TRAILS = [
  { id: 'none', ...BALANCE.trails.none, name: 'No Trail', rarity: 'Common', colors: [] },
  { id: 'red', ...BALANCE.trails.red, name: 'Red Streak', rarity: 'Common', colors: ['#ff3b3b', '#ffb03b'] },
  { id: 'mint', ...BALANCE.trails.mint, name: 'Mint Breeze', rarity: 'Common', colors: ['#b6ffd9', '#3fe0a0'] },
  { id: 'bubblegum', ...BALANCE.trails.bubblegum, name: 'Bubblegum', rarity: 'Common', colors: ['#ffb3e0', '#ff6ec4'] },
  { id: 'ocean', ...BALANCE.trails.ocean, name: 'Ocean Wave', rarity: 'Common', colors: ['#3fd2ff', '#2f5bff'] },
  { id: 'sunset', ...BALANCE.trails.sunset, name: 'Sunset Glow', rarity: 'Uncommon', colors: ['#ffd23a', '#ff7a2f', '#ff3f78'] },
  { id: 'toxic', ...BALANCE.trails.toxic, name: 'Toxic Slime', rarity: 'Uncommon', colors: ['#c6ff3b', '#2fff7a'] },
  { id: 'ice', ...BALANCE.trails.ice, name: 'Frost Trail', rarity: 'Uncommon', colors: ['#ffffff', '#9fe8ff', '#4fb4ff'] },
  { id: 'fire', ...BALANCE.trails.fire, name: 'Fire Blaze', rarity: 'Rare', colors: ['#fff07a', '#ff4d00'], glow: true },
  { id: 'shadow', ...BALANCE.trails.shadow, name: 'Shadow Smoke', rarity: 'Rare', colors: ['#6b4fd8', '#2a1f4d', '#15151d'] },
  { id: 'lightning', ...BALANCE.trails.lightning, name: 'Lightning', rarity: 'Rare', colors: ['#ffffff', '#fff47a', '#7fd4ff'], glow: true },
  { id: 'neon', ...BALANCE.trails.neon, name: 'Neon Pulse', rarity: 'Epic', colors: ['#3dfffa', '#ff3df2'], glow: true },
  { id: 'galaxy', ...BALANCE.trails.galaxy, name: 'Galaxy Dust', rarity: 'Epic', colors: ['#ff6ef7', '#7b3bff', '#2fd0ff'], glow: true },
  { id: 'gold', ...BALANCE.trails.gold, name: 'Golden Dust', rarity: 'Legendary', colors: ['#fff3a0', '#ffc933', '#ff9f1f'], glow: true },
  { id: 'rainbow', ...BALANCE.trails.rainbow, name: 'Rainbow Road', rarity: 'Legendary', colors: ['#ff3b3b', '#ffb03b', '#fff03b', '#3bff6e', '#3bb5ff', '#a03bff'], glow: true },
  { id: 'star', ...BALANCE.trails.star, name: 'Star Trail', rarity: 'Legendary', exclusive: 'stars', colors: ['#ffffff', '#fff3a0', '#ffd23a', '#fff3a0'], glow: true },
  { id: 'cosmic', ...BALANCE.trails.cosmic, name: 'Cosmic Comet', rarity: 'Mythic', colors: ['#ffffff', '#ff6ef7', '#7b3bff', '#2fd0ff', '#ffffff'], glow: true },
]

/** `winsMult` multiplies wins from Return pads while equipped. */
export const AURAS = [
  { id: 'none', ...BALANCE.auras.none, name: 'No Aura', rarity: 'Common', currency: 'wins', color: '#ffffff' },
  { id: 'bubble', ...BALANCE.auras.bubble, name: 'Bubble Aura', rarity: 'Common', currency: 'wins', color: '#bfe9ff' },
  { id: 'leaf', ...BALANCE.auras.leaf, name: 'Leaf Aura', rarity: 'Common', currency: 'wins', color: '#7ddc5a' },
  { id: 'sparkle', ...BALANCE.auras.sparkle, name: 'Sparkle Aura', rarity: 'Common', currency: 'wins', color: '#fff27a' },
  { id: 'sun', ...BALANCE.auras.sun, name: 'Sunny Aura', rarity: 'Common', currency: 'wins', color: '#ffcf3a' },
  { id: 'ocean', ...BALANCE.auras.ocean, name: 'Ocean Aura', rarity: 'Uncommon', currency: 'wins', color: '#2fb8ff' },
  { id: 'frost', ...BALANCE.auras.frost, name: 'Frost Aura', rarity: 'Uncommon', currency: 'wins', color: '#8ee8ff' },
  { id: 'toxic', ...BALANCE.auras.toxic, name: 'Toxic Aura', rarity: 'Uncommon', currency: 'wins', color: '#8cff3a' },
  { id: 'heart', ...BALANCE.auras.heart, name: 'Heart Aura', rarity: 'Rare', currency: 'wins', color: '#ff6eb4' },
  { id: 'flame', ...BALANCE.auras.flame, name: 'Flame Aura', rarity: 'Rare', currency: 'wins', color: '#ff7a2f' },
  { id: 'storm', ...BALANCE.auras.storm, name: 'Storm Aura', rarity: 'Rare', currency: 'wins', color: '#7fa8ff' },
  { id: 'galaxy', ...BALANCE.auras.galaxy, name: 'Galaxy Aura', rarity: 'Epic', currency: 'wins', color: '#b45cff' },
  { id: 'shadow', ...BALANCE.auras.shadow, name: 'Shadow Aura', rarity: 'Epic', currency: 'wins', color: '#9b5cff' },
  { id: 'rainbow', ...BALANCE.auras.rainbow, name: 'Rainbow Aura', rarity: 'Legendary', currency: 'wins', color: '#ff8ad8' },
  { id: 'crown', ...BALANCE.auras.crown, name: 'Royal Aura', rarity: 'Legendary', currency: 'wins', color: '#ffd23a' },
  { id: 'star', ...BALANCE.auras.star, name: 'Star Aura', rarity: 'Legendary', exclusive: 'stars', currency: 'wins', color: '#ffe27a' },
  { id: 'unchained', ...BALANCE.auras.unchained, name: 'Unchained Aura', rarity: 'Mythic', currency: 'wins', color: '#ff2f4d' },
]

/** Rarity order, lowest first (bikes, trails, auras and items share it). */
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']

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
  { id: 'starter', ...BALANCE.treadmills.starter, label: 'STARTER', world: 1, color: '#b8c0ca' },
  { id: 'pink', ...BALANCE.treadmills.pink, label: 'PINK', world: 1, color: '#ff8fd1' },
  { id: 'mint', ...BALANCE.treadmills.mint, label: 'MINT', world: 1, color: '#7dffc8' },
  { id: 'purple', ...BALANCE.treadmills.purple, label: 'PURPLE', world: 1, color: '#a46bff' },
  { id: 'rocks', ...BALANCE.treadmills.rocks, label: 'ROCKS', world: 1, color: '#9a8a76' },
  { id: 'quartz', ...BALANCE.treadmills.quartz, label: 'QUARTZ', world: 1, color: '#efe2ff' },
  { id: 'sky', ...BALANCE.treadmills.sky, label: 'SKY', world: 1, color: '#6fd0ff' },
  { id: 'cotton', ...BALANCE.treadmills.cotton, label: 'COTTON CANDY', world: 1, color: '#ffc2ee' },
  { id: 'lava', ...BALANCE.treadmills.lava, label: 'LAVA', world: 1, color: '#ff6a2f' },
  { id: 'peridot', ...BALANCE.treadmills.peridot, label: 'PERIDOT', world: 1, color: '#b7e34a' },
  { id: 'emerald', ...BALANCE.treadmills.emerald, label: 'EMERALD', world: 1, color: '#2fd27a' },
  { id: 'ruby', ...BALANCE.treadmills.ruby, label: 'RUBY', world: 1, color: '#ff3b5c' },
  { id: 'gold', ...BALANCE.treadmills.gold, label: 'GOLD', world: 1, color: '#ffcc33' },
  { id: 'diamond', ...BALANCE.treadmills.diamond, label: 'DIAMOND', world: 1, color: '#7ff3ff' },
  { id: 'poison', ...BALANCE.treadmills.poison, label: 'POISON', world: 1, color: '#8cff3a' },
  { id: 'admin', ...BALANCE.treadmills.admin, label: 'ADMIN', world: 1, color: '#ff3a3a' },
  { id: 'crystal', ...BALANCE.treadmills.crystal, label: 'CRYSTAL', world: 2, color: '#c9a2ff' },
  { id: 'nebula', ...BALANCE.treadmills.nebula, label: 'NEBULA', world: 2, color: '#7a5cff' },
  { id: 'magma', ...BALANCE.treadmills.magma, label: 'MAGMA', world: 2, color: '#ff5a1f' },
  { id: 'frostbite', ...BALANCE.treadmills.frostbite, label: 'FROSTBITE', world: 2, color: '#9fe8ff' },
  { id: 'void', ...BALANCE.treadmills.void, label: 'VOID', world: 2, color: '#3b1d6e' },
  { id: 'cosmic', ...BALANCE.treadmills.cosmic, label: 'COSMIC', world: 2, color: '#ff6ef7' },
  { id: 'celestial', ...BALANCE.treadmills.celestial, label: 'CELESTIAL', world: 2, color: '#fff3a0' },
  { id: 'omega', ...BALANCE.treadmills.omega, label: 'OMEGA', world: 2, color: '#ffffff' },
]

/**
 * Item Shop stock. Each item is a permanent +speed% boost and can be bought again
 * for more. The shop restocks every 5 minutes (see `shopOffer`).
 */
export const ITEMS = [
  { id: 'bell', ...BALANCE.items.bell, name: 'Rusty Bell', rarity: 'Common', stock: 5, icon: '🔔' },
  { id: 'pump', ...BALANCE.items.pump, name: 'Bike Pump', rarity: 'Common', stock: 5, icon: '🎈' },
  { id: 'bottle', ...BALANCE.items.bottle, name: 'Water Bottle', rarity: 'Common', stock: 5, icon: '🧴' },
  { id: 'chain', ...BALANCE.items.chain, name: 'Chain', rarity: 'Common', stock: 5, icon: '⛓️' },
  { id: 'helmet', ...BALANCE.items.helmet, name: 'Helmet', rarity: 'Uncommon', stock: 3, icon: '⛑️' },
  { id: 'gloves', ...BALANCE.items.gloves, name: 'Grip Gloves', rarity: 'Uncommon', stock: 3, icon: '🧤' },
  { id: 'pedals', ...BALANCE.items.pedals, name: 'Turbo Pedals', rarity: 'Rare', stock: 2, icon: '⚙️' },
  { id: 'nitro', ...BALANCE.items.nitro, name: 'Nitro Tank', rarity: 'Epic', stock: 1, icon: '🚀' },
  { id: 'wings', ...BALANCE.items.wings, name: 'Golden Wings', rarity: 'Legendary', stock: 1, icon: '🪽' },
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
const { products } = BALANCE
export const PRODUCTS = {
  pass2xSpeed: { name: '2x Speed', price: products.pass2xSpeed },
  pass2xWins: { name: '2x Wins', price: products.pass2xWins },
  speed100: { name: `+${products.speed100.speed} Speed`, ...products.speed100 },
  speed1k: { name: `+${products.speed1k.speed} Speed`, ...products.speed1k },
  speed10k: { name: `+${products.speed10k.speed / 1000}k Speed`, ...products.speed10k },
  speed100k: { name: `+${products.speed100k.speed / 1000}k Speed`, ...products.speed100k },
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
const Q = BALANCE.quests
export const QUESTS = [
  { id: 'speed', title: 'Gain {n} Speed', icon: '⚡', counter: 'gained', target: (t) => Q.speed.target * Q.speed.growth ** t, reward: (t) => ({ wins: Q.speed.winsBase + Q.speed.winsStep * t }) },
  { id: 'tricks', title: 'Pull off {n} Tricks', icon: '🤸', counter: 'tricks', target: (t) => Q.tricks.target * Q.tricks.growth ** t, reward: (t) => ({ wins: Q.tricks.winsBase + Q.tricks.winsStep * t }) },
  { id: 'wins', title: 'Earn {n} Wins', icon: '🏆', counter: 'wins', target: (t) => Q.wins.target * Q.wins.growth ** t, reward: (t) => ({ speed: Math.round(Q.wins.speedBase * Q.wins.speedGrowth ** t) }) },
  { id: 'jumps', title: 'Jump {n} Times', icon: '⏫', counter: 'jumps', target: (t) => Q.jumps.target * Q.jumps.growth ** t, reward: (t) => ({ wins: Q.jumps.winsBase + Q.jumps.winsStep * t }) },
  { id: 'stage', title: 'Reach Stage {n}', icon: '🚩', counter: 'bestStage', absolute: true, target: (t) => t + 2, max: 22, reward: (t) => ({ wins: Q.stage.winsBase + Q.stage.winsStep * t }) },
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

/** Collectibles: every trail and aura except "none" (star exclusives included). */
export const COLLECTIBLES = [...TRAILS.filter((t) => t.id !== 'none').map((t) => `trail:${t.id}`), ...AURAS.filter((a) => a.id !== 'none').map((a) => `aura:${a.id}`)]

/** How many trails and auras a player has collected. */
export function collectionCount(player) {
  const owned = new Set(parseList(player?.owned))
  return COLLECTIBLES.filter((key) => owned.has(key)).length
}

/** The best speed multiplier among the bikes a player owns. */
export function bestOwnedMult(player) {
  const owned = new Set(parseList(player?.owned))
  return BIKES.filter((b) => b.id === 'starter' || owned.has(`bike:${b.id}`)).reduce((max, b) => Math.max(max, b.mult), 1)
}

/** The next bike worth saving for: the cheapest one faster than the best you own. */
export function nextBikeFor(player) {
  const best = bestOwnedMult(player)
  return BIKES.filter((b) => b.mult > best && b.price > 0 && bikeAvailable(b, player)).sort((a, b) => a.price - b.price)[0] ?? null
}

/** "+40%" style: how much faster `bike` is than the best owned (0 when not faster). */
export const fasterThanBest = (bike, player) => Math.max(0, Math.round((bike.mult / bestOwnedMult(player) - 1) * 100))

/** "+40% faster" for small gaps, "12x faster" once it's 10x or more. */
export function fasterLabel(bike, player) {
  const pct = fasterThanBest(bike, player)
  if (pct <= 0) return ''
  const times = bike.mult / bestOwnedMult(player)
  return times >= 10 ? `${formatNumber(Math.round(times))}x faster` : `+${formatNumber(pct)}% faster`
}

/** Whether a player can use a treadmill. */
export function padUnlocked(pad, player) {
  if (!pad) return false
  if (pad.world === 2 && !worldUnlocked(2, player)) return false
  if (pad.wins) return parseList(player.padsOwned).includes(pad.id)
  return (player.rebirths ?? 0) >= (pad.rebirths ?? 0)
}

/** Bikes earned, never sold (rebirth milestones, star rewards). */
export const EXCLUSIVE_SHOPS = new Set(['rebirth', 'stars'])

/** Whether a bike can be bought (World 2 bikes need World 2 open; exclusives are never sold). */
export const bikeAvailable = (bike, player) => !EXCLUSIVE_SHOPS.has(bike.shop) && (bike.shop !== 'w2' || worldUnlocked(2, player))

/** Every multiplier that applies to one speed tick, split out for the UI. */
export function speedBreakdown(player, { padMult = 1, others = 0 } = {}) {
  const bike = BIKE_BY_ID[player.bike]?.mult ?? 1
  const pets = petBonus(player)
  const extras = (TRAIL_BY_ID[player.trail]?.bonus ?? 0) + itemBonus(player.items) + tuneUpBonus(player.bikeUpg) + pets.speed
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
  return (AURA_BY_ID[player.aura]?.winsMult ?? 1) * petBonus(player).wins * (double && canUseDoublePad(player) ? 2 : 1)
}

/** Wins you need to be holding to use the purple 2x Wins pads (the 2x Wins pass skips this). */
export const DOUBLE_PAD_WINS = BALANCE.doublePadWins
export const canUseDoublePad = (player) => Boolean(player?.pass2xWins) || (player?.wins ?? 0) >= DOUBLE_PAD_WINS

/* ---------------------------------------------------------------------------
 * Daily login streak
 * ------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60_000
export const DAILY_STREAK = BALANCE.rewards.daily.streak
export const STREAK_DAYS = DAILY_STREAK.length

/** Whether the streak was broken (more than `graceHours` since the last claim). */
export function streakBroken(player, now = Date.now()) {
  if (!player?.dailyAt) return false
  const lastClaim = player.dailyAt - DAILY_COOLDOWN_MS
  return now - lastClaim > BALANCE.rewards.daily.graceHours * 3_600_000
}

/** The streak day (1-7) the next claim pays. */
export function streakDayFor(player, now = Date.now()) {
  if (streakBroken(player, now)) return 1
  return ((player?.dailyStreak || 0) % STREAK_DAYS) + 1
}

/** Wins for streak `day` (1-7), grown by the player's best stage. */
export const streakWinsFor = (day, player) =>
  Math.round(DAILY_STREAK[day - 1] * (1 + BALANCE.rewards.daily.perStage * (player?.bestStage || 0)))

/* ---------------------------------------------------------------------------
 * Daily quests: three per player per UTC day, sized to their progress
 * ------------------------------------------------------------------------- */

export const dayNumber = (now = Date.now()) => Math.floor(now / DAY_MS)
export const nextDayAt = (now = Date.now()) => (dayNumber(now) + 1) * DAY_MS

/** Rounds to a friendly number (2 significant digits): 1234 -> 1200. */
function niceRound(n) {
  if (n < 10) return Math.max(1, Math.round(n))
  const p = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / p) * p
}

/** Text for a daily quest (`stage` quests name the stage). */
export function dailyQuestTitle(quest) {
  switch (quest.kind) {
    case 'jumps':
      return `Clear ${formatNumber(quest.target)} jumps`
    case 'tricks':
      return `Pull off ${formatNumber(quest.target)} tricks`
    case 'wins':
      return `Earn ${formatNumber(quest.target)} Wins from stage pads`
    case 'speed':
      return `Gain ${formatNumber(quest.target)} Speed`
    case 'train':
      return `Train ${formatNumber(quest.target)} minutes on treadmills`
    case 'stage':
      return `Finish the ${quest.stageName}`
    default:
      return 'Daily quest'
  }
}

export const DAILY_QUEST_ICONS = { jumps: '⏫', tricks: '🤸', wins: '🏆', speed: '⚡', train: '🏋️', stage: '🚩' }
/** Lifetime counter each kind reads (`stage` quests are marked done on arrival instead). */
export const DAILY_QUEST_COUNTERS = { jumps: 'jumps', tricks: 'tricks', wins: 'wins', speed: 'gained', train: 'train' }

/**
 * Picks today's three quests for a player: one riding quest, one stage, one
 * earning quest, seeded by the day and uid so it's stable all day.
 * `stages` is the layout's stage list (layout.js passes it in).
 */
export function rollDailyQuests(player, uid, day, stages) {
  const Q = BALANCE.dailyQuests
  let seed = day * 2654435761
  for (const ch of String(uid)) seed = (Math.imul(seed ^ ch.charCodeAt(0), 16777619) + 7) >>> 0
  const rng = mulberry32(seed)
  const pick = (list) => list[Math.floor(rng() * list.length)]
  const best = player.bestStage || 0
  const reward = { wins: Q.winsBase + Q.winsPerStage * best }

  // A stage the player has reached before (at least the Forest Stage), one below their best.
  const targetGid = Math.max(2, best - 1)
  const stage = stages.find((st) => st.gid === targetGid) ?? stages[1]
  const bestWins = (stages.find((st) => st.gid === Math.max(1, best)) ?? stages[0]).wins

  const ride = pick(['jumps', 'tricks'])
  const earn = pick(['wins', 'speed', 'train'])
  const quests = []
  if (ride === 'jumps') quests.push({ kind: 'jumps', target: niceRound(Q.jumps + 2 * best) })
  else quests.push({ kind: 'tricks', target: niceRound(Q.tricks + 2 * best) })
  quests.push({ kind: 'stage', target: 1, gid: stage.gid, stageName: stage.name })
  if (earn === 'wins') quests.push({ kind: 'wins', target: niceRound(Math.max(10, bestWins * Q.winsRuns)) })
  else if (earn === 'speed') quests.push({ kind: 'speed', target: niceRound(rebirthSpeedFor(player.rebirths || 0) * Q.speedShare) })
  else quests.push({ kind: 'train', target: Q.trainMinutes })
  return quests.map((q) => ({ ...q, reward, base: 0, done: false, claimed: false }))
}

/** A player's daily quests `{ day, quests }` (stored as JSON). */
export function parseDaily(text) {
  try {
    const value = JSON.parse(text || '{}')
    return value && Array.isArray(value.quests) ? value : { day: 0, quests: [] }
  } catch {
    return { day: 0, quests: [] }
  }
}

/** Progress (0..target) of a daily quest, from the player's lifetime counters. */
export function dailyQuestProgress(quest, counters) {
  if (quest.kind === 'stage') return quest.done ? 1 : 0
  const value = counters?.[DAILY_QUEST_COUNTERS[quest.kind]] || 0
  // Treadmill time is counted in seconds; the quest is in minutes.
  const amount = quest.kind === 'train' ? (value - quest.base) / 60 : value - quest.base
  return Math.max(0, Math.min(quest.target, amount))
}

/* ---------------------------------------------------------------------------
 * Rebirth milestones and preview
 * ------------------------------------------------------------------------- */

/** Milestone bikes, lowest first: [{ at, bike }]. */
export const REBIRTH_MILESTONES = Object.entries(BALANCE.rebirth.milestones)
  .map(([at, id]) => ({ at: Number(at), bike: BIKE_BY_ID[id] }))
  .sort((a, b) => a.at - b.at)

/** What the next rebirth gives: bonus before/after, treadmills it opens, milestone bike. */
export function rebirthPreview(player) {
  const from = player.rebirths || 0
  const to = from + REBIRTH_GAIN
  return {
    to,
    bonusFrom: rebirthBonus(from),
    bonusTo: rebirthBonus(to),
    treadmills: TRAIN_PADS.filter((pad) => pad.rebirths && pad.rebirths > from && pad.rebirths <= to),
    milestone: REBIRTH_MILESTONES.find((m) => m.at > from && m.at <= to) ?? null,
    nextMilestone: REBIRTH_MILESTONES.find((m) => m.at > to) ?? null,
  }
}

/* ---------------------------------------------------------------------------
 * Offline earnings
 * ------------------------------------------------------------------------- */

/** The best treadmill a player can use (World 2's only once it's open). */
export function bestTreadmillFor(player) {
  return TRAIN_PADS.filter((pad) => padUnlocked(pad, player)).sort((a, b) => b.mult - a.mult)[0] ?? TRAIN_PADS[0]
}

/**
 * Speed earned while away for `awayMs`: the best treadmill at reduced power,
 * capped by time and by a share of the next rebirth. Null when too short.
 */
export function offlineEarnings(player, awayMs) {
  const O = BALANCE.offline
  if (!(awayMs >= O.minMinutes * 60_000)) return null
  const pad = bestTreadmillFor(player)
  const seconds = Math.min(awayMs, O.maxHours * 3_600_000) / 1000
  const perSecond = BALANCE.speed.perTick * speedBreakdown(player, { padMult: pad.mult }).total * (1000 / BALANCE.speed.tickMs) * O.efficiency
  const speed = Math.floor(Math.min(perSecond * seconds, rebirthSpeedFor(player.rebirths || 0) * O.maxShareOfRebirth))
  if (speed < 1) return null
  return { speed, minutes: Math.round(awayMs / 60_000), countedMinutes: Math.round(seconds / 60), pad: pad.label, padMult: pad.mult }
}

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

/** A player's stage records `{ [gid]: best ms }` (stored as JSON). */
export function parseRecords(text) {
  try {
    const value = JSON.parse(text || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** "0:23.4" style race time. */
export function formatRaceTime(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100))
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
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
  if (reward.egg) parts.push(`Free ${EGG_BY_ID[reward.egg]?.name ?? 'Egg'}`)
  if (reward.trail) parts.push(TRAIL_BY_ID[reward.trail]?.name ?? 'Trail')
  if (reward.aura) parts.push(AURA_BY_ID[reward.aura]?.name ?? 'Aura')
  if (reward.bike) parts.push(BIKE_BY_ID[reward.bike]?.name ?? 'Bike')
  return parts.join('  ')
}

/* ---------------------------------------------------------------------------
 * Pets and eggs
 * ------------------------------------------------------------------------- */

const P = BALANCE.pets
export const MAX_PETS_EQUIPPED = P.maxEquipped
export const MAX_PETS_OWNED = P.maxOwned

/**
 * Pet species: looks (built by game/rider/petModel.js) and an emoji for windows.
 * `kind` picks the body plan; colours are body / belly / accent.
 */
export const PETS = [
  { id: 'puppy', name: 'Puppy', egg: 'basic', rarity: 'Common', emoji: '🐶', kind: 'dog', colors: ['#c98a4b', '#f3d9b5', '#5a3a1e'] },
  { id: 'kitty', name: 'Kitty', egg: 'basic', rarity: 'Common', emoji: '🐱', kind: 'cat', colors: ['#f2a65a', '#fff1dd', '#ff7a8a'] },
  { id: 'bunny', name: 'Bunny', egg: 'basic', rarity: 'Uncommon', emoji: '🐰', kind: 'bunny', colors: ['#f4f4f8', '#ffd6e6', '#ff8fb8'] },
  { id: 'chick', name: 'Chick', egg: 'basic', rarity: 'Uncommon', emoji: '🐤', kind: 'bird', colors: ['#ffe14d', '#fff6b0', '#ff9a1f'] },
  { id: 'fox', name: 'Fox', egg: 'basic', rarity: 'Rare', emoji: '🦊', kind: 'fox', colors: ['#ff7a2f', '#ffffff', '#2b1d18'] },
  { id: 'unicorn', name: 'Unicorn', egg: 'basic', rarity: 'Epic', emoji: '🦄', kind: 'unicorn', colors: ['#ffffff', '#ffd6f5', '#b45cff'], glow: true },
  { id: 'panda', name: 'Panda', egg: 'golden', rarity: 'Uncommon', emoji: '🐼', kind: 'bear', colors: ['#ffffff', '#ffffff', '#1d1d24'] },
  { id: 'penguin', name: 'Penguin', egg: 'golden', rarity: 'Uncommon', emoji: '🐧', kind: 'penguin', colors: ['#22263a', '#ffffff', '#ffb21f'] },
  { id: 'tiger', name: 'Tiger', egg: 'golden', rarity: 'Rare', emoji: '🐯', kind: 'cat', colors: ['#ff9a1f', '#ffffff', '#1d1d24'], stripes: true },
  { id: 'owl', name: 'Owl', egg: 'golden', rarity: 'Rare', emoji: '🦉', kind: 'owl', colors: ['#9a6a3e', '#f3d9b5', '#ffd23a'] },
  { id: 'dragon', name: 'Dragon', egg: 'golden', rarity: 'Epic', emoji: '🐲', kind: 'dragon', colors: ['#3bd16b', '#c6ff7a', '#ff4f4f'], glow: true },
  { id: 'phoenix', name: 'Phoenix', egg: 'golden', rarity: 'Legendary', emoji: '🔥', kind: 'phoenix', colors: ['#ff5a1f', '#ffd23a', '#fff3a0'], glow: true },
  { id: 'alien', name: 'Alien', egg: 'cosmic', rarity: 'Rare', emoji: '👽', kind: 'alien', colors: ['#7dff8a', '#c6ffd0', '#1d1d24'] },
  { id: 'robot', name: 'Robot', egg: 'cosmic', rarity: 'Rare', emoji: '🤖', kind: 'robot', colors: ['#b8c3d4', '#3dfffa', '#ff4f4f'] },
  { id: 'ghost', name: 'Ghost', egg: 'cosmic', rarity: 'Epic', emoji: '👻', kind: 'ghost', colors: ['#f4f6ff', '#c9b6ff', '#1d1d24'], glow: true },
  { id: 'galaxycat', name: 'Galaxy Cat', egg: 'cosmic', rarity: 'Epic', emoji: '🐈‍⬛', kind: 'cat', colors: ['#3b1d6e', '#b45cff', '#3dfffa'], glow: true },
  { id: 'whale', name: 'Star Whale', egg: 'cosmic', rarity: 'Legendary', emoji: '🐋', kind: 'whale', colors: ['#2f8cff', '#bfe9ff', '#ffe27a'], glow: true },
  { id: 'cosmicdragon', name: 'Cosmic Dragon', egg: 'cosmic', rarity: 'Mythic', emoji: '🐉', kind: 'dragon', colors: ['#7a2bff', '#ff6ef7', '#3dfffa'], glow: true },
].map((pet) => ({ ...pet, ...P.species[pet.id] }))

export const EGGS = [
  { id: 'basic', name: 'Basic Egg', colors: ['#fff6dd', '#ffd9a0'], ...P.eggs.basic },
  { id: 'golden', name: 'Golden Egg', colors: ['#fff3a0', '#ffb21f'], ...P.eggs.golden },
  { id: 'cosmic', name: 'Cosmic Egg', colors: ['#b45cff', '#2f1f6e'], ...P.eggs.cosmic },
]

export const PET_BY_ID = Object.fromEntries(PETS.map((pet) => [pet.id, pet]))
export const EGG_BY_ID = Object.fromEntries(EGGS.map((egg) => [egg.id, egg]))

/** "+12% Speed" or "x1.3 Wins". */
export const petBonusText = (pet) => (pet.speed ? `+${formatNumber(pet.speed * 100)}% Speed` : `x${formatNumber(pet.wins)} Wins`)

/** Each egg's pets with their chance (0..1), rarest last. */
export function eggOdds(eggId) {
  const odds = EGG_BY_ID[eggId]?.odds ?? {}
  const total = Object.values(odds).reduce((sum, w) => sum + w, 0)
  return Object.entries(odds).map(([id, w]) => ({ pet: PET_BY_ID[id], chance: w / total }))
}

/** Picks a pet from an egg with `roll` in [0, 1). */
export function rollPet(eggId, roll) {
  let left = roll
  for (const { pet, chance } of eggOdds(eggId)) {
    if (left < chance) return pet
    left -= chance
  }
  return eggOdds(eggId).at(-1).pet
}

/** Equipped pets' bonuses, added up: Speed % and Wins (x1.3 + x1.2 = x1.5). */
export function petBonus(player) {
  let speed = 0
  let wins = 1
  for (const id of parseList(player?.petsEquipped)) {
    const pet = PET_BY_ID[id]
    if (!pet) continue
    if (pet.speed) speed += pet.speed
    if (pet.wins) wins += pet.wins - 1
  }
  return { speed, wins }
}

/** Species a player has ever hatched (the Pet Index). */
export const petIndex = (player) => new Set(parseList(player?.petIndex))

/** Whether a list of equipped pets is possible with the pets owned. */
export function canEquipPets(owned, equipped) {
  if (equipped.length > MAX_PETS_EQUIPPED) return false
  const counts = {}
  for (const id of owned) counts[id] = (counts[id] || 0) + 1
  for (const id of equipped) {
    if (!counts[id]) return false
    counts[id] -= 1
  }
  return true
}

/** The best pets to equip from those owned (highest bonus first). */
export function bestPets(owned) {
  const value = (id) => {
    const pet = PET_BY_ID[id]
    return pet ? (pet.speed ?? 0) * 1 + ((pet.wins ?? 1) - 1) * 0.8 : 0
  }
  return [...owned].sort((a, b) => value(b) - value(a)).slice(0, MAX_PETS_EQUIPPED)
}

/* ---------------------------------------------------------------------------
 * Rewards from gifts and the spin wheel
 * ------------------------------------------------------------------------- */

/** Turns a reward spec ({ wins | trainMinutes | egg }) into what the player gets. */
export function resolveReward(spec, player) {
  if (spec.wins) return { wins: Math.round(spec.wins * (1 + BALANCE.rewardScale.winsPerStage * (player?.bestStage || 0))) }
  if (spec.trainMinutes) {
    const perSecond = speedPerSecond(player ?? {}, bestTreadmillFor(player ?? {}).mult)
    return { speed: niceRound(Math.max(10, spec.trainMinutes * 60 * perSecond)) }
  }
  if (spec.egg) return { egg: spec.egg }
  return {}
}

export const PLAYTIME_GIFTS = BALANCE.playtimeGifts
/** Continues after a fall: `freePerDay`, and whether rewarded ads may pay for one. */
export const CONTINUE_RULES = BALANCE.continue
export const SPIN_REWARDS = BALANCE.spin.rewards
export const SPIN_EVERY_MS = BALANCE.spin.everyMinutes * 60_000

/** Picks a spin wheel slot with `roll` in [0, 1). */
export function rollSpin(roll) {
  const total = SPIN_REWARDS.reduce((sum, r) => sum + r.weight, 0)
  let left = roll * total
  for (let i = 0; i < SPIN_REWARDS.length; i += 1) {
    if (left < SPIN_REWARDS[i].weight) return i
    left -= SPIN_REWARDS[i].weight
  }
  return SPIN_REWARDS.length - 1
}

/** Wins for a rebirth (every one pays a little). */
export const rebirthRewardFor = (rebirths) => BALANCE.rebirth.reward.wins + BALANCE.rebirth.reward.winsPerRebirth * rebirths

/* ---------------------------------------------------------------------------
 * Training time (for "you need X more Speed" messages)
 * ------------------------------------------------------------------------- */

/** Star collection rewards (thresholds and what each gives). */
export const STAR_REWARDS = BALANCE.starRewards

/** Stars that unlock a star-reward item (`cat` is trail, aura or bike), or null. */
export const starsNeededFor = (cat, id) => STAR_REWARDS.find((tier) => tier[cat] === id)?.stars ?? null

/**
 * How long the best treadmill takes to earn `missing` Speed:
 * `{ seconds, pad }` (seconds = 0 when nothing is missing).
 */
export function trainingEstimate(player, missing, others = 0) {
  const pad = bestTreadmillFor(player)
  if (missing <= 0) return { seconds: 0, pad }
  return { seconds: missing / speedPerSecond(player, pad.mult, others), pad }
}

/** Speed per second on a treadmill multiplier `padMult`. */
export const speedPerSecond = (player, padMult = 1, others = 0) =>
  BALANCE.speed.perTick * speedBreakdown(player, { padMult, others }).total * (1000 / BALANCE.speed.tickMs)
