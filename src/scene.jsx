import React, { useEffect, useMemo, useRef, useState } from 'react'
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
      flowRef.current.material.dashOffset -= delta * 2
    }
  })

  const linePoints = useMemo(() => points.map((point) => [point.x, point.y, point.z]), [points])

  return (
    <group>
      <Line
        points={linePoints}
        color={baseColor}
        lineWidth={3}
        transparent
        opacity={0.35}
      />
      <Line
        ref={flowRef}
        points={linePoints}
        color={flowColor}
        lineWidth={2}
        transparent
        opacity={0.95}
        dashed
        dashScale={12}
        dashSize={0.6}
        gapSize={0.35}
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

function Fit2DCamera({ board, enabled }) {
  const { camera, size } = useThree()

  useEffect(() => {
    if (!enabled || !camera.isOrthographicCamera) return

    const { width, depth } = getBoardSize(board)
    camera.zoom = Math.min(size.width / width, size.height / depth)
    camera.updateProjectionMatrix()
  }, [board, camera, enabled, size.height, size.width])

  return null
}

function Fit3DCamera({ board, enabled, controlsRef }) {
  const { camera, size } = useThree()

  useEffect(() => {
    if (!enabled || !camera.isPerspectiveCamera || size.width === 0 || size.height === 0) return

    const { width, depth } = getBoardSize(board)
    const target = new THREE.Vector3(0, POST_HEIGHT / 2, 0)
    const viewDirection = new THREE.Vector3(0, 0.72, 0.9).normalize()
    const forward = viewDirection.clone().multiplyScalar(-1)
    const worldUp = new THREE.Vector3(0, 1, 0)
    const right = forward.clone().cross(worldUp).normalize()
    const up = right.clone().cross(forward).normalize()
    const halfExtents = new THREE.Vector3(
      width / 2 + board.pitch,
      POST_HEIGHT / 2 + board.pitch * 1.5,
      depth / 2 + board.pitch,
    )

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
    const distance = (Math.max(fitHeightDistance, fitWidthDistance) + projectedHalfDepth) * 1.05
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
  }, [board, camera, controlsRef, enabled, size.height, size.width])

  return null
}

function Optic({ optic, coupling = 0, onOpticYawChange, onDragStart, onDragEnd }) {
  const opticType = getOpticType(optic.type)
  const Body = opticType.render.Body
  const bodyProps = opticType.render.getBodyProps?.({ optic, coupling }) ?? {}
  const rotatable = !!opticType.interaction?.rotatable

  return (
    <MountedOptic
      position={optic.renderPosition}
      yaw={optic.yaw}
      label={optic.label ?? opticType.defaults?.label ?? optic.id}
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

export function OpticalScene({ is2D, level, opticYaws, onOpticYawChange }) {
  const [isDragging, setIsDragging] = useState(false)
  const controlsRef = useRef(null)

  const resolvedLevel = useMemo(() => resolveLevel(level, opticYaws), [level, opticYaws])
  const { board, optics, opticsById, beams } = resolvedLevel

  const beamResult = useMemo(() => {
    const elements = optics.filter(isTraceElement)

    return traceAllBeams({
      beams,
      opticsById,
      elements,
    })
  }, [beams, optics, opticsById])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="city" />

      <Fit2DCamera board={board} enabled={is2D} />
      <Fit3DCamera board={board} enabled={!is2D} controlsRef={controlsRef} />
      <Table board={board} />
      <BreadboardHoles board={board} />

      {optics.map((optic) => (
        <Optic
          key={optic.id}
          optic={optic}
          coupling={beamResult.couplingByOpticId[optic.id] ?? 0}
          onOpticYawChange={onOpticYawChange}
          onDragStart={() => setIsDragging(true)}
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

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isDragging}
        enableRotate={!is2D}
        enableZoom={!is2D}
        target={[0, POST_HEIGHT / 2, 0]}
        enablePan
        minDistance={4}
        maxDistance={14}
        minZoom={20}
        maxZoom={200}
        minPolarAngle={is2D ? 0 : 0.15}
        maxPolarAngle={is2D ? 0 : Math.PI / 2.05}
      />
    </>
  )
}
