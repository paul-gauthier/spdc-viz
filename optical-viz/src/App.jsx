import React, { useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, Line, Environment } from '@react-three/drei'

function pointOnPolyline(points, t) {
  const segLengths = []
  let total = 0

  for (let i = 0; i < points.length - 1; i++) {
    const len = points[i].distanceTo(points[i + 1])
    segLengths.push(len)
    total += len
  }

  let d = THREE.MathUtils.clamp(t, 0, 1) * total

  for (let i = 0; i < segLengths.length; i++) {
    if (d <= segLengths[i]) {
      return new THREE.Vector3().lerpVectors(
        points[i],
        points[i + 1],
        d / segLengths[i]
      )
    }
    d -= segLengths[i]
  }

  return points[points.length - 1].clone()
}

const POST_HEIGHT = 2
const MIRROR_HIT_RADIUS = 0.55

function reflectDir(incident, normal) {
  const d = incident.clone().normalize()
  const n = normal.clone().normalize()
  const dot = d.dot(n)
  return d.sub(n.multiplyScalar(2 * dot)).normalize()
}

function mirrorNormal(rotY) {
  return new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY))
}

function computeBeamPath(laserPos, m1Pos, m1Angle, m2Pos, m2Angle) {
  const path = [laserPos.clone()]

  let dir = new THREE.Vector3().subVectors(m1Pos, laserPos).normalize()
  path.push(m1Pos.clone())

  dir = reflectDir(dir, mirrorNormal(m1Angle))

  const toM2 = new THREE.Vector3().subVectors(m2Pos, m1Pos)
  const proj = toM2.dot(dir)
  if (proj > 0) {
    const closest = m1Pos.clone().add(dir.clone().multiplyScalar(proj))
    if (closest.distanceTo(m2Pos) < MIRROR_HIT_RADIUS) {
      path.push(m2Pos.clone())
      dir = reflectDir(dir, mirrorNormal(m2Angle))
    }
  }

  path.push(path[path.length - 1].clone().add(dir.clone().multiplyScalar(8)))
  return path
}

/* ───── small shared components ───── */

function Label({ children, position }) {
  return (
    <Html position={position} occlude distanceFactor={10}>
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

function Table() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[10, 6]} />
      <meshStandardMaterial color="#2a2a2a" metalness={0.2} roughness={0.8} />
    </mesh>
  )
}

function BreadboardHoles() {
  const dots = []
  for (let x = -4.5; x <= 4.5; x += 1)
    for (let z = -2.5; z <= 2.5; z += 1)
      dots.push(
        <mesh key={`${x}-${z}`} position={[x, 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.075, 0.125, 16]} />
          <meshBasicMaterial color="#444" />
        </mesh>,
      )
  return <group>{dots}</group>
}

function Laser({ position }) {
  return (
    <OpticMount
      position={position}
      label="Laser"
      geometryArgs={[0.15, 0.25, 1, 32]}
      opticMaterial={<meshStandardMaterial color="#666" metalness={0.6} roughness={0.4} />}
    />
  )
}

function OpticMount({ position, rotationY = 0, opticMaterial, label, geometryArgs = [0.5, 0.5, 0.05, 32] }) {
  const opticRadius = Math.max(geometryArgs[0], geometryArgs[1])
  const postHeight = POST_HEIGHT - opticRadius
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
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

function Lens({ position }) {
  return (
    <OpticMount
      position={position}
      label="Lens"
      opticMaterial={
        <meshStandardMaterial color="#88bbff" transparent opacity={0.45} metalness={0.1} roughness={0.05} />
      }
    />
  )
}

function FiberCoupler({ position }) {
  return (
    <OpticMount
      position={position}
      label="Fiber"
      geometryArgs={[0.25, 0.15, 1, 32]}
      opticMaterial={<meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />}
    />
  )
}

/* ───── interactive mirror ───── */

function InteractiveMirror({ position, angle, onAngleChange, name, onDragStart, onDragEnd }) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(null)

  const getAngle = useCallback(
    (pt) => Math.atan2(pt.z - position[2], pt.x - position[0]),
    [position],
  )

  const handlePointerDown = useCallback(
    (e) => {
      e.stopPropagation()
      e.target.setPointerCapture(e.pointerId)
      setDragging(true)
      dragRef.current = { startPA: getAngle(e.point), startAngle: angle }
      document.body.style.cursor = 'grabbing'
      onDragStart?.()
    },
    [angle, getAngle, onDragStart],
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!dragRef.current || !e.point) return
      const delta = getAngle(e.point) - dragRef.current.startPA
      onAngleChange(dragRef.current.startAngle - delta)
    },
    [getAngle, onAngleChange],
  )

  const handlePointerUp = useCallback(() => {
    setDragging(false)
    dragRef.current = null
    document.body.style.cursor = 'auto'
    onDragEnd?.()
  }, [onDragEnd])

  const opticR = 0.5
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
        onPointerUp={handlePointerUp}
        onPointerOver={() => {
          setHovered(true)
          document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => {
          setHovered(false)
          if (!dragging) document.body.style.cursor = 'auto'
        }}
      >
        <circleGeometry args={[1.4, 32]} />
        <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
      </mesh>

      {/* visible rotation ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <torusGeometry args={[0.65, 0.035, 12, 48]} />
        <meshStandardMaterial color={ringColor} metalness={0.4} roughness={0.3} />
      </mesh>

      {/* direction indicator (small cone sitting on the ring) */}
      <group rotation={[0, angle, 0]}>
        <mesh position={[0.72, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.05, 0.14, 8]} />
          <meshStandardMaterial color={ringColor} />
        </mesh>
      </group>
      </group>

      {/* mirror disc */}
      <group rotation={[0, angle, 0]}>
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
  const pulseRef = useRef()

  useFrame((state) => {
    const u = (state.clock.getElapsedTime() * 0.18) % 1
    const p = pointOnPolyline(points, u)
    if (pulseRef.current) pulseRef.current.position.copy(p)
  })

  const linePoints = useMemo(() => points.map((p) => [p.x, p.y, p.z]), [points])

  return (
    <group>
      <Line
        points={linePoints}
        color="#ff2a2a"
        lineWidth={3}
        transparent
        opacity={0.9}
      />
      <mesh ref={pulseRef} castShadow>
        <sphereGeometry args={[0.045, 24, 24]} />
        <meshBasicMaterial color="#ff8080" />
      </mesh>
    </group>
  )
}

function OpticalScene({ is2D }) {
  const [m1Angle, setM1Angle] = useState(Math.PI / 4)
  const [m2Angle, setM2Angle] = useState(Math.PI / 4)
  const [isDragging, setIsDragging] = useState(false)

  const h = POST_HEIGHT

  const positions = useMemo(
    () => ({
      laser: new THREE.Vector3(-4.25, h, -1.5),
      mirror1: new THREE.Vector3(-1.5, h, -1.5),
      mirror2: new THREE.Vector3(-1.5, h, 1.5),
    }),
    [h],
  )

  const beamPoints = useMemo(
    () => computeBeamPath(positions.laser, positions.mirror1, m1Angle, positions.mirror2, m2Angle),
    [positions, m1Angle, m2Angle],
  )

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="city" />

      <Table />
      <BreadboardHoles />

      <Laser position={[-4.5, h, -1.5]} />

      <InteractiveMirror
        position={[-1.5, h, -1.5]}
        angle={m1Angle}
        onAngleChange={setM1Angle}
        name="Mirror 1"
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
      />
      <InteractiveMirror
        position={[-1.5, h, 1.5]}
        angle={m2Angle}
        onAngleChange={setM2Angle}
        name="Mirror 2"
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
      />

      <Lens position={[1.5, h, 1.5]} />
      <FiberCoupler position={[3.5, h, 1.5]} />

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
        <OpticalScene is2D={is2D} />
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
