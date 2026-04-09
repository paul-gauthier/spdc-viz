import React, { useCallback, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { LEVELS, buildInitialOpticYaws } from './levels'
import { OpticalScene } from './scene'

const DEFAULT_LEVEL_ID = 'level2'

export default function App() {
  const level = LEVELS[DEFAULT_LEVEL_ID]
  const [is2D, setIs2D] = useState(false)
  const [opticYaws, setOpticYaws] = useState(() => buildInitialOpticYaws(level))
  const saved3DViewRef = useRef(null)

  const handleSave3DView = useCallback((view) => {
    saved3DViewRef.current = view
  }, [])

  const handleOpticYawChange = useCallback((id, yaw) => {
    setOpticYaws((current) => ({
      ...current,
      [id]: yaw,
    }))
  }, [])

  const handleReset = useCallback(() => {
    setOpticYaws(buildInitialOpticYaws(level))
  }, [level])

  const handleJitter = useCallback(() => {
    const initialOpticYaws = buildInitialOpticYaws(level)
    const jitterAmount = 0.02

    setOpticYaws((current) =>
      Object.fromEntries(
        level.optics.map((optic) => {
          const baseYaw = current[optic.id] ?? initialOpticYaws[optic.id] ?? 0
          const nextYaw = baseYaw + (Math.random() * 2 - 1) * jitterAmount

          return [optic.id, Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw))]
        }),
      ),
    )
  }, [level])

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
            : { position: [0, 8.5, 8.5], fov: 50 }
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
          level={level}
          opticYaws={opticYaws}
          onOpticYawChange={handleOpticYawChange}
          saved3DView={saved3DViewRef.current}
          onSave3DView={handleSave3DView}
        />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          zIndex: 10,
        }}
      >
        <button
          onClick={handleReset}
          style={{
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <button
          onClick={handleJitter}
          style={{
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Jitter
        </button>
        <button
          onClick={() => setIs2D((v) => !v)}
          style={{
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {is2D ? '▭ 2D' : '⬡ 3D'}
        </button>
      </div>
    </div>
  )
}
