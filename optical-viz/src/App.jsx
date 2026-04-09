import React, { useMemo, useRef } from 'react'
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
  for (let x = -4.5; x <= 4.5; x += 1) {
    for (let z = -2.5; z <= 2.5; z += 1) {
      dots.push(
        <mesh key={`${x}-${z}`} position={[x, 0.001, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.018, 0.03, 16]} />
          <meshBasicMaterial color="#444" />
        </mesh>
      )
    }
  }
  return <group>{dots}</group>
}

function Laser({ position }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.5, 0.18, 0.18]} />
        <meshStandardMaterial color="#666" metalness={0.6} roughness={0.4} />
      </mesh>
      <Label position={[0.28, 0.2, 0.16]}>Laser</Label>
    </group>
  )
}

function OpticMount({ position, rotationY = 0, opticMaterial, label }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.05, 32]} />
        {opticMaterial}
      </mesh>
      <mesh position={[0, -POST_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, POST_HEIGHT, 24]} />
        <meshStandardMaterial color="#777" metalness={0.7} roughness={0.35} />
      </mesh>
      <Label position={[0.18, 0.32, 0.18]}>{label}</Label>
    </group>
  )
}

function Mirror({ position, rotationY = 0, name }) {
  return (
    <OpticMount position={position} rotationY={rotationY} label={name} opticMaterial={
      <>
        <meshStandardMaterial attach="material-0" color="#888" metalness={0.8} roughness={0.3} />
        <meshStandardMaterial attach="material-1" color="#f0f2f5" metalness={1} roughness={0.02} envMapIntensity={2} />
        <meshStandardMaterial attach="material-2" color="#f0f2f5" metalness={1} roughness={0.02} envMapIntensity={2} />
      </>
    } />
  )
}

function Lens({ position }) {
  return (
    <OpticMount position={position} label="Lens" opticMaterial={
      <meshStandardMaterial color="#88bbff" transparent opacity={0.45} metalness={0.1} roughness={0.05} />
    } />
  )
}

function FiberCoupler({ position }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.28, 0.2, 0.2]} />
        <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0.2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.18, 24]} rotation={[0, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#aaa" metalness={0.8} roughness={0.2} />
      </mesh>
      <Label position={[0.24, 0.24, 0.16]}>Fiber</Label>
    </group>
  )
}

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

function OpticalScene() {
  const beamHeight = POST_HEIGHT

  const optics = useMemo(
    () => ({
      laser: new THREE.Vector3(-3.7, beamHeight, -1.7),
      mirror1: new THREE.Vector3(-1.5, beamHeight, -1.7),
      mirror2: new THREE.Vector3(-1.5, beamHeight, 1.2),
      lens: new THREE.Vector3(1.1, beamHeight, 1.2),
      fiber: new THREE.Vector3(3.5, beamHeight, 1.2),
    }),
    []
  )

  const beamPoints = useMemo(
    () => [
      optics.laser.clone(),
      optics.mirror1.clone(),
      optics.mirror2.clone(),
      optics.lens.clone(),
      optics.fiber.clone(),
    ],
    [optics]
  )

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 4]} intensity={1.2} castShadow />
      <Environment preset="studio" />

      <Table />
      <BreadboardHoles />

      <Laser position={[-3.95, POST_HEIGHT, -1.7]} />
      <Mirror position={[-1.5, POST_HEIGHT, -1.7]} rotationY={0} name="Mirror 1" />
      <Mirror position={[-1.5, POST_HEIGHT, 1.2]} rotationY={Math.PI / 2} name="Mirror 2" />
      <Lens position={[1.1, POST_HEIGHT, 1.2]} />
      <FiberCoupler position={[3.5, POST_HEIGHT, 1.2]} />

      <Beam points={beamPoints} />

      <OrbitControls
        makeDefault
        target={[0, 0.15, 0]}
        enablePan
        minDistance={4}
        maxDistance={14}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

export default function App() {
  return (
    <div style={{ width: '100%', height: 560 }}>
      <Canvas
        shadows
        camera={{ position: [0, 6.5, 5.5], fov: 42 }}
        dpr={[1, 2]}
      >
        <OpticalScene />
      </Canvas>
    </div>
  )
}
