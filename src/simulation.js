import * as THREE from 'three'

export const POST_HEIGHT = 2
export const MIRROR_RADIUS = 0.5
export const LENS_RADIUS = 0.5
export const LASER_OPTIC_RADIUS = 0.25
export const FIBER_LENGTH = 1
export const FIBER_NEGATIVE_X_FACE_RADIUS = 0.25
export const FIBER_POSITIVE_X_FACE_RADIUS = 0.15
export const FIBER_OPTIC_RADIUS = Math.max(FIBER_NEGATIVE_X_FACE_RADIUS, FIBER_POSITIVE_X_FACE_RADIUS)
export const BEAM_TRACE_EPSILON = 1e-4
export const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function getBoardSize(board) {
  return {
    width: board.holesX * board.pitch,
    depth: board.holesY * board.pitch,
  }
}

export function holeToWorld(board, hole, y = POST_HEIGHT) {
  const [holeX, holeY] = hole
  return new THREE.Vector3(
    (holeX - (board.holesX - 1) / 2) * board.pitch,
    y,
    (holeY - (board.holesY - 1) / 2) * board.pitch,
  )
}

export function yawToDirection(yaw) {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize()
}

export function localOffsetToWorld(offset = [0, 0, 0], yaw = 0) {
  return new THREE.Vector3(...offset).applyAxisAngle(Y_AXIS, yaw)
}

export function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

export function reflectDir(incident, normal) {
  const d = incident.clone().normalize()
  const n = normal.clone().normalize()
  const dot = d.dot(n)
  return d.sub(n.multiplyScalar(2 * dot)).normalize()
}

export function mirrorNormal(yaw) {
  return yawToDirection(yaw)
}

export function intersectRayWithMirror(origin, dir, center, yaw) {
  const normal = mirrorNormal(yaw)
  const denom = dir.dot(normal)

  if (Math.abs(denom) < 1e-6) return null

  const t = new THREE.Vector3().subVectors(center, origin).dot(normal) / denom
  if (t <= 0) return null

  const point = origin.clone().add(dir.clone().multiplyScalar(t))
  if (point.distanceTo(center) > MIRROR_RADIUS) return null

  return { point, normal }
}

export function intersectRayWithFiberFace(origin, dir, center, yaw) {
  const axis = yawToDirection(yaw)
  const denom = dir.dot(axis)

  if (Math.abs(denom) < 1e-6) return null

  const faceConfigs = [
    { offset: -FIBER_LENGTH / 2, radius: FIBER_NEGATIVE_X_FACE_RADIUS, inwardAxis: axis.clone() },
    { offset: FIBER_LENGTH / 2, radius: FIBER_POSITIVE_X_FACE_RADIUS, inwardAxis: axis.clone().multiplyScalar(-1) },
  ]

  let closestHit = null
  let closestDistance = Infinity

  for (const { offset, radius, inwardAxis } of faceConfigs) {
    const faceCenter = center.clone().add(axis.clone().multiplyScalar(offset))
    const t = new THREE.Vector3().subVectors(faceCenter, origin).dot(axis) / denom
    if (t <= 0) continue

    const point = origin.clone().add(dir.clone().multiplyScalar(t))
    const radialOffset = new THREE.Vector3().subVectors(point, faceCenter)
    radialOffset.sub(axis.clone().multiplyScalar(radialOffset.dot(axis)))
    const radialDistance = radialOffset.length()

    if (radialDistance > radius) continue

    if (t < closestDistance) {
      closestHit = { point, faceRadius: radius, inwardAxis, radialDistance }
      closestDistance = t
    }
  }

  return closestHit
}

export function computeFiberCoupling(hit, incidentDir) {
  const radialRatio = hit.faceRadius > 0 ? hit.radialDistance / hit.faceRadius : 1
  const radialScore = clamp01(1 - radialRatio * radialRatio)
  const angularScore = Math.pow(
    clamp01(incidentDir.clone().normalize().dot(hit.inwardAxis.clone().normalize())),
    4,
  )

  return clamp01(radialScore * angularScore)
}

const INTERSECTORS = {
  mirror(rayOrigin, rayDirection, element) {
    const hit = intersectRayWithMirror(rayOrigin, rayDirection, element.position, element.yaw)
    return hit ? { ...hit, type: 'mirror' } : null
  },
  fiber(rayOrigin, rayDirection, element) {
    const hit = intersectRayWithFiberFace(rayOrigin, rayDirection, element.position, element.yaw)
    return hit ? { ...hit, type: 'fiber', id: element.id } : null
  },
}

export function traceBeam({ origin, direction, elements, tailLength = 8, maxBounces = 8 }) {
  const path = [origin.clone()]
  const couplingByOpticId = {}

  let rayOrigin = origin.clone()
  let rayDirection = direction.clone().normalize()

  for (let bounce = 0; bounce < maxBounces; bounce += 1) {
    let closestHit = null
    let closestDistance = Infinity

    for (const element of elements) {
      const intersect = INTERSECTORS[element.type]
      if (!intersect) continue

      const hit = intersect(rayOrigin, rayDirection, element)
      if (!hit) continue

      const distance = rayOrigin.distanceTo(hit.point)
      if (distance < closestDistance) {
        closestHit = hit
        closestDistance = distance
      }
    }

    if (!closestHit) break

    path.push(closestHit.point.clone())

    if (closestHit.type === 'fiber') {
      couplingByOpticId[closestHit.id] = computeFiberCoupling(closestHit, rayDirection)
      return { path, couplingByOpticId }
    }

    rayDirection = reflectDir(rayDirection, closestHit.normal)
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

    for (const [opticId, coupling] of Object.entries(result.couplingByOpticId)) {
      couplingByOpticId[opticId] = Math.max(couplingByOpticId[opticId] ?? 0, coupling)
    }
  }

  return { beams: tracedBeams, couplingByOpticId }
}
