import { getOpticType } from './opticRegistry'
import { holeToWorld, localOffsetToWorld } from './simulationCore'

export const level1 = {
  board: {
    holesX: 11,
    holesY: 5,
    pitch: 1,
  },
  optics: [
    {
      id: 'laser',
      type: 'laser',
      hole: [0, 2],
      yaw: 0,
      beamExitOffset: [0.25, 0, 0],
    },
    {
      id: 'spdc',
      type: 'spdc',
      hole: [5, 2],
      yaw: Math.atan2(-2, -5) + Math.PI,
      label: 'SPDC',
    },
    {
      id: 'signal',
      type: 'fiber',
      hole: [10, 3],
      yaw: Math.atan2(1, -5) + Math.PI,
    },
    {
      id: 'idler',
      type: 'fiber',
      hole: [10, 1],
      yaw: Math.atan2(-1, -5) + Math.PI,
    },
  ],
  beams: [
    {
      id: 'beam1',
      source: 'laser',
      maxBounces: 8,
      tailLength: 8,
    },
  ],
}

export const level2 = {
  board: {
    holesX: 11,
    holesY: 6,
    pitch: 1,
  },
  optics: [
    {
      id: 'laser',
      type: 'laser',
      hole: [4, 5],
      yaw: Math.PI,
      beamExitOffset: [0.25, 0, 0],
    },
    {
      id: 'spdc',
      type: 'spdc',
      hole: [5, 1],
      yaw: Math.atan2(-2, -5) + Math.PI,
      label: 'SPDC',
    },
    {
      id: 'mirror1',
      type: 'mirror',
      hole: [0, 1],
      yaw: -Math.PI/4,
      label: 'Mirror',
    },
    {
      id: 'mirror2',
      type: 'mirror',
      hole: [0, 5],
      yaw: Math.PI/4,
      label: 'Mirror',
    },
    {
      id: 'signal',
      type: 'fiber',
      hole: [10, 2],
      yaw: Math.atan2(1, -5) + Math.PI,
      label: 'Signal',
    },
    {
      id: 'idler',
      type: 'fiber',
      hole: [10, 0],
      yaw: Math.atan2(-1, -5) + Math.PI,
      label: 'Idler',
    },
  ],
  beams: [
    {
      id: 'beam1',
      source: 'laser',
      maxBounces: 8,
      tailLength: 8,
    },
  ],
}

export const LEVELS = {
  level1,
  level2,
}

function normalizeBeams(level) {
  if (Array.isArray(level.beams)) return level.beams
  if (level.beam) return [{ id: level.beam.id ?? 'beam1', ...level.beam }]
  return []
}

export function buildInitialOpticYaws(level) {
  return Object.fromEntries(
    level.optics.map((optic) => {
      const typeDefaults = getOpticType(optic.type).defaults ?? {}
      return [optic.id, optic.yaw ?? typeDefaults.yaw ?? 0]
    }),
  )
}

export function resolveLevel(level, opticYaws = {}) {
  const optics = level.optics.map((optic) => {
    const typeDefaults = getOpticType(optic.type).defaults ?? {}
    const yaw = opticYaws[optic.id] ?? optic.yaw ?? typeDefaults.yaw ?? 0
    const beamExitOffset = optic.beamExitOffset ?? typeDefaults.beamExitOffset ?? [0, 0, 0]
    const position = holeToWorld(level.board, optic.hole)
    const beamPosition = position.clone().add(localOffsetToWorld(beamExitOffset, yaw))

    return {
      ...optic,
      label: optic.label ?? typeDefaults.label,
      yaw,
      beamExitOffset,
      position,
      renderPosition: position.toArray(),
      beamPosition,
    }
  })

  const opticsById = Object.fromEntries(optics.map((optic) => [optic.id, optic]))
  const beams = normalizeBeams(level)

  return { ...level, optics, opticsById, beams }
}
