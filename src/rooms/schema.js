import { schema, t } from '@colyseus/schema'

/**
 * One rider in a lobby. Transform fields are written by that client's `move`
 * messages; every stat below them is server-authoritative.
 *
 * Lists (owned items) are comma-separated strings and quest data
 * is JSON — the client only ever reads them, and strings keep the patches small.
 */
export const PlayerState = schema(
  {
    name: t.string().default('Rider'),
    /** Bloxity `{ equipped, proportions }` as JSON, so others render this avatar. */
    avatar: t.string().default(''),

    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    /** Facing (yaw, radians). */
    r: t.float32().default(0),
    /** Horizontal speed, drives wheel spin and pedalling on other screens. */
    s: t.float32().default(0),
    air: t.boolean().default(false),
    /** Increments on every mid-air jump; other clients play a flip when it changes. */
    flips: t.uint16().default(0),

    level: t.uint16().default(1),
    xp: t.number().default(0),
    totalSpeed: t.number().default(0),
    wins: t.number().default(0),
    rebirths: t.uint32().default(0),
    bikeUpg: t.uint16().default(0),

    bike: t.string().default('starter'),
    trail: t.string().default('none'),
    aura: t.string().default('none'),
    /** Owned cosmetics as "bike:angel,trail:red,aura:frost". */
    owned: t.string().default('bike:starter,trail:none,aura:none'),
    padsOwned: t.string().default(''),
    /** Item Shop purchases, duplicates allowed ("bell,bell,chain"). */
    items: t.string().default(''),
    /** `{ cycle, rerolls, bought: { [itemId]: n } }` for the current restock. */
    shop: t.string().default('{}'),
    pass2xSpeed: t.boolean().default(false),
    pass2xWins: t.boolean().default(false),

    dailyAt: t.number().default(0),
    chestAt: t.number().default(0),
    bestStage: t.uint8().default(0),
    /** `{ [questId]: { tier, base } }` */
    quests: t.string().default('{}'),
    /** `{ gained, wins, jumps, tricks }` lifetime counters that quests read. */
    counters: t.string().default('{}'),
  },
  'PlayerState',
)

export const BikeState = schema(
  {
    players: t.map(PlayerState),
    /** Human-friendly lobby number shown in the HUD ("Lobby 2"). */
    lobby: t.uint16().default(1),
  },
  'BikeState',
)
