/**
 * Deterministic world layout: two worlds, each a lobby plus ten stages and a finish.
 *
 * Pure data, no three.js — the client turns it into meshes and colliders, the
 * server uses the same pad / treadmill positions to validate claims.
 * Shared with the server (see the note at the top of gameData.js).
 *
 * Coordinates are studs, Y up. Each course runs from its lobby towards -Z. Stage 1
 * is level with the lobby; each later stage is a short island a little higher
 * than the one before, across a gap over a deadly river. Each gap is built
 * from its gate's Speed: more Speed means a faster bike and more jumps, so you
 * fly further. World 2 sits 3000 studs along +X.
 */
import { BALANCE } from '../../config/balance.ts'
import { BIKES, PHYSICS, TRAIN_PADS, WORLDS, bikeSpeedFor, jumpsFor, levelForSpeed, mulberry32 } from './gameData.js'

export { mulberry32 }

/** Each stage is an island spanning x ∈ [-HALF_WIDTH, HALF_WIDTH] around the world's origin. */
export const HALF_WIDTH = 32
/** The deadly pit spans x ∈ [-CORRIDOR_HALF, CORRIDOR_HALF]; terraced cliffs rise beyond it. */
export const CORRIDOR_HALF = 66
export const LOBBY_FRONT_Z = -60
/** The lobby floor and the first stage sit at this height. */
export const COURSE_Y = 0
/** Each stage sits this much higher than the one before it. */
export const STAGE_RISE = 3
/** How far below the stages the deadly pit floor sits. */
export const PIT_DEPTH = 12
export const OCEAN_Y = -22
/** Cliff terraces beside the course: [from, to] studs out from the pit edge, and height above the course. */
export const CLIFF_TIERS = [
  [0, 30, 8],
  [30, 66, 22],
  [66, 110, 38],
]

/** Height gained per jump when each jump is pressed near the top of the last one. */
export const JUMP_RISE = PHYSICS.jumpVelocity ** 2 / (2 * PHYSICS.gravity)

/**
 * Material keys per theme. The client maps each key to a texture.
 *  top     island floor         face   island sides
 *  river   the deadly river flowing through the pit (a liquid kind)
 *  wall    cliffs beside the course
 *  side    cliff terrace tops   laser  beam colour
 *  fringe  hanging grass colour on the island's front edge (optional)
 */
export const THEMES = {
  starter: { top: 'grass', face: 'dirt', river: 'water', wall: 'dirt', side: 'grass', laser: 'red', fringe: '#55c22c' },
  forest: { top: 'forestTop', face: 'dirt', river: 'water', wall: 'dirt', side: 'grass', laser: 'red', fringe: '#55c22c' },
  cloud: { top: 'poolTile', face: 'checkerBlue', river: 'water', wall: 'checkerBlue', side: 'cloudWhite', laser: 'red' },
  volcano: { top: 'redStud', face: 'darkChecker', river: 'lava', wall: 'darkRock', side: 'darkRock', laser: 'yellow' },
  desert: { top: 'sandTile', face: 'sandstone', river: 'quicksand', wall: 'sandstone', side: 'sand', laser: 'red' },
  ice: { top: 'ice', face: 'iceWall', river: 'icewater', wall: 'iceWall', side: 'snow', laser: 'red' },
  candy: { top: 'candy', face: 'candyWall', river: 'chocolate', wall: 'candyWall', side: 'candy', laser: 'red' },
  neon: { top: 'neonFloor', face: 'neonWall', river: 'neon', wall: 'neonWall', side: 'neonWall', laser: 'magenta' },
  space: { top: 'spaceTile', face: 'metal', river: 'void', wall: 'metal', side: 'moonRock', laser: 'green' },
  rainbow: { top: 'rainbowTile', face: 'cloudWhite', river: 'rainbow', wall: 'cloudWhite', side: 'cloudWhite', laser: 'red' },
  finish: { top: 'gold', face: 'goldWall', river: 'gold', wall: 'goldWall', side: 'cloudWhite', laser: 'red' },
  jungle: { top: 'jungleTile', face: 'mossStone', river: 'swamp', wall: 'mossStone', side: 'jungleGrass', laser: 'yellow', fringe: '#2f9e3a' },
  beach: { top: 'planks', face: 'sandstone', river: 'sea', wall: 'sandstone', side: 'sand', laser: 'red' },
  toxic: { top: 'toxicTile', face: 'metal', river: 'slime', wall: 'metal', side: 'toxicTile', laser: 'green' },
  haunted: { top: 'hauntedTile', face: 'hauntedStone', river: 'ghost', wall: 'hauntedStone', side: 'hauntedGround', laser: 'magenta' },
  crystal: { top: 'crystalTile', face: 'crystalWall', river: 'crystal', wall: 'crystalWall', side: 'crystalTile', laser: 'magenta' },
  factory: { top: 'metal', face: 'hazardStripe', river: 'molten', wall: 'metalDark', side: 'metal', laser: 'yellow' },
  sakura: { top: 'sakuraTile', face: 'woodWall', river: 'sakura', wall: 'woodWall', side: 'sakuraGrass', laser: 'red', fringe: '#ff9fd6' },
  magma: { top: 'magmaTile', face: 'darkRock', river: 'lava', wall: 'darkRock', side: 'darkRock', laser: 'yellow' },
  galaxy: { top: 'spaceTile', face: 'galaxyWall', river: 'void', wall: 'galaxyWall', side: 'galaxyWall', laser: 'magenta' },
  golden: { top: 'gold', face: 'goldWall', river: 'gold', wall: 'goldWall', side: 'cloudWhite', laser: 'red' },
}

/**
 * Per-world lobby look and size: the plaza spans x ±halfX and z LOBBY_FRONT_Z..back,
 * riders spawn at z = spawnZ, and coloured zones mark training (right) and
 * shopping (left).
 */
const LOBBY_STYLE = {
  1: { plaza: 'plaza', road: 'lobbyRoad', grass: 'grass', hills: 'grass', halfX: 96, back: 118, spawnZ: 46, train: 'trainZone', shop: 'shopZone' },
  2: { plaza: 'w2plaza', road: 'lobbyRoad', grass: 'sakuraGrass', hills: 'sakuraGrass', halfX: 84, back: 104, spawnZ: 44, train: 'trainZone', shop: 'shopZone' },
}

let cached = null

/** Builds (once) and returns the full layout. */
export function getLayout() {
  if (!cached) cached = buildLayout()
  return cached
}

export function buildLayout() {
  const layout = {
    boxes: [],
    lasers: [],
    sweepers: [],
    pads: [],
    trainPads: [],
    signs: [],
    stages: [],
    worlds: [],
    leaderboards: [],
    shops: [],
    bikeStands: [],
    auraStands: [],
    portals: [],
    triggers: [],
    decor: [],
    chest: null,
  }

  /** Adds an axis-aligned box. `zone` groups geometry for culling (world*100 + stage). */
  const box = (x0, x1, y0, y1, z0, z1, mat, opts = {}) => {
    layout.boxes.push({
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      mat,
      solid: opts.solid ?? true,
      visible: opts.visible ?? true,
      zone: opts.zone ?? 0,
    })
  }

  for (const world of WORLDS) {
    const info = {
      id: world.id,
      name: world.name,
      originX: world.originX,
      spawn: { x: world.originX, y: 0.2, z: LOBBY_STYLE[world.id].spawnZ, yaw: Math.PI },
      stages: [],
    }
    layout.worlds.push(info)
    buildLobby(layout, box, world, info)
    buildCourse(layout, box, world, info)
  }
  layout.spawn = layout.worlds[0].spawn
  return layout
}

/* ---------------------------------------------------------------------------
 * Lobbies
 * ------------------------------------------------------------------------- */

function trigger(layout, kind, data, x0, x1, z0, z1, y1 = 10) {
  layout.triggers.push({ kind, ...data, min: [Math.min(x0, x1), -2, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)] })
}

function buildLobby(layout, box, world, info) {
  const ox = world.originX
  const style = LOBBY_STYLE[world.id]
  const zone = world.id * 100
  const hx = style.halfX
  const back = style.back
  const spawnZ = info.spawn.z

  // Grass island (stopping at the course so it never covers a pit), the plaza,
  // its coloured zones, the road to the course and the spawn pad.
  const courseEdge = CORRIDOR_HALF + CLIFF_TIERS[CLIFF_TIERS.length - 1][1]
  box(ox - 300, ox + 300, OCEAN_Y - 10, -0.25, LOBBY_FRONT_Z, 300, style.grass, { zone })
  for (const side of [-1, 1]) {
    box(ox + side * courseEdge, ox + side * 300, OCEAN_Y - 10, -0.25, -220, LOBBY_FRONT_Z, style.grass, { zone })
    // Keeps lobby riders out of the cliff scenery beside the course.
    box(ox + side * CORRIDOR_HALF, ox + side * 300, OCEAN_Y - 10, COURSE_Y + 3000, LOBBY_FRONT_Z - 3, LOBBY_FRONT_Z, 'none', { visible: false, zone })
  }
  box(ox - hx, ox + hx, -2, 0, LOBBY_FRONT_Z, back, style.plaza, { zone })
  box(ox + 30, ox + hx - 4, -0.5, 0.04, -4, back - 8, style.train, { zone, solid: false })
  box(ox - hx + 4, ox - 30, -0.5, 0.04, -4, back - 8, style.shop, { zone, solid: false })
  box(ox - 10, ox + 10, -0.5, 0.06, LOBBY_FRONT_Z, spawnZ - 9, style.road, { zone, solid: false })
  box(ox - 9, ox + 9, 0, 0.2, spawnZ - 9, spawnZ + 9, 'spawn', { zone })
  // Glowing trim around the plaza (decorative, below step height).
  box(ox + hx - 0.8, ox + hx, -0.2, 0.32, LOBBY_FRONT_Z, back, 'neon', { zone, solid: false })
  box(ox - hx, ox - hx + 0.8, -0.2, 0.32, LOBBY_FRONT_Z, back, 'neon', { zone, solid: false })
  box(ox - hx, ox + hx, -0.2, 0.32, back - 0.8, back, 'neon', { zone, solid: false })

  layout.decor.push({ kind: 'lobby', world: world.id, originX: ox, halfX: hx, back, hills: style.hills, spawnZ })

  if (world.id === 1) {
    buildTreadmills(layout, box, world, [40, 55, 70, 85], [12, 36, 60, 84], 93)
    layout.signs.push({ kind: 'title', text: 'Train Speed', color: '#2f9bff', pos: [ox + 92.6, 15, 48], rotY: -Math.PI / 2, size: [34, 7] })

    // Leaderboards in a gentle arc behind the spawn, facing it.
    const boards = [
      { stat: 'totalSpeed', title: 'Top Speed', subtitle: 'Most Speed', color: '#2f6bff', x: -57, tilt: 0.16 },
      { stat: 'wins', title: 'Top Wins', subtitle: 'Most Wins', color: '#ff8a1f', x: -19, tilt: 0.05 },
      { stat: 'rebirths', title: 'Top Rebirths', subtitle: 'Most Rebirths', color: '#9b3bff', x: 19, tilt: -0.05 },
      { stat: 'level', title: 'Top Level', subtitle: 'Highest Level', color: '#ffc21f', x: 57, tilt: -0.16 },
    ]
    for (const board of boards) {
      const z = 112 - Math.abs(board.x) * 0.12
      layout.leaderboards.push({ ...board, world: 1, pos: [ox + board.x, 0, z], rotY: Math.PI + board.tilt })
      box(ox + board.x - 8.5, ox + board.x + 8.5, 0, 26, z - 1.5, z + 1.5, 'none', { visible: false, zone })
    }

    // The Bike Shop: every World 1 bike on one floor, cheapest first. Ride
    // onto a bike and press E to buy or equip it.
    const shopBikes = BIKES.filter((b) => b.shop === 'pad' || b.shop === 'wins').sort((a, b) => a.price - b.price)
    shopBikes.forEach((bike, i) => {
      const x = [-42, -58, -74][i % 3]
      const z = 76 - Math.floor(i / 3) * 16
      addBikeStand(layout, box, bike.id, ox + x, z, 'gallery', zone)
    })
    layout.signs.push({ kind: 'banner', text: '🚲 BIKE SHOP', color: '#35c95a', pos: [ox - 33, 15, 44], rotY: Math.PI / 2 })

    // Shops along the left; each opens towards the plaza (+X).
    addShop(layout, box, 'items', 'ITEM SHOP', '#a14dff', ox - 84, -8, zone)
    addPortal(layout, box, 2, 'WORLD 2', '#3cf56a', ox - 84, -34, zone)

    layout.mailbox = { pos: [ox - 38, 0, -8], world: 1 }
    box(ox - 39, ox - 37, 0, 4.5, -9, -7, 'none', { visible: false, zone })
    trigger(layout, 'mailbox', {}, ox - 44, ox - 32, -14, -2)

    layout.chest = { pos: [ox - 60, -0.25, -24], world: 1 }
    box(ox - 62.2, ox - 57.8, -0.25, 2.6, -25.6, -22.4, 'none', { visible: false, zone })
    trigger(layout, 'chest', {}, ox - 66, ox - 54, -30, -18, 6)

    for (const [aura, z] of [['unchained', -44], ['shadow', -26]]) {
      layout.auraStands.push({ aura, pos: [ox + 52, 0.5, z], world: 1 })
      box(ox + 47, ox + 57, -1, 0.5, z - 5, z + 5, 'standPad', { zone })
      trigger(layout, 'aura', { aura }, ox + 46.8, ox + 57.2, z - 5.2, z + 5.2, 7)
    }
  } else {
    buildTreadmills(layout, box, world, [44, 59], [12, 36, 60, 84], 67)
    layout.signs.push({ kind: 'title', text: 'Train Speed', color: '#c46bff', pos: [ox + 66.6, 14, 48], rotY: -Math.PI / 2, size: [30, 6] })
    layout.signs.push({ kind: 'worldTitle', text: 'WORLD 2', pos: [ox, 28, back - 6] })

    const w2Bikes = BIKES.filter((b) => b.shop === 'w2')
    w2Bikes.forEach((bike, i) => {
      const x = i % 2 === 0 ? -50 : -68
      const z = 84 - Math.floor(i / 2) * 16
      addBikeStand(layout, box, bike.id, ox + x, z, 'gallery', zone)
    })
    layout.signs.push({ kind: 'banner', text: '💎 WORLD 2 BIKES', color: '#9b5cff', pos: [ox - 41, 14, 68], rotY: Math.PI / 2 })

    addShop(layout, box, 'items', 'ITEM SHOP', '#a14dff', ox - 72, 14, zone)
    addPortal(layout, box, 1, 'WORLD 1', '#2fb5ff', ox - 72, -30, zone)
  }
}

function addShop(layout, box, id, title, color, x, z, zone) {
  layout.shops.push({ id, title, color, x, z, world: zone / 100 })
  box(x - 9, x + 3, -0.25, 11, z - 8, z + 8, 'none', { visible: false, zone })
  trigger(layout, 'shop', { id }, x + 3.5, x + 12, z - 7, z + 7, 9)
}

function addPortal(layout, box, to, title, color, x, z, zone) {
  layout.portals.push({ to, title, color, x, z, world: zone / 100 })
  box(x - 1, x + 1, 0, 14, z - 9.5, z - 6.5, 'none', { visible: false, zone })
  box(x - 1, x + 1, 0, 14, z + 6.5, z + 9.5, 'none', { visible: false, zone })
  trigger(layout, 'portal', { to }, x - 2, x + 3, z - 6, z + 6, 14)
}

function addBikeStand(layout, box, bikeId, x, z, style, zone) {
  layout.bikeStands.push({ bike: bikeId, x, z, style, world: zone / 100 })
  if (style === 'gallery') {
    // A round pedestal (drawn by the client); this keeps it solid to ride onto.
    box(x - 4, x + 4, -0.5, 0.7, z - 4, z + 4, 'none', { visible: false, zone })
  } else {
    box(x - 4.5, x + 4.5, -1, 0.5, z - 4.5, z + 4.5, 'standPad', { zone })
  }
  trigger(layout, 'bike', { bike: bikeId }, x - 5.2, x + 5.2, z - 5.2, z + 5.2, 7)
}

/** Treadmills: belts along Z, console at the -Z end, riders face the console. */
function buildTreadmills(layout, box, world, cols, rows, backX) {
  const ox = world.originX
  const zone = world.id * 100
  const pads = TRAIN_PADS.filter((p) => p.world === world.id)
  pads.forEach((pad, i) => {
    const cx = ox + cols[Math.floor(i / rows.length)]
    const cz = rows[i % rows.length]
    // Frame (steppable), the console that stops you riding off the front.
    box(cx - 6, cx + 6, -0.5, 0.9, cz - 10, cz + 10, 'trainFrame', { zone })
    box(cx - 5, cx + 5, 0.9, 1, cz - 9.4, cz + 9.4, `belt_${pad.id}`, { zone })
    box(cx - 6, cx + 6, 0.9, 4.2, cz - 11, cz - 9.6, 'trainConsole', { zone })
    layout.trainPads.push({ ...pad, center: [cx, cz], min: [cx - 5, 1, cz - 9.4], max: [cx + 5, 1, cz + 9.4] })
    layout.signs.push({ kind: 'trainLabel', padId: pad.id, pos: [cx, 8.2, cz - 10.4] })
  })
  const zMin = Math.min(...rows) - 14
  const zMax = Math.max(...rows) + 14
  box(ox + backX - 1, ox + backX + 3, -2, 10, zMin, zMax, 'checkerBlue', { zone })
}

/* ---------------------------------------------------------------------------
 * Courses
 * ------------------------------------------------------------------------- */

/**
 * The longest gap a rider with `totalSpeed` Speed clears by holding jump from
 * the very edge: every jump fires just before the top of the last one (the
 * controller's hold-to-jump rule), then the rider glides back down to plateau
 * height. Exact for the game's physics, so the server and client agree.
 */
export function gapReach(totalSpeed, rise = 0) {
  const { gravity: g, jumpVelocity: vj, maxMoveSpeed, maxFallSpeed } = PHYSICS
  const speed = Math.min(bikeSpeedFor(totalSpeed), maxMoveSpeed)
  const jumps = jumpsFor(levelForSpeed(totalSpeed))
  const fire = AUTO_JUMP_FIRE_SPEED
  const height = ((vj * vj - fire * fire) / (2 * g)) * (jumps - 1) + (vj * vj) / (2 * g)
  // Falling back down: free fall until terminal speed, then constant speed.
  const freeFall = (maxFallSpeed * maxFallSpeed) / (2 * g)
  // Down to the landing, `rise` above the take-off.
  const drop = Math.max(0, height - rise)
  const fall = drop <= freeFall ? Math.sqrt((2 * drop) / g) : maxFallSpeed / g + (drop - freeFall) / maxFallSpeed
  const time = ((vj - fire) / g) * (jumps - 1) + vj / g + fall
  return speed * time
}

/** While jump is held, the next jump fires when rising speed drops to this (see physics.js). */
export const AUTO_JUMP_FIRE_SPEED = 2.5

/**
 * Gap in front of a stage whose gate asks for `speed`: inside what that Speed
 * reaches, beyond what `1 - gates.tolerance` of it reaches. So the gate's Speed
 * clears it and riders clearly below always fall short.
 */
export function gapLengthFor(speed, rise = 0) {
  const short = gapReach(speed * (1 - BALANCE.gates.tolerance), rise)
  return Math.round(short + 0.6 * (gapReach(speed, rise) - short))
}

function buildCourse(layout, box, world, info) {
  const ox = world.originX
  const W = HALF_WIDTH
  const C = CORRIDOR_HALF
  const rng = mulberry32(20261012 + world.id * 977)
  const defs = [...world.stages, world.finish]
  let prevEnd = LOBBY_FRONT_Z
  let prevTop = COURSE_Y

  defs.forEach((def, i) => {
    const index = i + 1
    const isFinish = index > world.stages.length
    const gid = world.gidOffset + index
    const zone = world.id * 100 + index
    const theme = THEMES[def.theme]

    // Stage 1 is level with the lobby; every later stage is a small step up.
    const top = COURSE_Y + (index - 1) * STAGE_RISE
    const rise = top - prevTop
    const pitY = prevTop - PIT_DEPTH
    const bottom = pitY - 10
    const gap = gapLengthFor(def.speed, rise)
    const plateauLength = isFinish ? 70 : 40
    const zStart = prevEnd
    const wallZ = zStart - gap
    const plateauEnd = wallZ - plateauLength

    const stage = {
      world: world.id,
      index,
      gid,
      name: def.name,
      theme: def.theme,
      wins: def.wins,
      /** Total Speed the gate asks for. */
      speed: def.speed,
      isFinish,
      originX: ox,
      /** Height of the deadly pit floor around and in front of the island. */
      valleyY: pitY,
      hasPit: true,
      gap,
      /** Top of the island (or lobby) you jump from to reach this one. */
      prevTop,
      floorY: top,
      zStart,
      wallZ,
      plateauZ0: wallZ,
      plateauZ1: plateauEnd,
    }
    layout.stages.push(stage)
    info.stages.push(stage)

    // The deadly river under the whole segment: the gap and both sides of the island.
    box(ox - C, ox + C, pitY - 6, pitY, plateauEnd, zStart, `river_${theme.river}`, { zone })
    // The island: sides in the face material with a floor slab on top.
    box(ox - W, ox + W, pitY, top - 1, plateauEnd, wallZ, theme.face, { zone })
    box(ox - W, ox + W, top - 1, top, plateauEnd, wallZ, theme.top, { zone })

    cliffs(box, ox, bottom, top, plateauEnd, zStart, theme, zone)

    // "Spam jump" sign on the island's front face, and the floating title.
    layout.signs.push({
      kind: 'jumpWall',
      speed: def.speed,
      gap: true,
      pos: [ox, pitY + PIT_DEPTH / 2, wallZ + 0.06],
      width: Math.min(34, W * 2 - 6),
      zone,
      starter: index === 1,
    })
    layout.signs.push({ kind: 'stageTitle', text: def.name, speed: def.speed, theme: def.theme, pos: [ox, top + 16, wallZ - 6], zone })

    // Return (+wins, home) and 2x Wins pads right where you land.
    addWinPads(layout, box, stage, ox, top, wallZ - 11, zone)

    if (isFinish) {
      box(ox - C, ox + C, bottom, top + 60, plateauEnd - 4, plateauEnd, theme.wall, { zone })
      stage.trophy = [ox, top, plateauEnd + 18]
      const to = world.id === 1 ? 2 : 1
      layout.portals.push({ to, title: to === 2 ? 'WORLD 2' : 'WORLD 1', color: to === 2 ? '#3cf56a' : '#2fb5ff', x: ox, z: plateauEnd + 40, y: top, facing: 'z', world: world.id })
      trigger(layout, 'portal', { to }, ox - 6, ox + 6, plateauEnd + 38, plateauEnd + 42, top + 14)
      layout.triggers[layout.triggers.length - 1].min[1] = top - 1
    }
    addGapLasers(layout, stage, world, rng)

    layout.decor.push({ kind: 'stage', world: world.id, index, zone })
    prevEnd = plateauEnd
    prevTop = top
  })

  info.courseEndZ = prevEnd
}

/**
 * Invisible barriers at the cliff faces either side of the pit, so no number of
 * jumps carries anyone off the course. The cliffs themselves are client-only
 * scenery (see decor.js) built from CLIFF_TIERS.
 */
function cliffs(box, ox, bottom, top, z0, z1, theme, zone) {
  for (const side of [-1, 1]) {
    const x = (a) => ox + side * (CORRIDOR_HALF + a)
    box(x(0), x(3), bottom, top + 3000, z0, z1, 'none', { visible: false, zone })
  }
}

function addWinPads(layout, box, stage, ox, top, padZ, zone) {
  const pads = [
    { kind: 'return', x0: -26, x1: -10, mat: 'returnPad' },
    { kind: 'double', x0: 10, x1: 26, mat: 'doublePad' },
  ]
  for (const pad of pads) {
    box(ox + pad.x0, ox + pad.x1, top - 0.5, top + 0.3, padZ - 5, padZ + 5, pad.mat, { zone })
    layout.pads.push({
      stage: stage.gid,
      world: stage.world,
      kind: pad.kind,
      wins: stage.wins,
      min: [ox + pad.x0, top, padZ - 5],
      max: [ox + pad.x1, top + 0.3, padZ + 5],
    })
    layout.signs.push({ kind: 'padLabel', pad: pad.kind, wins: stage.wins, pos: [ox + (pad.x0 + pad.x1) / 2, top + 6, padZ], zone })
  }
}

/** The first stage whose gap has lasers (the gaps to stages 1-3 are clear). */
export const FIRST_LASER_STAGE = 4

/**
 * Lasers bobbing up and down across the gap in front of a stage, from
 * FIRST_LASER_STAGE on. The islands themselves stay clear.
 */
function addGapLasers(layout, stage, world, rng) {
  const { index, prevTop, zStart, gap } = stage
  if (index < FIRST_LASER_STAGE) return
  const jumps = jumpsFor(levelForSpeed(stage.speed))
  const w2 = world.id === 2
  const count = w2 ? 2 + Math.floor(index / 4) : index < 5 ? 1 : index < 8 ? 2 : 3
  const reach = Math.min(Math.max(jumps * JUMP_RISE * 0.45, 10), 45)
  for (let i = 0; i < count; i += 1) {
    layout.lasers.push({
      type: 'vertical',
      stage: stage.gid,
      color: THEMES[stage.theme].laser,
      originX: stage.originX,
      halfWidth: CORRIDOR_HALF,
      z: round(zStart - gap * ((i + 1) / (count + 1))),
      yMin: prevTop + 0.8,
      yMax: prevTop + reach,
      speed: 0.9 + index * 0.05 + (w2 ? 0.25 : 0),
      phase: rng() * Math.PI * 2,
    })
  }
}

const round = (v) => Math.round(v * 100) / 100

/* ---------------------------------------------------------------------------
 * Stage records: time from leaving the lobby to landing on a stage
 * ------------------------------------------------------------------------- */

/** Studs ridden from the lobby's edge to landing on `stage`. */
const recordDistance = (stage) => LOBBY_FRONT_Z - (stage.plateauZ0 - 1)

/** Par (seconds): reaching `stage` riding flat out at its gate's top speed. */
export const parTimeFor = (stage) => recordDistance(stage) / Math.min(bikeSpeedFor(stage.speed), PHYSICS.maxMoveSpeed)

/** 1-3 stars for reaching `stage` in `ms` (thresholds in config/balance.ts). */
export function starsFor(stage, ms) {
  const ratio = ms / 1000 / parTimeFor(stage)
  if (ratio <= BALANCE.records.threeStar) return 3
  return ratio <= BALANCE.records.twoStar ? 2 : 1
}

/** The quickest time that's physically possible (the server's sanity check). */
export const minRecordMs = (stage) => (recordDistance(stage) / PHYSICS.maxMoveSpeed) * 1000 * 0.9

/* ---------------------------------------------------------------------------
 * Queries shared by client physics and server validation
 * ------------------------------------------------------------------------- */

export const worldIdAt = (x) => (x > WORLDS[1].originX / 2 ? 2 : 1)

/** The stage whose valley or plateau contains (x, z), or null in a lobby. */
export function stageAt(layout, x, z) {
  const world = layout.worlds[worldIdAt(x) - 1]
  for (const stage of world.stages) {
    if (z <= stage.zStart && z >= stage.plateauZ1) return stage
  }
  return null
}

/** Falling below this height means you left the island. */
export const killHeightAt = () => OCEAN_Y + 0.5

/** True when a rider at (x, y, z) has dropped into the pit (a gap, or off an island's side). */
export function inHazardPit(layout, x, y, z) {
  const stage = stageAt(layout, x, z)
  return Boolean(stage?.hasPit) && y <= stage.valleyY + 0.6
}

/**
 * Where a rider is on the top progress bar, in [0, stages - 1]: node k-1 while on
 * stage k's plateau, part-way between nodes while crossing a valley.
 */
export function courseProgress(layout, x, z) {
  const world = layout.worlds[worldIdAt(x) - 1]
  const last = world.stages.length - 2
  const stage = stageAt(layout, x, z)
  if (!stage) return z < world.courseEndZ ? last : 0
  if (stage.isFinish) return last
  if (z <= stage.wallZ) return Math.min(last, stage.index - 1)
  const span = stage.zStart - stage.wallZ
  const t = span > 0 ? (stage.zStart - z) / span : 1
  return Math.max(0, Math.min(last, stage.index - 2 + t))
}

export function insideBox(b, x, y, z, margin = 0) {
  return (
    x >= b.min[0] - margin &&
    x <= b.max[0] + margin &&
    y >= b.min[1] - margin &&
    y <= b.max[1] + margin &&
    z >= b.min[2] - margin &&
    z <= b.max[2] + margin
  )
}

/** The treadmill belt under a rider standing at (x, y, z), if any. */
export function trainPadAt(layout, x, y, z) {
  for (const pad of layout.trainPads) {
    if (x < pad.min[0] || x > pad.max[0] || z < pad.min[2] || z > pad.max[2]) continue
    if (y >= pad.max[1] - 0.6 && y <= pad.max[1] + 6) return pad
  }
  return null
}

export function spawnFor(layout, worldId) {
  return layout.worlds[worldId - 1]?.spawn ?? layout.worlds[0].spawn
}
