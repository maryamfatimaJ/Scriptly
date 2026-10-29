// 3D capsule hero scene.
//
// PROVENANCE: copied from the supplied `hero_Section/src/CapsuleScene.tsx`
// and kept deliberately close to the original. The geometry, materials,
// lighting rig, GSAP timelines, float motion, contact shadows and the
// open/close interaction are unchanged — they are the thing being
// integrated, and "improving" them would defeat the point.
//
// Changes made, and only these:
//   - Fallback class names namespaced to `.sc-hero__*` so the styles can
//     be scoped to this hero and cannot leak into the navbar, the
//     sections below it, or any other page.
//   - Runs against @react-three/fiber 8 / drei 9 rather than the
//     original's fiber 9 / drei 10, because Scriptly is on React 18 and
//     fiber 9 requires React 19. The component API used here is identical
//     across those majors; nothing in the scene had to change.
//   - A `paused` prop so the render loop can be stopped when the hero is
//     off-screen. A WebGL canvas repainting behind three screens of
//     scrolled content is wasted battery.
//   - FitCameraToOpenCapsule: moves the camera back (never forward) when
//     the on-screen canvas is too narrow for the OPENED capsule, which
//     otherwise had its halves cut off on phones. A framing change only —
//     on wide desktops the camera stays at the authored z = 6.8.
//
// Accessibility: honours prefers-reduced-motion (the intro animation and
// the idle float are skipped, the capsule still opens), and degrades to a
// CSS capsule when WebGL is unavailable.

import { ContactShadows, Float } from "@react-three/drei"
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import gsap from "gsap"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

type CapsuleProps = {
  open: boolean
  onToggle: () => void
}

type SceneProps = CapsuleProps & {
  /** When true the render loop stops — used while the hero is scrolled out of view. */
  paused?: boolean
}

function createHalfGeometry() {
  const radius = 0.83
  const bodyLength = 1.18
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(radius, 0)]

  points.push(new THREE.Vector2(radius, bodyLength))
  for (let index = 1; index <= 14; index += 1) {
    const angle = (index / 14) * (Math.PI / 2)
    points.push(
      new THREE.Vector2(
        Math.cos(angle) * radius,
        bodyLength + Math.sin(angle) * radius,
      ),
    )
  }

  return new THREE.LatheGeometry(points, 64)
}

const tabletData = [
  {
    position: [-0.54, 0.16, 0.1],
    rotation: [0.2, 0.1, -0.6],
    color: "#f8fbff",
  },
  {
    position: [-0.16, -0.3, 0.22],
    rotation: [-0.3, 0.7, 0.4],
    color: "#78c8ff",
  },
  {
    position: [0.18, 0.27, -0.1],
    rotation: [0.6, 0.2, -0.2],
    color: "#ffffff",
  },
  {
    position: [0.52, -0.08, 0.08],
    rotation: [-0.5, 0.5, 0.8],
    color: "#49aef6",
  },
  {
    position: [0.02, 0.02, 0.42],
    rotation: [0.2, -0.4, 0.5],
    color: "#d8efff",
  },
] as const

function MedicineParticles({ visible }: { visible: boolean }) {
  const group = useRef<THREE.Group>(null)

  useEffect(() => {
    if (!group.current) return
    gsap.to(group.current.scale, {
      x: visible ? 1 : 0.15,
      y: visible ? 1 : 0.15,
      z: visible ? 1 : 0.15,
      duration: visible ? 0.8 : 0.35,
      ease: visible ? "back.out(1.8)" : "power2.in",
      delay: visible ? 0.28 : 0,
    })
  }, [visible])

  useFrame(({ clock }) => {
    if (!group.current || !visible) return
    group.current.rotation.x = Math.sin(clock.elapsedTime * 0.55) * 0.08
    group.current.rotation.y += 0.002
  })

  return (
    <group ref={group} scale={0.15}>
      {tabletData.map((tablet, index) => (
        <Float
          key={tablet.position.join("-")}
          speed={1.2 + index * 0.08}
          floatIntensity={0.13}
          rotationIntensity={0.16}
        >
          <mesh
            // Spread copies: `tabletData` is `as const`, and fiber types
            // position/rotation as mutable tuples. Values unchanged.
            position={[...tablet.position]}
            rotation={[...tablet.rotation]}
            castShadow
            scale={index === 4 ? 0.86 : 1}
          >
            <capsuleGeometry args={[0.13, 0.25, 8, 20]} />
            <meshPhysicalMaterial
              color={tablet.color}
              roughness={0.24}
              metalness={0.02}
              clearcoat={0.8}
              clearcoatRoughness={0.15}
            />
          </mesh>
        </Float>
      ))}
    </group>
  )
}

function Capsule({ open, onToggle }: CapsuleProps) {
  const stage = useRef<THREE.Group>(null)
  const floatGroup = useRef<THREE.Group>(null)
  const leftHalf = useRef<THREE.Group>(null)
  const rightHalf = useRef<THREE.Group>(null)
  const halfGeometry = useMemo(() => createHalfGeometry(), [])
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )

  useEffect(() => {
    if (!stage.current) return
    if (reducedMotion.current) {
      stage.current.scale.setScalar(1)
      stage.current.rotation.set(0.12, -0.28, -0.18)
      return
    }

    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } })
    timeline
      .fromTo(stage.current.scale, { x: 0.45, y: 0.45, z: 0.45 }, {
        x: 1,
        y: 1,
        z: 1,
        duration: 1.4,
      })
      .fromTo(
        stage.current.rotation,
        { x: -0.5, y: -1.2, z: 0.35 },
        { x: 0.12, y: -0.28, z: -0.18, duration: 1.8 },
        "<",
      )
    return () => {
      timeline.kill()
    }
  }, [])

  useEffect(() => {
    if (!leftHalf.current || !rightHalf.current) return
    const duration = reducedMotion.current ? 0.01 : open ? 1.1 : 0.85
    const ease = open ? "power3.out" : "power3.inOut"

    gsap.to(leftHalf.current.position, { x: open ? -0.72 : 0, duration, ease })
    gsap.to(rightHalf.current.position, { x: open ? 0.72 : 0, duration, ease })
    gsap.to(leftHalf.current.rotation, {
      y: open ? -0.16 : 0,
      z: open ? 0.07 : 0,
      duration,
      ease,
    })
    gsap.to(rightHalf.current.rotation, {
      y: open ? 0.16 : 0,
      z: open ? -0.07 : 0,
      duration,
      ease,
    })
  }, [open])

  useFrame(({ clock }) => {
    if (!floatGroup.current || reducedMotion.current) return
    const time = clock.elapsedTime
    floatGroup.current.position.y = Math.sin(time * 0.72) * 0.12
    floatGroup.current.rotation.y = Math.sin(time * 0.34) * 0.12
    floatGroup.current.rotation.z = Math.sin(time * 0.48) * 0.025
  })

  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    onToggle()
  }

  return (
    <group
      ref={stage}
      rotation={[0.12, -0.28, -0.18]}
      onPointerDown={handlePointer}
    >
      <group ref={floatGroup}>
        <group ref={leftHalf}>
          <mesh
            geometry={halfGeometry}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color="#178ce2"
              roughness={0.18}
              metalness={0.04}
              clearcoat={1}
              clearcoatRoughness={0.08}
              sheen={0.3}
              sheenColor="#8bd4ff"
            />
          </mesh>
          <mesh position={[-1.23, 0.04, 0.8]} rotation={[0, 0.2, -Math.PI / 2]}>
            <planeGeometry args={[0.54, 0.16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.78} />
          </mesh>
        </group>

        <MedicineParticles visible={open} />

        <group ref={rightHalf}>
          <mesh
            geometry={halfGeometry}
            rotation={[0, 0, -Math.PI / 2]}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color="#f3f8fc"
              roughness={0.2}
              metalness={0.01}
              clearcoat={1}
              clearcoatRoughness={0.1}
              sheen={0.28}
              sheenColor="#ffffff"
            />
          </mesh>
        </group>
      </group>
    </group>
  )
}

// --- Framing ----------------------------------------------------------------
//
// The supplied scene places the camera at z = 6.8 with a 38deg VERTICAL
// field of view. Vertical FOV means horizontal coverage depends on the
// canvas's aspect ratio — and on how much of the canvas is actually on
// screen, since the canvas deliberately bleeds past its column and is
// clipped by the hero. On a phone, or wherever that clip eats into the
// canvas, there is less sideways room than the OPENED capsule needs, and
// its halves were cut off at the screen edges as they slid apart.
//
// This only ever moves the camera BACK, and only by as much as the open
// state requires. Wherever the original framing already fit — wide
// desktop canvases — the camera stays at exactly 6.8 and the capsule is
// the size it was authored at. Geometry, materials and animation are not
// touched; this is framing, the same thing a photographer does by
// stepping back.
const BASE_CAMERA_Z = 6.8
// Half the width of the fully opened capsule in world units: lathe
// radius 0.83 + body 1.18 + the 0.72 each half slides out = 2.73, plus a
// small margin for the stage's tilt and the tablets' float.
const OPEN_HALF_EXTENT = 2.95

function FitCameraToOpenCapsule() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const canvas = useThree((state) => state.gl.domElement)
  const size = useThree((state) => state.size)

  useEffect(() => {
    const fit = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      // The capsule is centred on the canvas. What matters is the
      // narrower of its two ON-SCREEN halves, after the viewport clip.
      const centreX = rect.left + rect.width / 2
      const visibleHalf = Math.min(
        centreX - Math.max(rect.left, 0),
        Math.min(rect.right, window.innerWidth) - centreX,
      )
      if (visibleHalf <= 0) return

      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const zNeeded = (OPEN_HALF_EXTENT * rect.height) / (2 * tanHalfFov * visibleHalf)
      const z = Math.max(BASE_CAMERA_Z, zNeeded)

      if (Math.abs(camera.position.z - z) > 0.001) {
        camera.position.z = z
        camera.updateProjectionMatrix()
      }
    }

    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [camera, canvas, size.width, size.height])

  return null
}

function WebGLFallback({ onToggle }: { onToggle: () => void }) {
  return (
    <div className="sc-hero__fallback" onClick={onToggle} role="presentation">
      <span className="sc-hero__fallback-half sc-hero__fallback-half--blue" />
      <span className="sc-hero__fallback-half sc-hero__fallback-half--white" />
    </div>
  )
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
  } catch {
    return false
  }
}

export function CapsuleScene({ open, onToggle, paused = false }: SceneProps) {
  const [webGLAvailable, setWebGLAvailable] = useState(true)

  useEffect(() => setWebGLAvailable(supportsWebGL()), [])

  if (!webGLAvailable) return <WebGLFallback onToggle={onToggle} />

  return (
    <Canvas
      // "demand" would stop GSAP-driven frames from presenting, so the
      // loop stays "always" while visible and is parked entirely when
      // the hero scrolls away.
      frameloop={paused ? "never" : "always"}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6.8], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
      aria-label="Interactive three-dimensional blue and white medicine capsule"
    >
      <Suspense fallback={null}>
        <ambientLight intensity={1.5} />
        <hemisphereLight args={["#dff3ff", "#7594ad", 1.2]} />
        <spotLight
          position={[-4, 5, 6]}
          intensity={95}
          angle={0.42}
          penumbra={0.9}
          color="#ffffff"
          castShadow
        />
        <pointLight position={[4, 1, 4]} intensity={35} color="#68c3ff" />
        <pointLight position={[-3, -2, 2]} intensity={18} color="#186fc0" />
        <FitCameraToOpenCapsule />
        <Capsule open={open} onToggle={onToggle} />
        <ContactShadows
          position={[0, -1.52, 0]}
          opacity={0.24}
          scale={6.5}
          blur={2.8}
          far={3.5}
          color="#1d5d88"
        />
      </Suspense>
    </Canvas>
  )
}
