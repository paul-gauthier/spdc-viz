export * from './simulationCore'

import { BEAM_TRACE_EPSILON, getBoardSize, yawToDirection } from './simulationCore'
import { getOpticType } from './opticRegistry'

const DEFAULT_MAX_TRACED_BEAMS = 64

function clipRayToBoardBounds(origin, direction, board, padding = 1.5) {
  if (!board) return null

  const { width, depth } = getBoardSize(board)
  const minX = -width / 2 - padding
  const maxX = width / 2 + padding
  const minZ = -depth / 2 - padding
  const maxZ = depth / 2 + padding
  const candidates = []

  const pushCandidate = (t) => {
    if (!(t > 1e-6)) return

    const point = origin.clone().add(direction.clone().multiplyScalar(t))

    if (point.x < minX - 1e-6 || point.x > maxX + 1e-6) return
    if (point.z < minZ - 1e-6 || point.z > maxZ + 1e-6) return

    candidates.push({ t, point })
  }

  if (Math.abs(direction.x) >= 1e-6) {
    pushCandidate((minX - origin.x) / direction.x)
    pushCandidate((maxX - origin.x) / direction.x)
  }

  if (Math.abs(direction.z) >= 1e-6) {
    pushCandidate((minZ - origin.z) / direction.z)
    pushCandidate((maxZ - origin.z) / direction.z)
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => a.t - b.t)
  return candidates[0].point
}

function mergeOpticStateById(target, source = {}) {
  for (const [opticId, partialState] of Object.entries(source)) {
    target[opticId] = {
      ...(target[opticId] ?? {}),
      ...(partialState ?? {}),
    }
  }
}

function cloneOpticStateById(opticStateById = {}) {
  return Object.fromEntries(
    Object.entries(opticStateById).map(([opticId, opticState]) => [
      opticId,
      { ...(opticState ?? {}) },
    ]),
  )
}

function buildCouplingByOpticId(opticStateById = {}) {
  return Object.fromEntries(
    Object.entries(opticStateById)
      .filter(([, opticState]) => typeof opticState?.coupling === 'number')
      .map(([opticId, opticState]) => [opticId, opticState.coupling]),
  )
}

function normalizeSpawnedBeam(spawnedBeam, parentBeam, index, origin, direction) {
  const nextOrigin = (spawnedBeam.origin ?? origin).clone()
  const nextDirection = (spawnedBeam.direction ?? direction).clone().normalize()

  return {
    ...parentBeam,
    ...spawnedBeam,
    id: spawnedBeam.id ?? `${parentBeam.id}-spawn${index}`,
    origin: nextOrigin,
    direction: nextDirection,
  }
}

export function traceBeam({
  beam = { id: 'beam' },
  origin,
  direction,
  elements,
  board,
  tailLength = 8,
  maxBounces = 8,
  initialOpticStateById = {},
}) {
  const path = [origin.clone()]
  const opticStateById = cloneOpticStateById(initialOpticStateById)
  const effects = []
  const spawnedBeams = []

  let rayOrigin = origin.clone()
  let rayDirection = direction.clone().normalize()
  let spawnedBeamCount = 0

  for (let bounce = 0; bounce < maxBounces; bounce += 1) {
    let closestHit = null
    let closestElement = null
    let closestDistance = Infinity

    for (const element of elements) {
      const simulation = getOpticType(element.type).simulation
      const hit = simulation?.intersect?.({
        origin: rayOrigin,
        direction: rayDirection,
        optic: element,
      })
      if (!hit) continue

      const distance = rayOrigin.distanceTo(hit.point)
      if (distance < closestDistance) {
        closestHit = hit
        closestElement = element
        closestDistance = distance
      }
    }

    if (!closestHit || !closestElement) break

    path.push(closestHit.point.clone())

    const outcome = getOpticType(closestElement.type).simulation?.onHit?.({
      hit: closestHit,
      direction: rayDirection,
      optic: closestElement,
      beam,
      opticState: opticStateById[closestElement.id] ?? {},
      opticStateById,
    })

    mergeOpticStateById(opticStateById, outcome?.opticStateById)
    effects.push(...(outcome?.effects ?? []))

    for (const spawnedBeam of outcome?.spawnedBeams ?? []) {
      spawnedBeamCount += 1
      spawnedBeams.push(
        normalizeSpawnedBeam(spawnedBeam, beam, spawnedBeamCount, closestHit.point, rayDirection),
      )
    }

    if (outcome?.continueBeam === null) {
      return {
        path,
        opticStateById,
        couplingByOpticId: buildCouplingByOpticId(opticStateById),
        effects,
        spawnedBeams,
      }
    }

    if (!outcome?.continueBeam?.direction) break

    rayDirection = outcome.continueBeam.direction.clone().normalize()
    rayOrigin = (outcome.continueBeam.origin ?? closestHit.point)
      .clone()
      .add(rayDirection.clone().multiplyScalar(BEAM_TRACE_EPSILON))
  }

  const finalPoint =
    clipRayToBoardBounds(path[path.length - 1], rayDirection, board) ??
    path[path.length - 1].clone().add(rayDirection.clone().multiplyScalar(tailLength))

  path.push(finalPoint)
  return {
    path,
    opticStateById,
    couplingByOpticId: buildCouplingByOpticId(opticStateById),
    effects,
    spawnedBeams,
  }
}

export function traceAllBeams({
  board,
  beams = [],
  opticsById,
  elements,
  maxTracedBeams = DEFAULT_MAX_TRACED_BEAMS,
}) {
  const tracedBeams = []
  const opticStateById = {}
  const effects = []

  const beamQueue = beams
    .map((beam) => {
      const source = opticsById[beam.source]
      if (!source) return null

      return {
        ...beam,
        origin: source.beamPosition.clone(),
        direction: yawToDirection(source.yaw),
      }
    })
    .filter(Boolean)

  while (beamQueue.length > 0 && tracedBeams.length < maxTracedBeams) {
    const beam = beamQueue.shift()

    const result = traceBeam({
      beam,
      origin: beam.origin,
      direction: beam.direction,
      elements,
      board,
      tailLength: beam.tailLength,
      maxBounces: beam.maxBounces,
      initialOpticStateById: opticStateById,
    })

    tracedBeams.push({
      ...beam,
      path: result.path,
      couplingByOpticId: result.couplingByOpticId,
    })

    mergeOpticStateById(opticStateById, result.opticStateById)
    effects.push(...result.effects)
    beamQueue.push(...result.spawnedBeams)
  }

  return {
    beams: tracedBeams,
    opticStateById,
    couplingByOpticId: buildCouplingByOpticId(opticStateById),
    effects,
  }
}
