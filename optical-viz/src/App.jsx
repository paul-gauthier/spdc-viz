import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line, Environment } from '@react-three/drei'


const POST_HEIGHT = 2
const MIRROR_RADIUS = 0.5
const FIBER_LENGTH = 1
const FIBER_NEGATIVE_X_FACE_RADIUS = 0.25
const FIBER_POSITIVE_X_FACE_RADIUS = 0.15
const BEAM_TRACE_EPSILON = 1e-4
const Y_AXIS = new THREE.Vector3(0, 1, 0)

const DEFAULT_LEVEL = {
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
  beam: {
    source: 'laser',
    maxBounces: 8,
    tailLength: 8,
  },
}

function getBoardSize(board) {
  return {
    width: board.holesX * board.pitch,
    depth: board.holesY * board.pitch,
  }
}

function holeToWorld(board, hole, y = POST_HEIGHT) {
  const [holeX, holeY] = hole
  return new THREE.Vector3(
    (holeX - (board.holesX - 1) / 2) * board.pitch,
    y,
    (holeY - (board.holesY - 1) / 2) * board.pitch,
  )
}

function yawToDirection(yaw) {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize()
}

function localOffsetToWorld(offset = [0, 0, 0], yaw = 0) {
  return new THREE.Vector3(...offset).applyAxisAngle(Y_AXIS, yaw)
}

function resolveLevel(level, opticYaws = {}) {
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

  return { ...level, optics, opticsById }
}

function buildInitialOpticYaws(level) {
  return Object.fromEntries(level.optics.map((optic) => [optic.id, optic.yaw ?? 0]))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function reflectDir(incident, normal) {
  const d = incident.clone().normalize()
  const n = normal.clone().normalize()
  const dot = d.dot(n)
  return d.sub(n.multiplyScalar(2 * dot)).normalize()
}

function mirrorNormal(yaw) {
  return yawToDirection(yaw)
}

function intersectRayWithMirror(origin, dir, center, yaw) {
  const normal = mirrorNormal(yaw)
  const denom = dir.dot(normal)

  if (Math.abs(denom) < 1e-6) return null

  const t = new THREE.Vector3().subVectors(center, origin).dot(normal) / denom
  if (t <= 0) return null

  const point = origin.clone().add(dir.clone().multiplyScalar(t))
  if (point.distanceTo(center) > MIRROR_RADIUS) return null

  return { point, normal }
}

function intersectRayWithFiberFace(origin, dir, center, yaw) {
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

function computeFiberCoupling(hit, incidentDir) {
  const radialRatio = hit.faceRadius > 0 ? hit.radialDistance / hit.faceRadius : 1
  const radialScore = clamp01(1 - radialRatio * radialRatio)
  const angularScore = Math.pow(
    clamp01(incidentDir.clone().normalize().dot(hit.inwardAxis.clone().normalize())),
    4,
  )

  return clamp01(radialScore * angularScore)
}

function computeBeamPath({ origin, direction, elements, tailLength = 8, maxBounces = 8 }) {
  const path = [origin.clone()]
  const couplingByOpticId = {}

  let rayOrigin = origin.clone()
  let rayDirection = direction.clone().normalize()

  for (let bounce = 0; bounce < maxBounces; bounce += 1) {
    let closestHit = null
    let closestDistance = Infinity

    for (const element of elements) {
      let hit = null

      if (element.type === 'mirror') {
        const mirrorHit = intersectRayWithMirror(rayOrigin, rayDirection, element.position, element.yaw)
        if (mirrorHit) hit = { ...mirrorHit, type: 'mirror' }
      } else if (element.type === 'fiber') {
        const fiberHit = intersectRayWithFiberFace(rayOrigin, rayDirection, element.position, element.yaw)
        if (fiberHit) hit = { ...fiberHit, type: 'fiber', id: element.id }
      }

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

/* ───── small shared components ───── */

function Label({ children, position }) {
  return (
    <Html
      position={position}
      occlude
      distanceFactor={10}
      style={{
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid #ddd',
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: 'nowrap',
          transform: 'translate(10px, -110%)',
          pointerEvents: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        {children}
      </div>
    </Html>
  )
}

function Table({ board }) {
  const { width, depth } = getBoardSize(board)

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color="#2a2a2a" metalness={0.2} roughness={0.8} />
    </mesh>
  )
}

function BreadboardHoles({ board }) {
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

function Laser({ position, yaw = 0 }) {
  return (
    <OpticMount
      position={position}
      yaw={yaw}
      label="Laser"
      geometryArgs={[0.15, 0.25, 1, 32]}
      opticMaterial={<meshStandardMaterial color="#666" metalness={0.6} roughness={0.4} />}
    />
  )
}

function OpticMount({ position, yaw = 0, opticMaterial, label, geometryArgs = [0.5, 0.5, 0.05, 32], children }) {
  const opticRadius = Math.max(geometryArgs[0], geometryArgs[1])
  const postHeight = POST_HEIGHT - opticRadius

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={geometryArgs} />
        {opticMaterial}
      </mesh>
      {children}
      <mesh position={[0, -(POST_HEIGHT + opticRadius) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, postHeight, 32]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.18} />
      </mesh>
      <Label position={[0.18, 0.32, 0.18]}>{label}</Label>
    </group>
  )
}

function Lens({ position, yaw = 0 }) {
  return (
    <OpticMount
      position={position}
      yaw={yaw}
      label="Lens"
      opticMaterial={
        <meshStandardMaterial color="#88bbff" transparent opacity={0.45} metalness={0.1} roughness={0.05} />
      }
    />
  )
}

function MirrorBody() {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[MIRROR_RADIUS, MIRROR_RADIUS, 0.05, 32]} />
      <meshStandardMaterial attach="material-0" color="#888" metalness={0.8} roughness={0.3} />
      <meshStandardMaterial
        attach="material-1"
        color="#f0f2f5"
        metalness={1}
        roughness={0.02}
        envMapIntensity={3}
      />
      <meshStandardMaterial
        attach="material-2"
        color="#f0f2f5"
        metalness={1}
        roughness={0.02}
        envMapIntensity={3}
      />
    </mesh>
  )
}

function FiberFill({ power }) {
  const fill = clamp01(power)

  if (fill <= 0) return null

  const shellOffset = 0.006
  const fillLength = FIBER_LENGTH * fill
  const endRadius = THREE.MathUtils.lerp(
    FIBER_NEGATIVE_X_FACE_RADIUS + shellOffset,
    FIBER_POSITIVE_X_FACE_RADIUS + shellOffset,
    fill,
  )
  const xCenter = -FIBER_LENGTH / 2 + fillLength / 2

  return (
    <mesh position={[xCenter, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry
        args={[FIBER_NEGATIVE_X_FACE_RADIUS + shellOffset, endRadius, fillLength, 32]}
      />
      <meshStandardMaterial
        color="#38bdf8"
        emissive="#0ea5e9"
        emissiveIntensity={0.4 + fill * 1.2}
        transparent
        opacity={0.85}
      />
    </mesh>
  )
}

function FiberBody({ coupling = 0 }) {
  const power = clamp01(coupling)

  return (
    <>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[FIBER_NEGATIVE_X_FACE_RADIUS, FIBER_POSITIVE_X_FACE_RADIUS, FIBER_LENGTH, 32]} />
        <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
      </mesh>
      <FiberFill power={power} />
    </>
  )
}

/* ───── interactive mirror ───── */

function RotatableOpticMount({
  position,
  yaw,
  onYawChange,
  name,
  onDragStart,
  onDragEnd,
  opticRadius = MIRROR_RADIUS,
  children,
}) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)

  const getAngleFromRay = useCallback(
    (ray) => {
      const hit = new THREE.Vector3()
      const dragY = position[1] - POST_HEIGHT / 2
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragY)
      if (!ray.intersectPlane(plane, hit)) return null
      return Math.atan2(hit.z - position[2], hit.x - position[0])
    },
    [position],
  )

  const handlePointerDown = useCallback(
    (e) => {
      const startPointerAngle = getAngleFromRay(e.ray)
      if (startPointerAngle === null) return
      e.sourceEvent?.preventDefault?.()
      e.stopPropagation()
      e.target.setPointerCapture(e.pointerId)
      setDragging(true)
      dragRef.current = { startPointerAngle, startYaw: yaw }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'
      document.body.style.webkitTouchCallout = 'none'
      onDragStart?.()
    },
    [getAngleFromRay, onDragStart, yaw],
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!dragRef.current) return
      const pointerAngle = getAngleFromRay(e.ray)
      if (pointerAngle === null) return
      e.sourceEvent?.preventDefault?.()
      e.stopPropagation()
      const delta = pointerAngle - dragRef.current.startPointerAngle
      onYawChange(dragRef.current.startYaw - delta)
    },
    [getAngleFromRay, onYawChange],
  )

  const endDrag = useCallback(
    (e) => {
      if (!dragRef.current && !dragging) return
      e?.sourceEvent?.preventDefault?.()
      e?.stopPropagation?.()
      e?.target?.releasePointerCapture?.(e.pointerId)
      setDragging(false)
      dragRef.current = null
      document.body.style.cursor = 'auto'
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''
      document.body.style.webkitTouchCallout = ''
      onDragEnd?.()
    },
    [dragging, onDragEnd],
  )

  const handlePointerOver = useCallback(
    (e) => {
      e.stopPropagation()
      setHovered(true)
      document.body.style.cursor = dragging ? 'grabbing' : 'grab'
    },
    [dragging],
  )

  const handlePointerOut = useCallback(
    (e) => {
      e.stopPropagation()
      setHovered(false)
      if (!dragging) document.body.style.cursor = 'auto'
    },
    [dragging],
  )

  const postH = POST_HEIGHT - opticRadius
  const ringColor = dragging ? '#ffdd00' : hovered ? '#ffaa00' : '#ff8800'

  return (
    <group position={position}>
      {/* adjustment ring group — halfway down the post */}
      <group position={[0, -POST_HEIGHT / 2, 0]}>
        {/* invisible drag surface — large disc for reliable pointer capture */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <circleGeometry args={[1.4, 32]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
        </mesh>

        {/* visible rotation ring */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.01, 0]}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <torusGeometry args={[0.65, 0.035, 12, 48]} />
          <meshStandardMaterial color={ringColor} metalness={0.4} roughness={0.3} />
        </mesh>

        {/* direction indicator (small cone sitting on the ring) */}
        <group rotation={[0, yaw, 0]}>
          <mesh position={[0.72, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.05, 0.14, 8]} />
            <meshStandardMaterial color={ringColor} />
          </mesh>
        </group>
      </group>

      <group rotation={[0, yaw, 0]}>{children}</group>

      {/* post */}
      <mesh position={[0, -(POST_HEIGHT + opticRadius) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, postH, 32]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.18} />
      </mesh>

      <Label position={[0.18, 0.32, 0.18]}>{name}</Label>
    </group>
  )
}

function InteractiveMirror({ position, yaw, onYawChange, name, onDragStart, onDragEnd }) {
  return (
    <RotatableOpticMount
      position={position}
      yaw={yaw}
      onYawChange={onYawChange}
      name={name}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      opticRadius={MIRROR_RADIUS}
    >
      <MirrorBody />
    </RotatableOpticMount>
  )
}

function InteractiveFiberCoupler({ position, yaw = 0, coupling = 0, onYawChange, onDragStart, onDragEnd }) {
  return (
    <RotatableOpticMount
      position={position}
      yaw={yaw}
      onYawChange={onYawChange}
      name="Fiber"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      opticRadius={Math.max(FIBER_NEGATIVE_X_FACE_RADIUS, FIBER_POSITIVE_X_FACE_RADIUS)}
    >
      <FiberBody coupling={coupling} />
    </RotatableOpticMount>
  )
}

function Optic({ optic, coupling = 0, onOpticYawChange, onDragStart, onDragEnd }) {
  switch (optic.type) {
    case 'laser':
      return <Laser position={optic.renderPosition} yaw={optic.yaw} />
    case 'mirror':
      return (
        <InteractiveMirror
          position={optic.renderPosition}
          yaw={optic.yaw}
          onYawChange={(yaw) => onOpticYawChange(optic.id, yaw)}
          name={optic.label ?? optic.id}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )
    case 'lens':
      return <Lens position={optic.renderPosition} yaw={optic.yaw} />
    case 'fiber':
      return (
        <InteractiveFiberCoupler
          position={optic.renderPosition}
          yaw={optic.yaw}
          coupling={coupling}
          onYawChange={(yaw) => onOpticYawChange(optic.id, yaw)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )
    default:
      return null
  }
}

/* ───── animated beam ───── */

function Beam({ points }) {
  const flowRef = useRef()

  useFrame((_state, delta) => {
    if (flowRef.current?.material) {
      flowRef.current.material.dashOffset -= delta * 2
    }
  })

  const linePoints = useMemo(() => points.map((p) => [p.x, p.y, p.z]), [points])

  return (
    <group>
      <Line
        points={linePoints}
        color="#2a6cff"
        lineWidth={3}
        transparent
        opacity={0.35}
      />
      <Line
        ref={flowRef}
        points={linePoints}
        color="#80b3ff"
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

function OpticalScene({ is2D, level, opticYaws, onOpticYawChange }) {
  const [isDragging, setIsDragging] = useState(false)

  const resolvedLevel = useMemo(() => resolveLevel(level, opticYaws), [level, opticYaws])
  const { board, optics } = resolvedLevel

  const beamResult = useMemo(() => {
    const source = resolvedLevel.opticsById[resolvedLevel.beam.source]
    const elements = resolvedLevel.optics.filter((optic) => optic.type === 'mirror' || optic.type === 'fiber')

    return computeBeamPath({
      origin: source.beamPosition,
      direction: yawToDirection(source.yaw),
      elements,
      tailLength: resolvedLevel.beam.tailLength,
      maxBounces: resolvedLevel.beam.maxBounces,
    })
  }, [resolvedLevel])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="city" />

      <Fit2DCamera board={board} enabled={is2D} />
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

      <Beam points={beamResult.path} />

      <OrbitControls
        makeDefault
        enabled={!isDragging}
        enableRotate={!is2D}
        enableZoom={!is2D}
        target={[0, 0, 0]}
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

export default function App() {
  const [is2D, setIs2D] = useState(false)
  const [opticYaws, setOpticYaws] = useState(() => buildInitialOpticYaws(DEFAULT_LEVEL))

  const handleOpticYawChange = useCallback((id, yaw) => {
    setOpticYaws((current) => ({
      ...current,
      [id]: yaw,
    }))
  }, [])

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: '100%',
        height: 560,
        position: 'relative',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <Canvas
        key={is2D ? '2d' : '3d'}
        shadows
        orthographic={is2D}
        camera={
          is2D
            ? { position: [0, 15, 0], zoom: 80, near: 0.1, far: 100 }
            : { position: [0, 6.5, 5.5], fov: 42 }
        }
        dpr={[1, 2]}
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <OpticalScene
          is2D={is2D}
          level={DEFAULT_LEVEL}
          opticYaws={opticYaws}
          onOpticYawChange={handleOpticYawChange}
        />
      </Canvas>
      <button
        onClick={() => setIs2D((v) => !v)}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          padding: '6px 14px',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #ccc',
          borderRadius: 6,
          fontSize: 13,
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        {is2D ? '▭ 2D' : '⬡ 3D'}
      </button>
    </div>
  )
}
