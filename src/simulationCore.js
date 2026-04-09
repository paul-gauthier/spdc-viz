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

export function intersectRayWithDisk(origin, dir, center, yaw, radius) {
  const normal = yawToDirection(yaw)
  const denom = dir.dot(normal)

  if (Math.abs(denom) < 1e-6) return null

  const t = new THREE.Vector3().subVectors(center, origin).dot(normal) / denom
  if (t <= 0) return null

  const point = origin.clone().add(dir.clone().multiplyScalar(t))
  if (point.distanceTo(center) > radius) return null

  return { point, normal }
}

export function intersectRayWithMirror(origin, dir, center, yaw) {
  return intersectRayWithDisk(origin, dir, center, yaw, MIRROR_RADIUS)
}

export function angleBetweenDirectionAndOpticNormal(direction, yaw) {
  const normal = yawToDirection(yaw)
  const alignment = THREE.MathUtils.clamp(Math.abs(direction.clone().normalize().dot(normal)), 0, 1)
  return Math.acos(alignment)
}

export function computeSpdcOpeningAngle(direction, yaw, optic = {}) {
  const baseOpeningAngle = optic.baseOpeningAngle ?? 0
  const openingAngleScale = optic.openingAngleScale ?? 1
  const incidenceAngle = angleBetweenDirectionAndOpticNormal(direction, yaw)
  const halfDifferenceAngle = incidenceAngle * 0.5

  if (incidenceAngle >= Math.PI / 4) return null

  return THREE.MathUtils.clamp(
    baseOpeningAngle + halfDifferenceAngle * openingAngleScale,
    0,
    Math.PI / 2 - 1e-3,
  )
}

export function intersectRayWithFiberFace(origin, dir, center, yaw) {
  const axis = yawToDirection(yaw)
  const localOrigin = origin.clone().sub(center).applyAxisAngle(Y_AXIS, -yaw)
  const localDir = dir.clone().applyAxisAngle(Y_AXIS, -yaw)
  const halfLength = FIBER_LENGTH / 2
  const minX = -halfLength
  const maxX = halfLength
  const sideSlope = (FIBER_POSITIVE_X_FACE_RADIUS - FIBER_NEGATIVE_X_FACE_RADIUS) / FIBER_LENGTH
  const sideIntercept = (FIBER_NEGATIVE_X_FACE_RADIUS + FIBER_POSITIVE_X_FACE_RADIUS) / 2
  const candidates = []

  const pushCapHit = (capX, faceRadius, surface, inwardAxis) => {
    if (Math.abs(localDir.x) < 1e-6) return

    const t = (capX - localOrigin.x) / localDir.x
    if (t <= 0) return

    const localPoint = localOrigin.clone().add(localDir.clone().multiplyScalar(t))
    const radialDistance = Math.hypot(localPoint.y, localPoint.z)

    if (radialDistance > faceRadius) return

    candidates.push({
      t,
      point: origin.clone().add(dir.clone().multiplyScalar(t)),
      surface,
      faceRadius,
      inwardAxis,
      radialDistance,
    })
  }

  pushCapHit(minX, FIBER_NEGATIVE_X_FACE_RADIUS, 'input', axis.clone())
  pushCapHit(maxX, FIBER_POSITIVE_X_FACE_RADIUS, 'output', axis.clone().multiplyScalar(-1))

  const radialDirSq = localDir.y * localDir.y + localDir.z * localDir.z
  const radialOriginDotDir = localOrigin.y * localDir.y + localOrigin.z * localDir.z
  const radiusAtOrigin = sideSlope * localOrigin.x + sideIntercept
  const radiusSlope = sideSlope * localDir.x
  const a = radialDirSq - radiusSlope * radiusSlope
  const b = 2 * (radialOriginDotDir - radiusAtOrigin * radiusSlope)
  const c =
    localOrigin.y * localOrigin.y +
    localOrigin.z * localOrigin.z -
    radiusAtOrigin * radiusAtOrigin

  const sideTs = []

  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) >= 1e-6) sideTs.push(-c / b)
  } else {
    const discriminant = b * b - 4 * a * c

    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      sideTs.push((-b - root) / (2 * a), (-b + root) / (2 * a))
    }
  }

  for (const t of sideTs) {
    if (t <= 0) continue

    const localPoint = localOrigin.clone().add(localDir.clone().multiplyScalar(t))
    if (localPoint.x < minX - 1e-6 || localPoint.x > maxX + 1e-6) continue

    candidates.push({
      t,
      point: origin.clone().add(dir.clone().multiplyScalar(t)),
      surface: 'side',
    })
  }

  if (candidates.length === 0) return null

  candidates.sort((aHit, bHit) => aHit.t - bHit.t)

  const { t: _t, ...closestHit } = candidates[0]
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
