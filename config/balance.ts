/**
 * Every number that shapes progression, in one place.
 *
 * Tune here, then:
 *   npm run balance      replays a new player's first hours and prints the timeline
 *   npm run check:climb  proves every gate: its Speed clears the gap, less falls short
 * and in the server repo `npm run sync-shared` (it copies this file across).
 *
 * How it fits together
 *  - Speed is gained while moving (and on treadmills); it resets on rebirth.
 *  - Speed sets the bike's top speed and your level, and every level is one more
 *    jump per air-time. Together they decide how far you can jump.
 *  - Each stage's gate shows a Speed. The gap in front of it is built from that
 *    number, so riders with less Speed physically can't clear it.
 *  - Wins come from the pads at the end of each stage and buy bikes, passes and
 *    tune-ups that multiply Speed gain. A stage's Wins pay for only part of the
 *    next upgrade, so you replay stages or train.
 *  - Rebirth needs a Speed target, resets Speed, and gives a permanent bonus and
 *    access to faster treadmills.
 *
 * Only plain values and type annotations here: Node strips the types itself,
 * so the server can import this file as-is.
 */

export type StageBalance = {
  /** Total Speed needed to clear the gap in front of the stage (shown on its gate). */
  speed: number
  /** Wins from the stage's Return pad (the purple pad pays double). */
  wins: number
}

export const BALANCE = {
  /** Speed gained per tick while moving, before multipliers, and how often ticks come. */
  speed: {
    perTick: 1,
    tickMs: 400,
  },

  /**
   * Levels come from Speed. Level 1 -> 2 takes `first`, each next level `growth`
   * times more. Every level is +1 jump per air-time.
   */
  levels: {
    first: 10,
    growth: 1.38,
  },

  /**
   * Bike top speed (studs/sec) from Speed: `min` at 0, rising with the log of
   * Speed, reaching `max` at `maxAtSpeed`.
   */
  bike: {
    min: 12,
    max: 120,
    maxAtSpeed: 2_000_000_000,
    /** Speed where the curve starts bending (smaller = faster early growth). */
    knee: 50,
  },

  gates: {
    /**
     * Riders with this much less than a gate's Speed always fall short (0.12 =
     * 88% of the gate). The gap sits between that and the gate's own Speed.
     */
    tolerance: 0.12,
  },

  /** World 1: ten stages and the escape plateau. */
  world1: {
    stages: [
      { speed: 10, wins: 2 },
      { speed: 120, wins: 3 },
      { speed: 600, wins: 6 },
      { speed: 2_500, wins: 14 },
      { speed: 8_000, wins: 28 },
      { speed: 22_000, wins: 50 },
      { speed: 55_000, wins: 85 },
      { speed: 130_000, wins: 130 },
      { speed: 300_000, wins: 200 },
      { speed: 650_000, wins: 300 },
    ] satisfies StageBalance[],
    finish: { speed: 1_400_000, wins: 650 } satisfies StageBalance,
  },

  /** World 2 (escape World 1 and reach `unlockRebirths`). */
  world2: {
    unlockRebirths: 10,
    stages: [
      { speed: 5_000_000, wins: 1_500 },
      { speed: 10_000_000, wins: 2_200 },
      { speed: 20_000_000, wins: 3_000 },
      { speed: 35_000_000, wins: 4_000 },
      { speed: 60_000_000, wins: 5_500 },
      { speed: 100_000_000, wins: 7_500 },
      { speed: 170_000_000, wins: 10_000 },
      { speed: 280_000_000, wins: 13_000 },
      { speed: 450_000_000, wins: 17_000 },
      { speed: 700_000_000, wins: 22_000 },
    ] satisfies StageBalance[],
    finish: { speed: 1_100_000_000, wins: 50_000 } satisfies StageBalance,
  },

  /**
   * Rebirth: needs `firstSpeed` Speed, then `growth` times more each time. Gives
   * `perRebirth` rebirths and a permanent `bonusPerRebirth` (0.5 = +50%) Speed gain.
   */
  rebirth: {
    firstSpeed: 160_000,
    growth: 1.9,
    perRebirth: 1,
    bonusPerRebirth: 0.5,
    /** Exclusive bikes given (and equipped) on reaching these rebirths. */
    milestones: { 5: 'reborn', 10: 'eclipse', 25: 'ascended' } as Record<number, string>,
  },

  /** Bikes multiply Speed gain. Prices in Wins. */
  bikes: {
    starter: { mult: 1, price: 0 },
    angel: { mult: 1.5, price: 15 },
    dragon: { mult: 2, price: 35 },
    six7: { mult: 3, price: 75 },
    ufo: { mult: 4.5, price: 150 },
    shark: { mult: 6.5, price: 350 },
    pumpkin: { mult: 9, price: 700 },
    neon: { mult: 13, price: 1_300 },
    lava: { mult: 18, price: 2_200 },
    frost: { mult: 25, price: 3_500 },
    galaxy: { mult: 35, price: 6_000 },
    candy: { mult: 48, price: 9_500 },
    rainbow: { mult: 65, price: 15_000 },
    golden: { mult: 90, price: 24_000 },
    diamond: { mult: 130, price: 40_000 },
    // Rebirth milestone bikes (not for sale; see rebirth.milestones).
    reborn: { mult: 22, price: 0 },
    eclipse: { mult: 100, price: 0 },
    ascended: { mult: 900, price: 0 },
    // World 2 bikes.
    crystal: { mult: 200, price: 60_000 },
    toxic: { mult: 300, price: 110_000 },
    phoenix: { mult: 450, price: 200_000 },
    void: { mult: 650, price: 375_000 },
    royal: { mult: 950, price: 700_000 },
    cosmic: { mult: 1_400, price: 1_300_000 },
  },

  /**
   * Treadmills multiply Speed gain while you stand on one. Early tiers unlock
   * quickly, later ones need more rebirths; the top ones cost Wins instead.
   * (World 2's need World 2 open.)
   */
  treadmills: {
    starter: { mult: 1 },
    pink: { mult: 2.5, rebirths: 1 },
    mint: { mult: 5, rebirths: 5 },
    purple: { mult: 8, rebirths: 10 },
    rocks: { mult: 12, rebirths: 15 },
    quartz: { mult: 18, rebirths: 20 },
    sky: { mult: 25, rebirths: 25 },
    cotton: { mult: 35, rebirths: 30 },
    lava: { mult: 50, rebirths: 40 },
    peridot: { mult: 75, rebirths: 50 },
    emerald: { mult: 100, rebirths: 65 },
    ruby: { mult: 150, rebirths: 80 },
    gold: { mult: 200, wins: 150_000 },
    diamond: { mult: 350, wins: 400_000 },
    poison: { mult: 600, wins: 1_000_000 },
    admin: { mult: 1_000, wins: 2_500_000 },
    // World 2.
    crystal: { mult: 15 },
    nebula: { mult: 30, rebirths: 22 },
    magma: { mult: 60, rebirths: 35 },
    frostbite: { mult: 120, rebirths: 55 },
    void: { mult: 250, rebirths: 75 },
    cosmic: { mult: 500, rebirths: 100 },
    celestial: { mult: 1_500, wins: 5_000_000 },
    omega: { mult: 3_000, wins: 15_000_000 },
  },

  /** Trails add to the Speed multiplier (0.1 = +10%). 15 to collect. */
  trails: {
    none: { bonus: 0, price: 0 },
    red: { bonus: 0.03, price: 15 },
    mint: { bonus: 0.04, price: 30 },
    bubblegum: { bonus: 0.05, price: 50 },
    ocean: { bonus: 0.06, price: 80 },
    sunset: { bonus: 0.08, price: 150 },
    toxic: { bonus: 0.1, price: 250 },
    ice: { bonus: 0.12, price: 400 },
    fire: { bonus: 0.16, price: 700 },
    shadow: { bonus: 0.2, price: 1_200 },
    lightning: { bonus: 0.25, price: 2_000 },
    neon: { bonus: 0.32, price: 3_500 },
    galaxy: { bonus: 0.4, price: 6_000 },
    gold: { bonus: 0.5, price: 12_000 },
    rainbow: { bonus: 0.65, price: 25_000 },
    cosmic: { bonus: 0.85, price: 60_000 },
  },

  /** Auras multiply Wins from stage pads. 15 to collect. */
  auras: {
    none: { winsMult: 1, price: 0 },
    bubble: { winsMult: 1.1, price: 30 },
    leaf: { winsMult: 1.15, price: 50 },
    sparkle: { winsMult: 1.25, price: 80 },
    sun: { winsMult: 1.3, price: 120 },
    ocean: { winsMult: 1.4, price: 200 },
    frost: { winsMult: 1.5, price: 300 },
    toxic: { winsMult: 1.6, price: 450 },
    heart: { winsMult: 1.75, price: 700 },
    flame: { winsMult: 2, price: 1_100 },
    storm: { winsMult: 2.2, price: 1_800 },
    galaxy: { winsMult: 2.5, price: 3_000 },
    shadow: { winsMult: 3, price: 5_000 },
    rainbow: { winsMult: 3.5, price: 10_000 },
    crown: { winsMult: 4, price: 25_000 },
    unchained: { winsMult: 5, price: 75_000 },
  },

  /** Item Shop: permanent +Speed% each (bought again for more). */
  items: {
    bell: { bonus: 0.02, price: 25 },
    pump: { bonus: 0.04, price: 50 },
    bottle: { bonus: 0.08, price: 120 },
    chain: { bonus: 0.1, price: 180 },
    helmet: { bonus: 0.18, price: 400 },
    gloves: { bonus: 0.25, price: 700 },
    pedals: { bonus: 0.45, price: 1_600 },
    nitro: { bonus: 0.8, price: 4_000 },
    wings: { bonus: 1.5, price: 12_000 },
  },
  /** Wins to restock the Item Shop early. */
  restockWins: 50,

  /** Bike tune-ups ("Bike Speed" button): +`bonus` Speed gain each, up to `max`. */
  tuneUps: {
    bonus: 0.1,
    max: 25,
    firstPrice: 30,
    priceGrowth: 1.45,
  },

  /** Passes (bought once) and Speed packs (instant Speed), in Wins. */
  products: {
    pass2xSpeed: 1_000,
    pass2xWins: 1_500,
    speed100: { speed: 100, price: 10 },
    speed1k: { speed: 1_000, price: 75 },
    speed10k: { speed: 10_000, price: 600 },
    speed100k: { speed: 100_000, price: 5_000 },
  },

  /**
   * Stage records: par is the time to reach a stage from the lobby riding at its
   * gate's top speed. 3 stars at or under `threeStar` x par, 2 under `twoStar` x par.
   */
  records: { threeStar: 1, twoStar: 1.35 },

  /** Holding this many Wins (or owning the 2x Wins pass) opens the purple 2x pads. */
  doublePadWins: 200,

  /** Timed rewards: base + perStage x (1 + best stage reached). */
  rewards: {
    /**
     * Daily login streak: Wins for days 1-7, then it starts over. Claimable
     * every `cooldownMinutes`; miss `graceHours` since the last claim and it
     * resets to day 1. Each amount grows by `perStage` per best stage reached.
     */
    daily: { streak: [20, 35, 50, 75, 110, 160, 300], perStage: 0.15, cooldownMinutes: 20 * 60, graceHours: 48 },
    chest: { base: 3, perStage: 2, cooldownMinutes: 15 },
  },

  /**
   * Three daily quests per player, new each day (UTC). Targets are sized to the
   * player's progress; each pays `winsBase` + `winsPerStage` x best stage.
   */
  dailyQuests: {
    winsBase: 15,
    winsPerStage: 6,
    jumps: 30,
    tricks: 20,
    /** "Earn N Wins": this many runs' worth of the player's best stage. */
    winsRuns: 4,
    /** "Gain N Speed": this share of the next rebirth's Speed. */
    speedShare: 0.15,
    trainMinutes: 3,
  },

  /**
   * Offline earnings: while you're away your best treadmill keeps training at
   * `efficiency` of its normal rate, for up to `maxHours`, and never more than
   * `maxShareOfRebirth` of the next rebirth's Speed. Nothing under `minMinutes`.
   */
  offline: { minMinutes: 5, maxHours: 4, efficiency: 0.1, maxShareOfRebirth: 0.5 },

  /** Quest lines: each tier's target and reward grow by `growth` / `step`. */
  quests: {
    speed: { target: 150, growth: 3, winsBase: 3, winsStep: 2 },
    tricks: { target: 25, growth: 2, winsBase: 3, winsStep: 3 },
    wins: { target: 5, growth: 3, speedBase: 100, speedGrowth: 2.5 },
    jumps: { target: 40, growth: 2, winsBase: 2, winsStep: 1 },
    stage: { winsBase: 5, winsStep: 3 },
  },

  /** +`perFriend` Speed gain per other rider in the lobby, up to `maxFriends`. */
  friends: { perFriend: 0.1, maxFriends: 5 },
}
