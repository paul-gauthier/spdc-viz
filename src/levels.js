import { holeToWorld, localOffsetToWorld } from './simulation'

export const level1 = {
  board: {
    holesX: 10,
    holesY: 6,
    pitch: 1,
  },
  optics: [
    {
      id: 'laser',
      type: 'laser',
      hole: [0, 1],
      yaw: 0,
      beamExitOffset: [0.25, 0, 0],
    },
    {
      id: 'mirror1',
      type: 'mirror',
      hole: [5, 1],
      yaw: -3 * Math.PI / 4,
      label: 'Mirror',
    },
    {
      id: 'mirror2',
      type: 'mirror',
      hole: [3, 4],
      yaw: Math.PI / 4,
      label: 'Mirror',
    },
    {
      id: 'fiber',
      type: 'fiber',
      hole: [8, 4],
      yaw: 0,
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
}

function normalizeBeams(level) {
  if (Array.isArray(level.beams)) return level.beams
  if (level.beam) return [{ id: level.beam.id ?? 'beam1', ...level.beam }]
  return []
}

export function buildInitialOpticYaws(level) {
  return Object.fromEntries(level.optics.map((optic) => [optic.id, optic.yaw ?? 0]))
}

export function resolveLevel(level, opticYaws = {}) {
  const optics = level.optics.map((optic) => {
    const yaw = opticYaws[optic.id] ?? optic.yaw ?? 0
    const position = holeToWorld(level.board, optic.hole)
    const beamPosition = position.clone().add(localOffsetToWorld(optic.beamExitOffset, yaw))

    return {
      ...optic,
      yaw,
      position,
      renderPosition: position.toArray(),
      beamPosition,
    }
  })

  const opticsById = Object.fromEntries(optics.map((optic) => [optic.id, optic]))
  const beams = normalizeBeams(level)

  return { ...level, optics, opticsById, beams }
}
