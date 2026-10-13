/**
 * Unit checks for the progression rules (npm run test:economy): levels from
 * Speed, rebirth targets and resets, tune-ups. No server needed.
 */
import { BALANCE } from '../config/balance.ts'
import {
  addSpeed,
  applyOffline,
  buy,
  checkStarRewards,
  claimDaily,
  claimDailyQuest,
  claimGift,
  ensureDaily,
  hatchEgg,
  markDailyStage,
  rebirth,
  setPets,
  releasePet,
  spinWheel,
  useContinue,
} from '../src/game/economy.js'
import {
  DAILY_COOLDOWN_MS,
  EGG_BY_ID,
  PLAYTIME_GIFTS,
  SPIN_EVERY_MS,
  STAR_REWARDS,
  petBonus,
  rebirthRewardFor,
  REBIRTH_MILESTONES,
  dailyQuestProgress,
  levelForSpeed,
  parseDaily,
  rebirthSpeedFor,
  speedForLevel,
  streakWinsFor,
  tuneUpCost,
} from '../src/shared/gameData.js'

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

const fresh = () => ({ level: 1, xp: 0, totalSpeed: 0, wins: 0, rebirths: 0, bikeUpg: 0, owned: '', counters: '{}' })

// Levels come from Speed.
const p = fresh()
addSpeed(p, BALANCE.levels.first - 0.01)
check('just under the first level stays level 1', p.level === 1, `level ${p.level}`)
const up = addSpeed(p, 0.01)
check('reaching it is level 2', p.level === 2 && up?.to === 2, `level ${p.level}`)
addSpeed(p, speedForLevel(12) - p.totalSpeed)
check('levels follow the curve', p.level === 12 && levelForSpeed(p.totalSpeed) === 12, `level ${p.level}`)

// Rebirth: refused below the target, then resets Speed and counts one.
const need = rebirthSpeedFor(0)
const q = fresh()
addSpeed(q, need - 1)
check('rebirth refused below its Speed', !rebirth(q).ok && q.rebirths === 0)
addSpeed(q, 1)
const done = rebirth(q)
check('rebirth at its Speed', done.ok && q.rebirths === BALANCE.rebirth.perRebirth, done.toast)
check('rebirth resets Speed and level', q.totalSpeed === 0 && q.level === 1)
check('the next rebirth needs more', rebirthSpeedFor(q.rebirths) > need, `${need} -> ${rebirthSpeedFor(q.rebirths)}`)

// Tune-ups cost Wins and stop at the max.
const r = fresh()
r.wins = tuneUpCost(0)
check('tune-up bought', buy(r, null, { cat: 'bikeSpeed' }).ok && r.bikeUpg === 1 && r.wins === 0)
check('tune-up refused without Wins', !buy(r, null, { cat: 'bikeSpeed' }).ok && r.bikeUpg === 1)
r.bikeUpg = BALANCE.tuneUps.max
r.wins = 1e12
check('tune-ups stop at the max', !buy(r, null, { cat: 'bikeSpeed' }).ok && r.bikeUpg === BALANCE.tuneUps.max)

// Daily login streak: day 1..7, then it starts over; a missed day resets it.
const d = { ...fresh(), dailyAt: 0, dailyStreak: 0, bestStage: 0 }
let t = Date.UTC(2026, 0, 1, 12)
const days = []
for (let i = 0; i < 8; i += 1) {
  days.push(claimDaily(d, t).streakDay)
  t += DAILY_COOLDOWN_MS + 60_000
}
check('streak runs day 1 to 7 and starts over', days.join(',') === '1,2,3,4,5,6,7,1', days.join(','))
check('claiming again too soon is refused', !claimDaily(d, t - DAILY_COOLDOWN_MS).ok)
check('day 1 pays its Wins', streakWinsFor(1, d) === BALANCE.rewards.daily.streak[0])
t += 3 * 24 * 3_600_000
check('a missed day resets the streak', claimDaily(d, t).streakDay === 1)

// Daily quests: three, only today's progress counts, stage quest done on arrival.
const dq = { ...fresh(), daily: '{}', bestStage: 4, rebirths: 0 }
const session = { uid: 'guest:test', counters: { jumps: 500, tricks: 300, wins: 40, gained: 9, train: 600 } }
ensureDaily(dq, session)
const today = parseDaily(dq.daily)
check('three daily quests rolled', today.quests.length === 3, today.quests.map((q) => q.kind).join(','))
const counterQuest = today.quests.find((q) => q.kind !== 'stage')
check("earlier progress doesn't count", dailyQuestProgress(counterQuest, session.counters) === 0)
check('unfinished quest refused', !claimDailyQuest(dq, session, today.quests.indexOf(counterQuest)).ok)
const stageIndex = today.quests.findIndex((q) => q.kind === 'stage')
markDailyStage(dq, session, today.quests[stageIndex].gid)
const winsBefore = dq.wins
check('stage quest claimable after landing there', claimDailyQuest(dq, session, stageIndex).ok && dq.wins > winsBefore)
check('a quest is claimed only once', !claimDailyQuest(dq, session, stageIndex).ok)

// Rebirth milestones: the exclusive bike arrives at its rebirth and is ridden.
const first = REBIRTH_MILESTONES[0]
const m = { ...fresh(), rebirths: first.at - 1, bike: 'starter', owned: 'bike:starter' }
addSpeed(m, rebirthSpeedFor(m.rebirths))
const reborn = rebirth(m)
check('milestone bike given at its rebirth and equipped', reborn.celebrate?.bikes.includes(first.bike.id) && m.bike === first.bike.id)
check('milestone bikes are not for sale', !buy({ ...fresh(), wins: 1e9 }, null, { cat: 'bike', id: REBIRTH_MILESTONES[1].bike.id }).ok)

// Offline earnings: nothing for a short break, capped for a long one.
const o = { ...fresh(), rebirths: 1, bike: 'starter', owned: 'bike:starter' }
check('no offline earnings for a short break', applyOffline(o, 60_000) === null)
const long = applyOffline(o, 48 * 3_600_000)
check(
  'offline earnings capped by time and rebirth share',
  long && long.speed <= rebirthSpeedFor(1) * BALANCE.offline.maxShareOfRebirth && long.countedMinutes === BALANCE.offline.maxHours * 60,
  `${long?.speed} Speed`,
)

// Pets: bought eggs cost Wins, the pet is picked by the server, slots fill first.
const pp = { ...fresh(), wins: EGG_BY_ID.basic.price * 4, pets: '', petsEquipped: '', petIndex: '' }
const h1 = hatchEgg(pp, 'basic', { roll: 0.999 })
check('egg hatches the rarest pet on a top roll', h1.ok && h1.hatch.pet === 'unicorn' && h1.hatch.isNew)
check('egg costs Wins', pp.wins === EGG_BY_ID.basic.price * 3)
hatchEgg(pp, 'basic', { roll: 0 })
hatchEgg(pp, 'basic', { roll: 0 })
hatchEgg(pp, 'basic', { roll: 0 })
check('up to 3 pets equipped automatically', pp.petsEquipped.split(',').length === 3 && pp.pets.split(',').length === 4)
check('equipping pets you do not own is refused', !setPets(pp, ['dragon']).ok)
check('equip best picks the strongest', setPets(pp, 'best').ok && pp.petsEquipped.startsWith('unicorn'))
check('pets add their bonus', petBonus(pp).wins > 1)
const rp = { ...fresh(), pets: 'puppy,puppy,fox', petsEquipped: 'puppy,fox' }
check('a spare pet can be released', releasePet(rp, 'puppy').ok && rp.pets === 'puppy,fox')
check('an equipped pet cannot be released', !releasePet(rp, 'puppy').ok && !releasePet(rp, 'fox').ok && !releasePet(rp, 'dragon').ok)
check('egg refused without Wins', !hatchEgg({ ...fresh(), wins: 0, pets: '' }, 'golden').ok)

// Playtime gifts: in order, only after their minutes, once per session.
const g = { ...fresh(), sessionStart: 0, giftsClaimed: 0, bestStage: 0, pets: '', petsEquipped: '', petIndex: '' }
check('gift refused before its time', !claimGift(g, PLAYTIME_GIFTS[0].minutes * 60_000 - 1000).ok)
check('gift given after its time', claimGift(g, PLAYTIME_GIFTS[0].minutes * 60_000).ok && g.giftsClaimed === 1)
let at = 0
for (const gift of PLAYTIME_GIFTS.slice(1)) {
  at = gift.minutes * 60_000
  claimGift(g, at)
}
check('every gift claimable once', g.giftsClaimed === PLAYTIME_GIFTS.length && !claimGift(g, at + 3_600_000).ok)

// Lucky spin: ready after the wait, then recharges.
const sp = { ...fresh(), spinReadyAt: 1000, pets: '', petsEquipped: '', petIndex: '' }
check('spin refused while recharging', !spinWheel(sp, 500).ok)
const spun = spinWheel(sp, 1000, 0)
check('spin gives a reward and recharges', spun.ok && spun.spin === 0 && sp.spinReadyAt === 1000 + SPIN_EVERY_MS)

// Continues: one free per day, only from an island reached this run.
const c = { ...fresh(), continueDay: 0, continuesUsed: 0 }
const cs = { runIslands: new Set([3]) }
check('continue refused for an island not reached', !useContinue(c, cs, { gid: 5 }).ok)
check('first continue of the day is free', useContinue(c, cs, { gid: 3 }).ok)
check('second continue the same day is refused', !useContinue(c, cs, { gid: 3 }).ok)
check('ads refused while ads are off', !useContinue(c, cs, { gid: 3, via: 'ad' }).ok)
check('a new day gives a new free continue', useContinue(c, cs, { gid: 3 }, Date.now() + 86_400_000).ok)

// Every rebirth pays a little.
const rr = { ...fresh(), rebirths: 0, wins: 0, bike: 'starter', owned: 'bike:starter' }
addSpeed(rr, rebirthSpeedFor(0))
const party = rebirth(rr)
check('every rebirth pays Wins', party.celebrate.wins === rebirthRewardFor(1) && rr.wins === rebirthRewardFor(1))

// Star rewards: given once as stars are reached.
const st = { ...fresh(), wins: 0, starTiers: 0, owned: 'bike:starter', records: JSON.stringify({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 }) }
const stars = checkStarRewards(st)
check('star reward given at its stars', stars.total >= STAR_REWARDS[0].stars && stars.given.length >= 1 && st.wins >= STAR_REWARDS[0].wins, `${stars.total} stars`)
check('star rewards are given only once', checkStarRewards(st).given.length === 0)
check('star exclusives are not for sale', !buy({ ...fresh(), wins: 1e9 }, null, { cat: 'trail', id: 'star' }).ok && !buy({ ...fresh(), wins: 1e9 }, null, { cat: 'bike', id: 'star' }).ok)

console.log(process.exitCode ? 'Some checks failed.' : 'All economy checks passed.')
