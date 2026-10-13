/**
 * Unit checks for the progression rules (npm run test:economy): levels from
 * Speed, rebirth targets and resets, tune-ups. No server needed.
 */
import { BALANCE } from '../config/balance.ts'
import { addSpeed, applyOffline, buy, claimDaily, claimDailyQuest, ensureDaily, markDailyStage, rebirth } from '../src/game/economy.js'
import {
  DAILY_COOLDOWN_MS,
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

console.log(process.exitCode ? 'Some checks failed.' : 'All economy checks passed.')
