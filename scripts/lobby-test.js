/**
 * Smoke test against a running server (`npm start` first).
 *
 * Connects 17 bots and checks Colyseus splits them 8 / 8 / 1 across lobbies, then
 * drives one bot around to confirm speed ticks, pads, rebirths and purchases work.
 *
 *   npm run test:lobbies            # ws://localhost:2567
 *   node scripts/lobby-test.js ws://my-host:2567
 */
import { Client } from '@colyseus/sdk'

import { ITEMS, ROOM_NAME, shopCycle, shopOffer } from '../src/shared/gameData.js'
import { getLayout } from '../src/shared/layout.js'

const endpoint = process.argv[2] || 'ws://localhost:2567'
const BOTS = 17
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) process.exitCode = 1
}

const client = new Client(endpoint)
const rooms = []
for (let i = 0; i < BOTS; i += 1) {
  const room = await client.joinOrCreate(ROOM_NAME, { uid: `test:bot-${i}`, name: `Bot${i}` })
  room.onMessage('*', () => {})
  rooms.push(room)
}
await wait(300)

const byRoom = new Map()
for (const room of rooms) byRoom.set(room.roomId, (byRoom.get(room.roomId) || 0) + 1)
const sizes = [...byRoom.values()]
check('17 bots split into lobbies of at most 8', sizes.every((n) => n <= 8), `sizes ${sizes.join('/')}`)
check('three lobbies were created', byRoom.size === 3, `${byRoom.size} lobbies`)
check('first lobby is full', rooms[0].state.players.size === 8, `${rooms[0].state.players.size} players`)

// Drive bot 0 around: speed ticks should arrive while it moves.
const bot = rooms[0]
const gains = []
const results = []
bot.onMessage('gain', (m) => gains.push(m.n))
bot.onMessage('result', (m) => results.push(m))
const me = () => bot.state.players.get(bot.sessionId)
const start = { x: me().x, z: me().z }
for (let i = 0; i < 40; i += 1) {
  bot.send('move', { x: start.x + Math.sin(i / 4) * 6, y: 0.2, z: start.z - i * 0.6, r: 0, s: 12, a: 0 })
  await wait(50)
}
check('speed ticks arrive while moving', gains.length >= 3, `${gains.length} ticks, total speed ${me().totalSpeed}`)

const layout = getLayout()

// Return pad on the Starter plateau.
const pad = layout.pads.find((p) => p.stage === 1 && p.kind === 'return')
const winsBefore = me().wins
bot.send('move', { x: (pad.min[0] + pad.max[0]) / 2, y: pad.max[1], z: (pad.min[2] + pad.max[2]) / 2, r: 0, s: 0, a: 0 })
bot.send('pad', { stage: 1, kind: 'return' })
await wait(200)
check('return pad grants wins', me().wins > winsBefore, `${winsBefore} -> ${me().wins}`)

// Purchases are in Wins: redeem a code for some, then buy a speed pack.
bot.send('code', { code: 'ESCAPE' })
await wait(200)
const speedBefore = me().totalSpeed
bot.send('buy', { cat: 'product', id: 'speed100' })
await wait(200)
check('wins purchase works', me().totalSpeed >= speedBefore + 100, `wins now ${me().wins}`)
check('there are no gems or coins', me().gems === undefined && me().coins === undefined)
bot.send('buy', { cat: 'bike', id: 'golden' })
await wait(200)
check('cannot buy what you cannot afford', results.some((r) => r.action === 'buy' && !r.ok))

// Treadmill: standing still on the free starter treadmill still pays out.
const mill = layout.trainPads.find((p) => p.id === 'starter')
const [mx, mz] = mill.center
bot.send('move', { x: mx, y: mill.max[1], z: mz, r: Math.PI, s: 18, a: 0 })
await wait(250)
const millGains = gains.length
await wait(1400)
check('treadmill pays while standing still', gains.length - millGains >= 2, `${gains.length - millGains} ticks`)

// Item Shop (in Wins): redeem the rest of the codes, then buy the cheapest item on offer.
for (const code of ['WORLD2', 'RELEASE', 'BIKEFLIP', 'DOUBLEJUMP']) bot.send('code', { code })
await wait(200)
const offer = shopOffer(shopCycle(), 0)
const cheapest = offer[0]
const winsBeforeItem = me().wins
bot.send('buy', { cat: 'item', id: cheapest })
await wait(250)
check('item shop purchase works', me().items.split(',').includes(cheapest), `${cheapest}, wins ${winsBeforeItem} -> ${me().wins}`)
check('item stock is tracked', JSON.parse(me().shop).bought?.[cheapest] === 1, `shop ${me().shop}, bought ${cheapest}`)
const notOnSale = ITEMS.find((item) => !offer.includes(item.id))
bot.send('buy', { cat: 'item', id: notOnSale.id })
await wait(200)
check('items not on sale are refused', !me().items.split(',').includes(notOnSale.id))

// Rebirth needs its Speed target (scripts/economy-test.js covers a real rebirth).
const spawn = layout.worlds[0].spawn
bot.send('move', { x: spawn.x, y: spawn.y, z: spawn.z, r: 0, s: 0, a: 0 })
const rebirthsBefore = me().rebirths
const speedBefore2 = me().totalSpeed
bot.send('rebirth', {})
await wait(250)
check('rebirth is refused below its Speed target', me().rebirths === rebirthsBefore && me().totalSpeed >= speedBefore2, `speed ${me().totalSpeed}`)

// World 2 bikes stay locked until World 2 is unlocked (escape World 1 + 10 rebirths).
bot.send('buy', { cat: 'bike', id: 'crystal' })
await wait(200)
check('World 2 bikes are locked', !me().owned.includes('bike:crystal'))

// A tenth player into a full lobby must not land in lobby 1.
const extra = await client.joinOrCreate(ROOM_NAME, { uid: 'test:late', name: 'Late' })
check('late joiner avoids the full lobby', extra.roomId !== rooms[0].roomId)

for (const room of [...rooms, extra]) await room.leave()
console.log(process.exitCode ? 'Some checks failed.' : 'All checks passed.')
process.exit()
