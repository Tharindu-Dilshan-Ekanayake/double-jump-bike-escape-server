import {
  AURA_BY_ID,
  BIKE_BY_ID,
  CHEST_COOLDOWN_MS,
  CODES,
  DAILY_COOLDOWN_MS,
  PRODUCTS,
  ITEM_BY_ID,
  RESTOCK_WINS,
  QUESTS,
  TRAIL_BY_ID,
  TRAIN_PAD_BY_ID,
  bikeAvailable,
  bikeSpeedFor,
  bikeSpeedUpgradeCost,
  describeReward,
  formatNumber,
  jumpsFor,
  parseList,
  rebirthGainFor,
  rebirthLevelFor,
  shopCycle,
  shopOffer,
  worldUnlocked,
  xpForLevel,
} from '../shared/gameData.js'

/**
 * Every server-side action that changes a player's stats.
 *
 * Each function mutates the PlayerState (so Colyseus syncs the change) and returns
 * `{ ok: true, toast?, ... }` or `{ ok: false, error }` for the client to display.
 * `session` holds the parsed quest/counter/code data for that connection.
 */

const round2 = (n) => Math.round(n * 100) / 100
const fail = (error) => ({ ok: false, error })

export function readJSON(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : fallback
  } catch {
    return fallback
  }
}

/** Adds speed XP, rolling over as many levels as it pays for. */
export function addSpeed(player, amount) {
  const from = player.level
  player.totalSpeed = round2(player.totalSpeed + amount)
  player.xp = round2(player.xp + amount)
  let guard = 0
  while (player.xp >= xpForLevel(player.level) && guard < 1000) {
    player.xp = round2(player.xp - xpForLevel(player.level))
    player.level += 1
    guard += 1
  }
  if (player.level === from) return null
  return {
    from,
    to: player.level,
    bikeSpeedFrom: bikeSpeedFor(from, player.bikeUpg),
    bikeSpeedTo: bikeSpeedFor(player.level, player.bikeUpg),
    jumpsFrom: jumpsFor(from),
    jumpsTo: jumpsFor(player.level),
  }
}

export function bumpCounter(player, session, key, amount = 1) {
  session.counters[key] = round2((session.counters[key] || 0) + amount)
  player.counters = JSON.stringify(session.counters)
}

export function grant(player, reward) {
  if (reward.wins) player.wins += reward.wins
  if (reward.speed) return addSpeed(player, reward.speed)
  return null
}

const owns = (player, cat, id) => parseList(player.owned).includes(`${cat}:${id}`)

function addOwned(player, cat, id) {
  if (owns(player, cat, id)) return
  player.owned = [...parseList(player.owned), `${cat}:${id}`].join(',')
}

function spend(player, currency, amount) {
  if (currency !== 'wins') return false
  if (player[currency] < amount) return false
  player[currency] -= amount
  return true
}

const CURRENCY_NAMES = { wins: 'Wins' }
const notEnough = (currency) => fail(`Not enough ${CURRENCY_NAMES[currency] || currency}!`)

/* ---------------------------------------------------------------------------
 * Buying
 * ------------------------------------------------------------------------- */

const COSMETICS = { bike: BIKE_BY_ID, trail: TRAIL_BY_ID, aura: AURA_BY_ID }

export function buy(player, session, { cat, id } = {}) {
  if (COSMETICS[cat]) {
    const def = COSMETICS[cat][id]
    if (!def) return fail('Unknown item')
    if (cat === 'bike' && !bikeAvailable(def, player)) return fail('Unlock World 2 first: escape World 1 and reach 10 rebirths!')
    if (!owns(player, cat, id)) {
      const currency = def.currency || 'wins'
      if (!spend(player, currency, def.price)) return notEnough(currency)
      addOwned(player, cat, id)
    }
    player[cat] = id
    return { ok: true, toast: `Equipped ${def.name}!`, bought: { cat, id } }
  }

  if (cat === 'pad') {
    const pad = TRAIN_PAD_BY_ID[id]
    if (!pad || !pad.wins) return fail('That pad unlocks with rebirths')
    if (pad.world === 2 && !worldUnlocked(2, player)) return fail('Unlock World 2 first!')
    if (parseList(player.padsOwned).includes(id)) return fail('Already unlocked')
    if (!spend(player, 'wins', pad.wins)) return notEnough('wins')
    player.padsOwned = [...parseList(player.padsOwned), id].join(',')
    return { ok: true, toast: `Unlocked the ${pad.mult}x Speed pad!` }
  }

  if (cat === 'product') {
    const product = PRODUCTS[id]
    if (!product) return fail('Unknown product')
    if ((id === 'pass2xSpeed' || id === 'pass2xWins') && player[id]) return fail('You already own this!')
    if (!spend(player, 'wins', product.price)) return notEnough('wins')
    if (id === 'pass2xSpeed' || id === 'pass2xWins') {
      player[id] = true
      return { ok: true, toast: `${product.name} unlocked forever!` }
    }
    const levelUp = addSpeed(player, product.speed)
    return { ok: true, toast: `${product.name}!`, levelUp, speed: product.speed }
  }

  if (cat === 'item') return buyItem(player, id)
  if (cat === 'restock') {
    const shop = currentShop(player)
    if (!spend(player, 'wins', RESTOCK_WINS)) return notEnough('wins')
    shop.rerolls += 1
    shop.bought = {}
    player.shop = JSON.stringify(shop)
    return { ok: true, toast: 'Shop restocked!' }
  }

  if (cat === 'bikeSpeed') {
    const cost = bikeSpeedUpgradeCost(player.bikeUpg)
    if (!spend(player, 'wins', cost)) return notEnough('wins')
    player.bikeUpg += 1
    return { ok: true, toast: `Max Bike Speed ${bikeSpeedFor(player.level, player.bikeUpg)}!` }
  }

  return fail('Unknown purchase')
}

/* ---------------------------------------------------------------------------
 * Item Shop
 * ------------------------------------------------------------------------- */

/** The player's view of the current restock; resets when a new cycle starts. */
export function currentShop(player, now = Date.now()) {
  const cycle = shopCycle(now)
  const shop = readJSON(player.shop, {})
  if (shop.cycle !== cycle) return { cycle, rerolls: 0, bought: {} }
  return { cycle, rerolls: shop.rerolls || 0, bought: shop.bought || {} }
}

function buyItem(player, id) {
  const item = ITEM_BY_ID[id]
  if (!item) return fail('Unknown item')
  const shop = currentShop(player)
  if (!shopOffer(shop.cycle, shop.rerolls).includes(id)) return fail('That item sold out — wait for the restock!')
  const bought = shop.bought[id] || 0
  if (bought >= item.stock) return fail('Out of stock!')
  if (!spend(player, 'wins', item.price)) return notEnough('wins')
  shop.bought[id] = bought + 1
  player.shop = JSON.stringify(shop)
  player.items = [...parseList(player.items), id].join(',')
  return { ok: true, toast: `${item.name}! +${Math.round(item.bonus * 100)}% Speed forever` }
}

/* ---------------------------------------------------------------------------
 * Equipping
 * ------------------------------------------------------------------------- */

export function equip(player, { cat, id, action = 'equip' } = {}) {
  if (COSMETICS[cat]) {
    if (!COSMETICS[cat][id]) return fail('Unknown item')
    if (!owns(player, cat, id)) return fail("You don't own that yet")
    player[cat] = id
    return { ok: true }
  }

  return fail('Unknown equip')
}

/* ---------------------------------------------------------------------------
 * Rebirth, rewards, quests, codes
 * ------------------------------------------------------------------------- */

export function rebirth(player) {
  const needed = rebirthLevelFor(player.rebirths)
  if (player.level < needed) return fail(`Reach Level ${needed} to rebirth!`)
  // The higher your level when you rebirth, the more rebirths you get.
  const gained = rebirthGainFor(player.level)
  player.rebirths += gained
  player.level = 1
  player.xp = 0
  return { ok: true, toast: `+${formatNumber(gained)} Rebirths! (${formatNumber(player.rebirths)} total)`, rebirth: player.rebirths }
}

const TIMED = {
  daily: { field: 'dailyAt', cooldown: DAILY_COOLDOWN_MS },
  chest: { field: 'chestAt', cooldown: CHEST_COOLDOWN_MS },
}

function timedReward(what, player) {
  const stageScale = 1 + (player.bestStage || 0)
  if (what === 'daily') return { wins: 20 + 5 * stageScale }
  return { wins: 3 + 2 * stageScale }
}

export function claimTimed(player, what, now = Date.now()) {
  const def = TIMED[what]
  if (!def) return fail('Unknown reward')
  if (now < player[def.field]) return fail('Not ready yet!')
  const reward = timedReward(what, player)
  player[def.field] = now + def.cooldown
  const levelUp = grant(player, reward)
  return { ok: true, reward, levelUp, toast: describeReward(reward) }
}

function questValue(player, session, quest) {
  if (quest.counter === 'bestStage') return player.bestStage || 0
  return session.counters[quest.counter] || 0
}

export function claimQuest(player, session, questId) {
  const quest = QUESTS.find((q) => q.id === questId)
  if (!quest) return fail('Unknown quest')
  const entry = session.quests[quest.id] || { tier: 0, base: 0 }
  const target = quest.target(entry.tier)
  if (quest.max && target > quest.max) return fail('Quest line complete!')
  const value = questValue(player, session, quest)
  const progress = quest.absolute ? value : value - entry.base
  if (progress < target) return fail('Keep going!')

  const reward = quest.reward(entry.tier)
  const levelUp = grant(player, reward)
  session.quests[quest.id] = { tier: entry.tier + 1, base: value }
  player.quests = JSON.stringify(session.quests)
  return { ok: true, reward, levelUp, toast: describeReward(reward) }
}

export function redeemCode(player, session, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase().slice(0, 32)
  const reward = CODES[code]
  if (!reward) return fail('Invalid code')
  if (session.codes.includes(code)) return fail('Code already redeemed')
  session.codes.push(code)
  const levelUp = grant(player, reward)
  return { ok: true, reward, levelUp, toast: describeReward(reward) }
}
