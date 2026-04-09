export * from './simulationCore'

import { BEAM_TRACE_EPSILON, yawToDirection } from './simulationCore'
import { getOpticType } from './opticRegistry'

function mergeCouplingByOpticId(target, source = {}) {
  for (const [opticId, coupling] of Object.entries(source)) {
    target[opticId] = Math.max(target[opticId] ?? 0, coupling)
  }
}

export function traceBeam({ origin, direction, elements, tailLength = 8, maxBounces = 8 }) {
  const path = [origin.clone()]
  const couplingByOpticId = {}

  let rayOrigin = origin.clone()
  let rayDirection = direction.clone().normalize()

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
    })

    mergeCouplingByOpticId(couplingByOpticId, outcome?.couplingByOpticId)

    if (outcome?.kind === 'terminate') {
      return { path, couplingByOpticId }
    }

    if (outcome?.kind !== 'reflect' || !outcome.nextDirection) break

    rayDirection = outcome.nextDirection.clone().normalize()
    rayOrigin = closestHit.point.clone().add(rayDirection.clone().multiplyScalar(BEAM_TRACE_EPSILON))
  }

  path.push(path[path.length - 1].clone().add(rayDirection.clone().multiplyScalar(tailLength)))
  return { path, couplingByOpticId }
}

export function traceAllBeams({ beams = [], opticsById, elements }) {
  const tracedBeams = []
  const couplingByOpticId = {}

  for (const beam of beams) {
    const source = opticsById[beam.source]
    if (!source) continue

    const result = traceBeam({
      origin: source.beamPosition,
      direction: yawToDirection(source.yaw),
      elements,
      tailLength: beam.tailLength,
      maxBounces: beam.maxBounces,
    })

    tracedBeams.push({
      ...beam,
      path: result.path,
      couplingByOpticId: result.couplingByOpticId,
    })

    mergeCouplingByOpticId(couplingByOpticId, result.couplingByOpticId)
  }

  return { beams: tracedBeams, couplingByOpticId }
}
