import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Line, OrbitControls } from '@react-three/drei'
import { resolveLevel } from './levels'
import { getOpticType, isTraceElement } from './opticRegistry'
import { MountedOptic } from './optics'
import { getBoardSize, holeToWorld, POST_HEIGHT } from './simulationCore'
import { traceAllBeams } from './simulation'

export function Beam({ points, baseColor = '#2a6cff', flowColor = '#80b3ff' }) {
  const flowRef = useRef()

  useFrame((_state, delta) => {
    if (flowRef.current?.material) {
      flowRef.current.material.dashOffset -= delta * 5
    }
  })

  const linePoints = useMemo(() => points.map((point) => [point.x, point.y, point.z]), [points])

  return (
    <group>
      <Line
        points={linePoints}
        color={baseColor}
        lineWidth={6}
        transparent
        opacity={0.35}
        depthWrite={false}
        renderOrder={10}
      />
      <Line
        ref={flowRef}
        points={linePoints}
        color={flowColor}
        lineWidth={4}
        transparent
        opacity={0.95}
        dashed
        dashScale={8}
        dashSize={1.6}
        gapSize={0.2}
        depthWrite={false}
        renderOrder={11}
      />
    </group>
  )
}

export function Table({ board }) {
  const { width, depth } = getBoardSize(board)

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color="#2a2a2a" metalness={0.2} roughness={0.8} />
    </mesh>
  )
}

export function BreadboardHoles({ board }) {
  const dots = []
  const innerRadius = board.pitch * 0.075
  const outerRadius = board.pitch * 0.125

  for (let holeX = 0; holeX < board.holesX; holeX += 1)
    for (let holeY = 0; holeY < board.holesY; holeY += 1) {
      const position = holeToWorld(board, [holeX, holeY], 0.001)
      dots.push(
        <mesh
          key={`${holeX}-${holeY}`}
          position={[position.x, position.y, position.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[innerRadius, outerRadius, 16]} />
          <meshBasicMaterial color="#444" />
        </mesh>,
      )
    }

  return <group>{dots}</group>
}

function getSpdcConeLength(effect, board) {
  const extension = 1.5

  if (!board) return extension

  const direction = effect.axis.clone().normalize()
  const { width, depth } = getBoardSize(board)
  const minX = -width / 2
  const maxX = width / 2
  const minZ = -depth / 2
  const maxZ = depth / 2
  const originX = effect.origin.x
  const originZ = effect.origin.z
  const candidates = []

  const pushCandidate = (distance) => {
    if (!(distance > 0)) return

    const x = originX + direction.x * distance
    const z = originZ + direction.z * distance

    if (x < minX - 1e-6 || x > maxX + 1e-6) return
    if (z < minZ - 1e-6 || z > maxZ + 1e-6) return

    candidates.push(distance)
  }

  if (Math.abs(direction.x) >= 1e-6) {
    pushCandidate((minX - originX) / direction.x)
    pushCandidate((maxX - originX) / direction.x)
  }

  if (Math.abs(direction.z) >= 1e-6) {
    pushCandidate((minZ - originZ) / direction.z)
    pushCandidate((maxZ - originZ) / direction.z)
  }

  const boardExitDistance = candidates.length > 0 ? Math.min(...candidates) : 0

  return boardExitDistance + extension
}

function SpdcConeEffect({ effect, board }) {
  const { axis, color = '#ef4444', openingAngle = 0, opacity = 0.18, origin } = effect
  const length = getSpdcConeLength(effect, board)
  const radius = length * Math.tan(openingAngle)

  const { position, quaternion } = useMemo(() => {
    const direction = axis.clone().normalize()

    return {
      position: origin.clone().add(direction.clone().multiplyScalar(length / 2)),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
    }
  }, [axis, length, origin])

  if (!(length > 0) || !(radius > 0)) return null

  const fillOpacity = Math.max(opacity, 0.14)
  const rimOpacity = Math.min(0.95, fillOpacity + 0.6)
  const capOpacity = Math.min(0.22, fillOpacity * 0.7 + 0.04)
  const rimInnerRadius = Math.max(0, radius - Math.min(0.05, Math.max(radius * 0.12, 0.015)))

  return (
    <group position={[position.x, position.y, position.z]} quaternion={quaternion}>
      <mesh renderOrder={12}>
        <cylinderGeometry args={[radius, 0, length, 48, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={fillOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[0, length / 2, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={13}>
        <ringGeometry args={[rimInnerRadius, radius, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={rimOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[0, length / 2, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={12}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={capOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function Fit2DCamera({ board, enabled, controlsRef, topInsetPx = 0 }) {
  const { camera, size } = useThree()

  useEffect(() => {
    if (!enabled || !camera.isOrthographicCamera || size.width === 0 || size.height === 0) return

    const { width, depth } = getBoardSize(board)
    const margin = board.pitch * 0.75
    const paddedWidth = width + margin * 2
    const paddedDepth = depth + margin * 2
    const safeHeight = Math.max(1, size.height - topInsetPx)

    camera.zoom = Math.min(size.width / paddedWidth, safeHeight / paddedDepth)

    const verticalOffset = topInsetPx > 0 ? topInsetPx / (2 * camera.zoom) : 0
    const targetZ = -verticalOffset

    camera.position.z = targetZ
    camera.updateProjectionMatrix()

    if (controlsRef.current) {
      controlsRef.current.target.set(0, POST_HEIGHT / 2, targetZ)
      controlsRef.current.update()
    }
  }, [board, camera, controlsRef, enabled, size.height, size.width, topInsetPx])

  return null
}

function Fit3DCamera({ board, enabled, controlsRef, savedView, sceneBounds }) {
  const { camera, size } = useThree()

  useEffect(() => {
    if (!enabled || !camera.isPerspectiveCamera || size.width === 0 || size.height === 0) return

    if (savedView?.position && savedView?.target) {
      camera.position.fromArray(savedView.position)
      camera.near = 0.1
      camera.updateProjectionMatrix()

      if (controlsRef.current) {
        controlsRef.current.target.fromArray(savedView.target)
        controlsRef.current.update()
        return
      }

      camera.lookAt(new THREE.Vector3().fromArray(savedView.target))
      return
    }

    let target
    let halfExtents

    if (sceneBounds && !sceneBounds.isEmpty()) {
      target = sceneBounds.getCenter(new THREE.Vector3())
      halfExtents = sceneBounds.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    } else {
      const { width, depth } = getBoardSize(board)
      target = new THREE.Vector3(0, POST_HEIGHT / 2, 0)
      halfExtents = new THREE.Vector3(width / 2, POST_HEIGHT / 2, depth / 2)
    }

    const viewDirection = new THREE.Vector3(0, 0.72, 0.9).normalize()
    const forward = viewDirection.clone().multiplyScalar(-1)
    const worldUp = new THREE.Vector3(0, 1, 0)
    const right = forward.clone().cross(worldUp).normalize()
    const up = right.clone().cross(forward).normalize()

    const projectedHalfWidth =
      halfExtents.x * Math.abs(right.x) +
      halfExtents.y * Math.abs(right.y) +
      halfExtents.z * Math.abs(right.z)
    const projectedHalfHeight =
      halfExtents.x * Math.abs(up.x) +
      halfExtents.y * Math.abs(up.y) +
      halfExtents.z * Math.abs(up.z)
    const projectedHalfDepth =
      halfExtents.x * Math.abs(forward.x) +
      halfExtents.y * Math.abs(forward.y) +
      halfExtents.z * Math.abs(forward.z)

    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (size.width / size.height))
    const fitHeightDistance = projectedHalfHeight / Math.tan(verticalFov / 2)
    const fitWidthDistance = projectedHalfWidth / Math.tan(horizontalFov / 2)
    const distance = (Math.max(fitHeightDistance, fitWidthDistance) + projectedHalfDepth) * 1.1
    const position = target.clone().add(viewDirection.multiplyScalar(distance))

    camera.position.copy(position)
    camera.near = 0.1
    camera.far = Math.max(100, distance + projectedHalfDepth + 20)
    camera.updateProjectionMatrix()

    if (controlsRef.current) {
      controlsRef.current.target.copy(target)
      controlsRef.current.update()
      return
    }

    camera.lookAt(target)
  }, [board, camera, controlsRef, enabled, savedView, sceneBounds, size.height, size.width])

  return null
}

function Optic({ is2D, optic, opticState = {}, onOpticYawChange, onDragStart, onDragEnd }) {
  const opticType = getOpticType(optic.type)
  const Body = opticType.render.Body
  const bodyProps = opticType.render.getBodyProps?.({ optic, opticState }) ?? {}
  const rotatable = !!opticType.interaction?.rotatable
  const handleYawOffset = optic.handleYawOffset ?? opticType.interaction?.handleYawOffset ?? 0
  const baseLabel = optic.label ?? opticType.defaults?.label ?? optic.id

  return (
    <MountedOptic
      position={optic.renderPosition}
      yaw={optic.yaw}
      handleYawOffset={handleYawOffset}
      label={baseLabel}
      is2D={is2D}
      opticRadius={opticType.render.opticRadius}
      rotatable={rotatable}
      onYawChange={rotatable ? (yaw) => onOpticYawChange(optic.id, yaw) : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <Body {...bodyProps} />
    </MountedOptic>
  )
}

export function OpticalScene({
  is2D,
  level,
  opticYaws,
  onOpticYawChange,
  hasUserInteracted3D,
  onFirst3DInteraction,
  saved3DView,
  onSave3DView,
  topInsetPx = 0,
  onFiberMetersChange,
}) {
  const [isDragging, setIsDragging] = useState(false)
  const controlsRef = useRef(null)
  const camera = useThree((state) => state.camera)

  const saveCurrent3DView = useCallback(() => {
    if (is2D || !camera.isPerspectiveCamera) return

    onSave3DView?.({
      position: camera.position.toArray(),
      target: controlsRef.current?.target?.toArray?.() ?? [0, POST_HEIGHT / 2, 0],
    })
  }, [camera, is2D, onSave3DView])

  useEffect(() => {
    return () => {
      if (!is2D) saveCurrent3DView()
    }
  }, [is2D, saveCurrent3DView])

  const resolvedLevel = useMemo(() => resolveLevel(level, opticYaws), [level, opticYaws])
  const { board, optics, opticsById, beams } = resolvedLevel

  const beamResult = useMemo(() => {
    const elements = optics.filter(isTraceElement)

    return traceAllBeams({
      board,
      beams,
      opticsById,
      elements,
    })
  }, [beams, optics, opticsById])

  const fiberMeters = useMemo(
    () =>
      optics
        .filter((optic) => optic.type === 'fiber')
        .map((optic) => {
          const opticState = beamResult.opticStateById[optic.id] ?? {}

          return {
            id: optic.id,
            label: optic.label ?? optic.id,
            coupling: opticState.coupling ?? 0,
            color: opticState.couplingColor ?? '#38bdf8',
          }
        }),
    [beamResult.opticStateById, optics],
  )

  useEffect(() => {
    onFiberMetersChange?.(fiberMeters)
  }, [fiberMeters, onFiberMetersChange])

  const sceneBounds = useMemo(() => {
    const bounds = new THREE.Box3()

    optics.forEach((optic) => {
      const opticType = getOpticType(optic.type)
      const fitRadius = Math.max(opticType.render.opticRadius, opticType.interaction?.rotatable ? 0.65 : 0)

      bounds.expandByPoint(new THREE.Vector3(optic.position.x - fitRadius, 0, optic.position.z - fitRadius))
      bounds.expandByPoint(
        new THREE.Vector3(
          optic.position.x + fitRadius,
          POST_HEIGHT + opticType.render.opticRadius,
          optic.position.z + fitRadius,
        ),
      )
    })


    beamResult.effects
      .filter((effect) => effect.type === 'spdcCone')
      .forEach((effect) => {
        const direction = effect.axis.clone().normalize()
        const length = getSpdcConeLength(effect, board)
        const end = effect.origin.clone().add(direction.multiplyScalar(length))
        const radius = length * Math.tan(effect.openingAngle ?? 0)

        bounds.expandByPoint(effect.origin)
        bounds.expandByPoint(new THREE.Vector3(end.x - radius, end.y - radius, end.z - radius))
        bounds.expandByPoint(new THREE.Vector3(end.x + radius, end.y + radius, end.z + radius))
      })

    if (bounds.isEmpty()) {
      const { width, depth } = getBoardSize(board)
      bounds.setFromCenterAndSize(
        new THREE.Vector3(0, POST_HEIGHT / 2, 0),
        new THREE.Vector3(width, POST_HEIGHT, depth),
      )
    }

    bounds.expandByScalar(board.pitch * 0.35)

    return bounds
  }, [beamResult.effects, board, optics])

  const distanceLimits = useMemo(() => {
    const sphere = sceneBounds.getBoundingSphere(new THREE.Sphere())

    return {
      minDistance: Math.max(4, sphere.radius * 0.8),
      maxDistance: Math.max(30, sphere.radius * 6),
    }
  }, [sceneBounds])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="city" />

      <Fit2DCamera board={board} enabled={is2D} controlsRef={controlsRef} topInsetPx={topInsetPx} />
      <Fit3DCamera
        board={board}
        enabled={!is2D}
        controlsRef={controlsRef}
        savedView={saved3DView}
        sceneBounds={sceneBounds}
      />
      <Table board={board} />
      <BreadboardHoles board={board} />

      {optics.map((optic) => (
        <Optic
          key={optic.id}
          is2D={is2D}
          optic={optic}
          opticState={beamResult.opticStateById[optic.id] ?? {}}
          onOpticYawChange={onOpticYawChange}
          onDragStart={() => {
            onFirst3DInteraction?.()
            setIsDragging(true)
          }}
          onDragEnd={() => setIsDragging(false)}
        />
      ))}

      {beamResult.beams.map((beam) => (
        <Beam
          key={beam.id}
          points={beam.path}
          baseColor={beam.baseColor}
          flowColor={beam.flowColor}
        />
      ))}

      {!is2D
        ? beamResult.effects
            .filter((effect) => effect.type === 'spdcCone')
            .map((effect, index) => (
              <SpdcConeEffect key={`${effect.id ?? 'spdc-cone'}-${index}`} effect={effect} board={board} />
            ))
        : null}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        autoRotate={!is2D && !hasUserInteracted3D}
        autoRotateSpeed={-0.75}
        enabled={!isDragging}
        onStart={() => {
          if (!is2D) onFirst3DInteraction?.()
        }}
        onEnd={saveCurrent3DView}
        enableRotate={!is2D}
        enableZoom={!is2D}
        target={[0, POST_HEIGHT / 2, 0]}
        enablePan
        minDistance={distanceLimits.minDistance}
        maxDistance={distanceLimits.maxDistance}
        minZoom={20}
        maxZoom={200}
        minPolarAngle={is2D ? 0 : 0.15}
        maxPolarAngle={is2D ? 0 : Math.PI / 2.05}
      />
    </>
  )
}
