import React, { useCallback, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import {
  POST_HEIGHT,
  FIBER_LENGTH,
  FIBER_NEGATIVE_X_FACE_RADIUS,
  FIBER_POSITIVE_X_FACE_RADIUS,
  clamp01,
} from './simulationCore'

function Label({ children, position, is2D = false }) {
  return (
    <Html
      position={position}
      occlude={!is2D}
      distanceFactor={is2D ? undefined : 10}
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
          transform: is2D ? 'translate(calc(-100% - 10px), 10px)' : 'translate(10px, -110%)',
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

export function LaserBody() {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.25, 0.25, 1, 32]} />
      <meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.22} />
    </mesh>
  )
}

export function LensBody() {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.5, 0.5, 0.18, 32]} />
      <meshStandardMaterial color="#88bbff" transparent opacity={0.45} metalness={0.1} roughness={0.05} />
    </mesh>
  )
}

export function SpdcBody() {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.5, 0.5, 0.18, 32]} />
      <meshStandardMaterial color="#88bbff" transparent opacity={0.45} metalness={0.1} roughness={0.05} />
    </mesh>
  )
}

export function MirrorBody() {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.5, 0.5, 0.18, 32]} />
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

function FiberFill({ power, color = '#38bdf8', glowColor = '#0ea5e9' }) {
  const fill = clamp01(power)

  if (fill <= 0) return null

  const shellOffset = 0.006
  const bodyInset = 0.002
  const faceOffset = 0.001
  const faceThickness = 0.014
  const fillLength = FIBER_LENGTH * fill
  const bodyLength = Math.max(0, fillLength - bodyInset)
  const endRadius = THREE.MathUtils.lerp(
    FIBER_NEGATIVE_X_FACE_RADIUS + shellOffset,
    FIBER_POSITIVE_X_FACE_RADIUS + shellOffset,
    fill,
  )
  const xCenter = -FIBER_LENGTH / 2 + bodyInset + bodyLength / 2
  const faceX = -FIBER_LENGTH / 2 - faceOffset - faceThickness / 2
  const faceRadius = FIBER_NEGATIVE_X_FACE_RADIUS + shellOffset

  return (
    <>
      {bodyLength > 0 ? (
        <mesh position={[xCenter, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[faceRadius, endRadius, bodyLength, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={glowColor}
            emissiveIntensity={0.9 + fill * 1.8}
            transparent
            opacity={0.95}
          />
        </mesh>
      ) : null}
      <mesh position={[faceX, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[faceRadius, faceRadius, faceThickness, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={glowColor}
          emissiveIntensity={1 + fill * 2}
        />
      </mesh>
    </>
  )
}

function FiberPigtail() {
  const curve = useMemo(() => {
    const horizontalLength = 0.18
    const bendRadius = 0.12
    const verticalLength = 1
    const k = 0.5522847498

    const start = new THREE.Vector3(FIBER_LENGTH / 2 + 0.015, 0, 0)
    const straightEnd = new THREE.Vector3(start.x + horizontalLength, 0, 0)
    const bendEnd = new THREE.Vector3(straightEnd.x + bendRadius, -bendRadius, 0)
    const end = new THREE.Vector3(bendEnd.x, bendEnd.y - verticalLength, 0)

    const path = new THREE.CurvePath()
    path.add(new THREE.LineCurve3(start, straightEnd))
    path.add(
      new THREE.CubicBezierCurve3(
        straightEnd,
        new THREE.Vector3(straightEnd.x + bendRadius * k, straightEnd.y, 0),
        new THREE.Vector3(bendEnd.x, bendEnd.y + bendRadius * k, 0),
        bendEnd,
      ),
    )
    path.add(new THREE.LineCurve3(bendEnd, end))

    return path
  }, [])

  return (
    <>
      <mesh position={[FIBER_LENGTH / 2 + 0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.03, 0.04, 24]} />
        <meshStandardMaterial color="#444" metalness={0.25} roughness={0.7} />
      </mesh>
      <mesh castShadow>
        <tubeGeometry args={[curve, 48, 0.024, 10, false]} />
        <meshStandardMaterial color="#facc15" metalness={0.05} roughness={0.82} />
      </mesh>
    </>
  )
}

export function FiberBody() {
  return (
    <>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[FIBER_NEGATIVE_X_FACE_RADIUS, FIBER_POSITIVE_X_FACE_RADIUS, FIBER_LENGTH, 32]} />
        <meshStandardMaterial color="#555" metalness={0.5} roughness={0.5} />
      </mesh>
      <FiberPigtail />
    </>
  )
}

export function MountedOptic({
  position,
  yaw = 0,
  handleYawOffset = 0,
  label,
  is2D = false,
  opticRadius,
  rotatable = false,
  onYawChange,
  onDragStart,
  onDragEnd,
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
      if (!rotatable) return
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
    [getAngleFromRay, onDragStart, rotatable, yaw],
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!dragRef.current || !rotatable) return
      const pointerAngle = getAngleFromRay(e.ray)
      if (pointerAngle === null) return
      e.sourceEvent?.preventDefault?.()
      e.stopPropagation()
      const delta = pointerAngle - dragRef.current.startPointerAngle
      onYawChange?.(dragRef.current.startYaw - delta)
    },
    [getAngleFromRay, onYawChange, rotatable],
  )

  const endDrag = useCallback(
    (e) => {
      if ((!dragRef.current && !dragging) || !rotatable) return
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
    [dragging, onDragEnd, rotatable],
  )

  const handlePointerOver = useCallback(
    (e) => {
      if (!rotatable) return
      e.stopPropagation()
      setHovered(true)
      document.body.style.cursor = dragging ? 'grabbing' : 'grab'
    },
    [dragging, rotatable],
  )

  const handlePointerOut = useCallback(
    (e) => {
      if (!rotatable) return
      e.stopPropagation()
      setHovered(false)
      if (!dragging) document.body.style.cursor = 'auto'
    },
    [dragging, rotatable],
  )

  const handleYaw = yaw + handleYawOffset
  const postHeight = POST_HEIGHT - opticRadius
  const ringColor = dragging ? '#ffdd00' : hovered ? '#ffaa00' : '#ff8800'

  return (
    <group position={position}>
      {rotatable ? (
        <group position={[0, -POST_HEIGHT / 2, 0]}>
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

          <group rotation={[0, handleYaw, 0]}>
            <mesh position={[0.72, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.05, 0.14, 8]} />
              <meshStandardMaterial color={ringColor} />
            </mesh>
          </group>
        </group>
      ) : null}

      <group rotation={[0, yaw, 0]}>{children}</group>

      <mesh position={[0, -(POST_HEIGHT + opticRadius) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, postHeight, 32]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.18} />
      </mesh>

      <Label position={[0.18, 0.32, 0.18]} is2D={is2D}>
        {label}
      </Label>
    </group>
  )
}
