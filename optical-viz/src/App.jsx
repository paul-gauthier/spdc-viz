import React, { useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Line, Environment } from '@react-three/drei'


const POST_HEIGHT = 2
const MIRROR_RADIUS = 0.5
const BEAM_TRACE_EPSILON = 1e-4
const Y_AXIS = new THREE.Vector3(0, 1, 0)

const DEFAULT_LEVEL = {
  board: {
    holesX: 10,
    holesY: 6,
    pitch: 1,
  },
  optics: {
    laser: {
      type: 'laser',
      hole: [0, 1],
      yaw: 0,
      beamExitOffset: [0.25, 0, 0],
    },
    mirror1: {
      type: 'mirror',
      hole: [3, 1],
      yaw: Math.PI / 4,
      label: 'Mirror 1',
    },
    mirror2: {
      type: 'mirror',
      hole: [3, 4],
      yaw: Math.PI / 4,
      label: 'Mirror 2',
    },
    lens: {
      type: 'lens',
      hole: [6, 4],
      yaw: 0,
    },
    fiber: {
      type: 'fiber',
      hole: [8, 4],
      yaw: 0,
    },
  },
  beam: {
    source: 'laser',
    route: ['mirror1', 'mirror2'],
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
  const optics = Object.fromEntries(
    Object.entries(level.optics).map(([id, optic]) => {
      const yaw = opticYaws[id] ?? optic.yaw ?? 0
      const position = holeToWorld(level.board, optic.hole)
      const beamPosition = position.clone().add(localOffsetToWorld(optic.beamExitOffset, yaw))

      return [
        id,
        {
          ...optic,
          id,
          yaw,
          position,
          renderPosition: position.toArray(),
          beamPosition,
        },
      ]
    }),
  )

  return { ...level, optics }
}

function buildInitialOpticYaws(level) {
  return Object.fromEntries(Object.entries(level.optics).map(([id, optic]) => [id, optic.yaw ?? 0]))
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

function computeBeamPath({ origin, direction, elements, tailLength = 8 }) {
  const path = [origin.clone()]

  let rayOrigin = origin.clone()
  let rayDirection = direction.clone().normalize()

  for (const element of elements) {
    if (element.type !== 'mirror') continue

    const hit = intersectRayWithMirror(rayOrigin, rayDirection, element.position, element.yaw)
    if (!hit) break

    path.push(hit.point.clone())
    rayDirection = reflectDir(rayDirection, hit.normal)
    rayOrigin = hit.point.clone().add(rayDirection.clone().multiplyScalar(BEAM_TRACE_EPSILON))
  }

  path.push(path[path.length - 1].clone().add(rayDirection.clone().multiplyScalar(tailLength)))
  return path
}

/* ───── small shared components ───── */

function Label({ children, position }) {
  return (
    <Html position={position} occlude distanceFactor={10} style={{ pointerEvents: 'none' }}>
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

function OpticMount({ position, yaw = 0, opticMaterial, label, geometryArgs = [0.5, 0.5, 0.05, 32] }) {
  const opticRadius = Math.max(geometryArgs[0], geometryArgs[1])
  const postHeight = POST_HEIGHT - opticRadius

  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={geometryArgs} />
        {opticMaterial}
      </mesh>
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

function FiberCoupler({ position, yaw = 0 }) {
  return (
    <OpticMount
      position={position}
      yaw={yaw}
      label="Fiber"
      geometryArgs={[0.25, 0.15, 1, 32]}
      opticMaterial={<meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />}
    />
  )
}

/* ───── interactive mirror ───── */

function InteractiveMirror({ position, yaw, onYawChange, name, onDragStart, onDragEnd }) {
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
      e.stopPropagation()
      e.target.setPointerCapture(e.pointerId)
      setDragging(true)
      dragRef.current = { startPointerAngle, startYaw: yaw }
      document.body.style.cursor = 'grabbing'
      onDragStart?.()
    },
    [getAngleFromRay, onDragStart, yaw],
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!dragRef.current) return
      const pointerAngle = getAngleFromRay(e.ray)
      if (pointerAngle === null) return
      e.stopPropagation()
      const delta = pointerAngle - dragRef.current.startPointerAngle
      onYawChange(dragRef.current.startYaw - delta)
    },
    [getAngleFromRay, onYawChange],
  )

  const endDrag = useCallback(
    (e) => {
      if (!dragRef.current && !dragging) return
      e?.stopPropagation?.()
      e?.target?.releasePointerCapture?.(e.pointerId)
      setDragging(false)
      dragRef.current = null
      document.body.style.cursor = 'auto'
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

  const opticR = MIRROR_RADIUS
  const postH = POST_HEIGHT - opticR
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

      {/* mirror disc */}
      <group rotation={[0, yaw, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[opticR, opticR, 0.05, 32]} />
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
      </group>

      {/* post */}
      <mesh position={[0, -(POST_HEIGHT + opticR) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, postH, 32]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.18} />
      </mesh>

      <Label position={[0.18, 0.32, 0.18]}>{name}</Label>
    </group>
  )
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
        color="#ff2a2a"
        lineWidth={3}
        transparent
        opacity={0.35}
      />
      <Line
        ref={flowRef}
        points={linePoints}
        color="#ff8080"
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

function OpticalScene({ is2D, level, opticYaws, onOpticYawChange }) {
  const [isDragging, setIsDragging] = useState(false)

  const resolvedLevel = useMemo(() => resolveLevel(level, opticYaws), [level, opticYaws])
  const { board, optics } = resolvedLevel

  const beamPoints = useMemo(() => {
    const source = resolvedLevel.optics[resolvedLevel.beam.source]
    const elements = resolvedLevel.beam.route.map((id) => resolvedLevel.optics[id]).filter(Boolean)

    return computeBeamPath({
      origin: source.beamPosition,
      direction: yawToDirection(source.yaw),
      elements,
      tailLength: resolvedLevel.beam.tailLength,
    })
  }, [resolvedLevel])

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="city" />

      <Table board={board} />
      <BreadboardHoles board={board} />

      <Laser position={optics.laser.renderPosition} yaw={optics.laser.yaw} />

      <InteractiveMirror
        position={optics.mirror1.renderPosition}
        yaw={optics.mirror1.yaw}
        onYawChange={(yaw) => onOpticYawChange('mirror1', yaw)}
        name={optics.mirror1.label ?? 'Mirror 1'}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
      />
      <InteractiveMirror
        position={optics.mirror2.renderPosition}
        yaw={optics.mirror2.yaw}
        onYawChange={(yaw) => onOpticYawChange('mirror2', yaw)}
        name={optics.mirror2.label ?? 'Mirror 2'}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
      />

      <Lens position={optics.lens.renderPosition} yaw={optics.lens.yaw} />
      <FiberCoupler position={optics.fiber.renderPosition} yaw={optics.fiber.yaw} />

      <Beam points={beamPoints} />

      <OrbitControls
        makeDefault
        enabled={!isDragging}
        enableRotate={!is2D}
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
    <div style={{ width: '100%', height: 560, position: 'relative' }}>
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
