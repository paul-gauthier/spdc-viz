import { FiberBody, LaserBody, LensBody, MirrorBody } from './optics'
import {
  computeFiberCoupling,
  FIBER_OPTIC_RADIUS,
  intersectRayWithFiberFace,
  intersectRayWithMirror,
  LASER_OPTIC_RADIUS,
  LENS_RADIUS,
  MIRROR_RADIUS,
  reflectDir,
} from './simulationCore'

export const OPTIC_TYPES = {
  laser: {
    defaults: {
      label: 'Laser',
      yaw: 0,
      beamExitOffset: [0.25, 0, 0],
    },
    render: {
      Body: LaserBody,
      opticRadius: LASER_OPTIC_RADIUS,
      getBodyProps: () => ({}),
    },
    interaction: {
      rotatable: false,
    },
    simulation: {
      isTraceElement: false,
      emitsBeam: true,
    },
  },
  mirror: {
    defaults: {
      label: 'Mirror',
    },
    render: {
      Body: MirrorBody,
      opticRadius: MIRROR_RADIUS,
      getBodyProps: () => ({}),
    },
    interaction: {
      rotatable: true,
    },
    simulation: {
      isTraceElement: true,
      intersect({ origin, direction, optic }) {
        return intersectRayWithMirror(origin, direction, optic.position, optic.yaw)
      },
      onHit({ hit, direction }) {
        return {
          kind: 'reflect',
          nextDirection: reflectDir(direction, hit.normal),
        }
      },
    },
  },
  lens: {
    defaults: {
      label: 'Lens',
    },
    render: {
      Body: LensBody,
      opticRadius: LENS_RADIUS,
      getBodyProps: () => ({}),
    },
    interaction: {
      rotatable: false,
    },
    simulation: {
      isTraceElement: false,
      emitsBeam: false,
    },
  },
  fiber: {
    defaults: {
      label: 'Fiber',
    },
    render: {
      Body: FiberBody,
      opticRadius: FIBER_OPTIC_RADIUS,
      getBodyProps: ({ coupling = 0 }) => ({ coupling }),
    },
    interaction: {
      rotatable: true,
      handleYawOffset: Math.PI,
    },
    simulation: {
      isTraceElement: true,
      intersect({ origin, direction, optic }) {
        return intersectRayWithFiberFace(origin, direction, optic.position, optic.yaw)
      },
      onHit({ hit, direction, optic }) {
        return {
          kind: 'terminate',
          couplingByOpticId: {
            [optic.id]: computeFiberCoupling(hit, direction),
          },
        }
      },
    },
  },
}

export function getOpticType(type) {
  const opticType = OPTIC_TYPES[type]

  if (!opticType) throw new Error(`Unknown optic type: ${type}`)

  return opticType
}

export function isTraceElement(optic) {
  return !!getOpticType(optic.type).simulation?.isTraceElement
}
