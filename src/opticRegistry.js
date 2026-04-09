import { FiberBody, LaserBody, LensBody, MirrorBody, SpdcBody } from './optics'
import {
  BEAM_TRACE_EPSILON,
  computeFiberCoupling,
  computeSpdcOpeningAngle,
  FIBER_OPTIC_RADIUS,
  intersectRayWithDisk,
  intersectRayWithFiberFace,
  intersectRayWithMirror,
  LASER_OPTIC_RADIUS,
  LENS_RADIUS,
  MIRROR_RADIUS,
  reflectDir,
  Y_AXIS,
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
      rotatable: true,
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
          continueBeam: {
            direction: reflectDir(direction, hit.normal),
          },
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
  spdc: {
    defaults: {
      label: 'SPDC Crystal',
      baseOpeningAngle: 0,
      openingAngleScale: 1,
      coneLength: 4,
      coneColor: '#ef4444',
      coneOpacity: 0.18,
      signalBaseColor: '#ef4444',
      signalFlowColor: '#fca5a5',
      idlerBaseColor: '#ef4444',
      idlerFlowColor: '#fca5a5',
    },
    render: {
      Body: SpdcBody,
      opticRadius: LENS_RADIUS,
      getBodyProps: () => ({}),
    },
    interaction: {
      rotatable: true,
    },
    simulation: {
      isTraceElement: true,
      intersect({ origin, direction, optic }) {
        return intersectRayWithDisk(origin, direction, optic.position, optic.yaw, LENS_RADIUS)
      },
      onHit({ hit, direction, optic, beam }) {
        const defaults = OPTIC_TYPES.spdc.defaults
        const axis = direction.clone().normalize()
        const openingAngle = computeSpdcOpeningAngle(axis, optic.yaw, {
          baseOpeningAngle: optic.baseOpeningAngle ?? defaults.baseOpeningAngle,
          openingAngleScale: optic.openingAngleScale ?? defaults.openingAngleScale,
        })
        const exitPoint = hit.point.clone().add(axis.clone().multiplyScalar(BEAM_TRACE_EPSILON * 4))

        if (openingAngle === null) {
          return {
            continueBeam: {
              origin: exitPoint,
              direction: axis,
            },
          }
        }

        return {
          continueBeam: {
            origin: exitPoint,
            direction: axis,
          },
          spawnedBeams: [
            {
              id: `${beam.id}-${optic.id}-signal`,
              origin: exitPoint,
              direction: axis.clone().applyAxisAngle(Y_AXIS, openingAngle),
              baseColor: optic.signalBaseColor ?? defaults.signalBaseColor,
              flowColor: optic.signalFlowColor ?? defaults.signalFlowColor,
            },
            {
              id: `${beam.id}-${optic.id}-idler`,
              origin: exitPoint,
              direction: axis.clone().applyAxisAngle(Y_AXIS, -openingAngle),
              baseColor: optic.idlerBaseColor ?? defaults.idlerBaseColor,
              flowColor: optic.idlerFlowColor ?? defaults.idlerFlowColor,
            },
          ],
          effects: [
            {
              type: 'spdcCone',
              id: `${beam.id}-${optic.id}-cone`,
              origin: exitPoint,
              axis,
              openingAngle,
              length: optic.coneLength ?? defaults.coneLength,
              color: optic.coneColor ?? defaults.coneColor,
              opacity: optic.coneOpacity ?? defaults.coneOpacity,
            },
          ],
        }
      },
    },
  },
  fiber: {
    defaults: {
      label: 'Fiber',
    },
    render: {
      Body: FiberBody,
      opticRadius: FIBER_OPTIC_RADIUS,
      getBodyProps: ({ opticState = {} }) => ({
        coupling: opticState.coupling ?? 0,
        couplingColor: opticState.couplingColor,
        couplingGlowColor: opticState.couplingGlowColor,
      }),
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
      onHit({ hit, direction, optic, opticState, beam }) {
        if (hit.surface !== 'input') {
          return {
            continueBeam: null,
          }
        }

        const nextCoupling = computeFiberCoupling(hit, direction)
        const currentCoupling = opticState?.coupling ?? 0

        if (nextCoupling <= currentCoupling) {
          return {
            continueBeam: null,
            opticStateById: {
              [optic.id]: {
                coupling: currentCoupling,
                couplingColor: opticState?.couplingColor,
                couplingGlowColor: opticState?.couplingGlowColor,
              },
            },
          }
        }

        return {
          continueBeam: null,
          opticStateById: {
            [optic.id]: {
              coupling: nextCoupling,
              couplingColor: beam.baseColor ?? '#2a6cff',
              couplingGlowColor: beam.baseColor ?? '#2a6cff',
            },
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
