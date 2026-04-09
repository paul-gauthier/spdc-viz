# Optical Table Visualization

Developer documentation for the React + Vite optical simulation app in this repository.

## Overview

This project renders an interactive optical table in React using `@react-three/fiber`, `three`, and `@react-three/drei`.

The current app is structured around a small set of modules:

- **level data** defines board size, optic placement, and beam sources
- **scene rendering** turns resolved level data into 3D objects and controls
- **optic registry** maps optic types to both rendering behavior and simulation behavior
- **simulation core** contains shared geometry/math helpers and intersection logic
- **beam tracing** computes beam paths and fiber coupling from the resolved scene

The app supports:

- 2D / 3D camera modes
- rotatable optics
- beam tracing with reflections
- coupling into a fiber optic target
- level-driven scene configuration

## Repository layout

### App entry

- `src/main.jsx`  
  React entry point. Mounts the app and loads global CSS.

- `src/App.jsx`  
  Top-level UI component. Owns:
  - current level selection
  - 2D / 3D camera toggle
  - optic yaw state for interactive rotation

### Scene and rendering

- `src/scene.jsx`  
  Scene composition layer. Responsible for:
  - camera fitting in 2D and 3D
  - lights and environment
  - board/table rendering
  - optic instancing
  - beam rendering
  - orbit controls
  - drag state coordination with camera controls

- `src/optics.jsx`  
  Reusable render components for the physical optic bodies and mounts:
  - `LaserBody`
  - `LensBody`
  - `MirrorBody`
  - `FiberBody`
  - `MountedOptic`

  `MountedOptic` encapsulates the shared mount/post visuals and the pointer-driven yaw rotation UI.

### Data and configuration

- `src/levels.js`  
  Defines level data and converts authoring-time level config into runtime scene data.
  
  Key responsibilities:
  - declare board dimensions and optic placements
  - define beam sources and tracing limits
  - build initial optic yaw state
  - resolve optic positions and beam origins from board coordinates

- `src/opticRegistry.js`  
  Central registry for optic types. Each optic type describes:
  - defaults such as label and initial beam offset
  - render metadata such as body component and optic radius
  - interaction settings such as rotatability
  - simulation hooks such as ray intersection and hit behavior

  This is the main extension point when adding a new optic type.

### Simulation

- `src/simulationCore.js`  
  Low-level geometry and optics math:
  - board-to-world coordinate conversion
  - yaw-to-direction conversion
  - local offset transforms
  - ray/mirror intersection
  - ray/fiber-face intersection
  - reflection math
  - fiber coupling calculation

- `src/simulation.js`  
  Beam tracing orchestration built on top of `simulationCore.js`.
  
  Key responsibilities:
  - trace a beam through interactive elements
  - accumulate reflected segments
  - terminate on non-reflective outcomes
  - merge fiber coupling results across beams

### Styling and static assets

- `src/index.css`  
  Global styles.

- `src/App.css`  
  App-level styles.

- `public/`  
  Static assets served directly by Vite.

- `src/assets/`  
  Bundled assets imported by the app.

### Tooling

- `index.html`  
  Vite HTML entry.

- `package.json`  
  Project scripts and dependencies.

- `vite.config.js`  
  Vite configuration.

- `netlify.toml`  
  Netlify deployment configuration.

## Runtime flow

At a high level, the app works like this:

1. `App.jsx` selects a level and stores current optic yaw state.
2. `OpticalScene` calls `resolveLevel(level, opticYaws)` to turn level definitions into positioned runtime objects.
3. Traceable optics are filtered via `isTraceElement(...)`.
4. `traceAllBeams(...)` computes beam paths and coupling values.
5. The scene renders:
   - the table and breadboard holes
   - each optic via `MountedOptic`
   - each traced beam via `Beam`
6. Dragging a rotatable optic updates yaw state in `App.jsx`, which recomputes the resolved level and beam trace.

## Core architecture concepts

### 1. Levels are data-first

Levels describe *what exists* in the scene:

- board dimensions
- optics
- beam emitters

They do not contain rendering code or tracing code. That behavior comes from the registry and simulation layers.

### 2. Optic types are registry-driven

Each optic type is declared once in `src/opticRegistry.js` and provides both:

- **render behavior**
- **simulation behavior**

This keeps optic-specific logic out of the general scene code.

### 3. Rendering and simulation are separate

Rendering components in `src/optics.jsx` focus on visuals and interaction surfaces.

Physics-ish behavior such as intersection tests, reflections, and coupling stays in `src/simulationCore.js` and `src/simulation.js`.

### 4. Scene state is minimal

The top-level app stores only interactive state that changes at runtime:

- camera mode (`is2D`)
- optic yaw values

Everything else is derived from level data plus that state.

## Important modules in more detail

### `resolveLevel(...)`

`resolveLevel` in `src/levels.js` is the bridge between level config and runtime scene objects.

It computes:

- resolved optic yaw
- world-space optic position
- render position arrays for React Three Fiber
- beam origin from `beamExitOffset`

If a new level property affects simulation or placement, this is usually where the runtime derivation should happen.

### `MountedOptic`

`MountedOptic` in `src/optics.jsx` handles:

- shared optic mount visuals
- label display
- invisible pointer target for rotation
- drag lifecycle hooks
- yaw updates based on pointer angle on a horizontal drag plane

If interaction behavior changes for all rotatable optics, this is the primary component to inspect.

### `traceBeam(...)`

`traceBeam` in `src/simulation.js` is the main tracing loop.

For each bounce it:

- finds the closest hit among trace elements
- records the hit point in the beam path
- delegates hit handling to the optic type
- either reflects, terminates, or stops tracing
- appends a final tail segment if the beam exits without terminating

## Adding a new optic type

The intended path is:

1. Add render geometry in `src/optics.jsx` if a new body component is needed.
2. Register the optic in `src/opticRegistry.js`.
3. Add any new math/intersection helpers to `src/simulationCore.js`.
4. Reference the new optic type from a level in `src/levels.js`.

A typical optic registration includes:

- defaults
- render component + radius
- interaction flags
- simulation `intersect(...)`
- simulation `onHit(...)`

## Adding or editing a level

Levels live in `src/levels.js`.

A level typically defines:

- `board`
  - `holesX`
  - `holesY`
  - `pitch`
- `optics`
  - `id`
  - `type`
  - `hole`
  - `yaw`
  - optional labels and offsets
- `beams`
  - `source`
  - `tailLength`
  - `maxBounces`

Use `hole` coordinates for placement rather than hard-coded world positions. World-space conversion should stay centralized in the simulation helpers.

## Notes for maintainers

- Keep optic-specific behavior in the registry and simulation layers rather than branching in scene code.
- Prefer derived data over duplicated state.
- Keep geometry/math utilities in `simulationCore.js` so rendering and tracing use the same assumptions.
- Treat `src/scene.jsx` as the composition layer, not the place for optic-specific simulation rules.

## Development

Common project files:

- `README.md` — this document
- `src/` — application source
- `public/` — static assets
- `package.json` — scripts/dependencies

Typical local workflow:

- install dependencies
- run the Vite dev server
- edit level data, optic registry, or scene/simulation modules depending on the task
