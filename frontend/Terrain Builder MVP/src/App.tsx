import React, { useState, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
// import { Water } from "three/examples/jsm/Addons.js";

// Seeded random number generator
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

// Simple Perlin-like noise generator
// Random grid for value noise
const randomGrids = new Map<number, Map<string, number>>();

function getRandomGrid(seed: number): Map<string, number> {
  if (!randomGrids.has(seed)) {
    randomGrids.set(seed, new Map());
  }
  return randomGrids.get(seed)!;
}

function getGridValue(x: number, y: number, seed: number): number {
  const grid = getRandomGrid(seed);
  const key = `${Math.floor(x)},${Math.floor(y)}`;

  if (!grid.has(key)) {
    // Simpler hash - the complex one might be causing patterns
    const hash = (Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663) ^ seed;
    const random = new SeededRandom(Math.abs(hash));
    grid.set(key, random.next());
  }

  return grid.get(key)!;
}

// Smoothstep interpolation
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Interpolation function
function interpolate(a: number, b: number, t: number): number {
  const smooth = smoothstep(t);
  return a + (b - a) * smooth;
}

// Value noise function
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = x - x0;
  const fy = y - y0;

  const v00 = getGridValue(x0, y0, seed);
  const v10 = getGridValue(x1, y0, seed);
  const v01 = getGridValue(x0, y1, seed);
  const v11 = getGridValue(x1, y1, seed);

  // First interpolate along X axis
  const vx0 = interpolate(v00, v10, fx);
  const vx1 = interpolate(v01, v11, fx);

  // Then interpolate along Y axis - THIS IS THE FIX
  return interpolate(vx0, vx1, fy);
}

// Multi-octave fractal noise
// function fractalNoise(
//   x: number,
//   y: number,
//   seed: number,
//   octaves: number,
//   roughness: number
// ): number {
//   let value = 0;
//   let amplitude = 1;
//   let frequency = 1;
//   let maxValue = 0;

//   for (let i = 0; i < octaves; i++) {
//     value += valueNoise(x * frequency, y * frequency, seed) * amplitude;
//     maxValue += amplitude;
//     amplitude *= roughness;
//     frequency *= 2;
//   }

//   return (value / maxValue) * 2 - 1; // Return -1 to 1 range
// }

interface WorldSpec {
  worldName: string;
  seed: number;
  biomes: Array<{
    type: string;
    coverage: number;
    elevationRange: [number, number];
  }>;
  terrain: {
    heightmapStyle: string;
    roughness: number;
  };
  pointsOfInterest: Array<{
    type: string;
    count: number;
  }>;
}

interface TerrainProps {
  worldSpec: WorldSpec;
}

// function WaterPlane() {
//   return (
//     <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
//       <planeGeometry args={[100, 100]} />
//       <meshStandardMaterial
//         color="#4169E1"
//         transparent
//         opacity={0.6}
//         side={THREE.DoubleSide}
//       />
//     </mesh>
//   );
// }

function Terrain({ worldSpec }: TerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const TERRAIN_SIZE = 100;
    const TERRAIN_SEGMENTS = 128;
    const NOISE_SCALE = 5;
    const MAX_HEIGHT = 20;

    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_SEGMENTS,
      TERRAIN_SEGMENTS
    );

    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);

    // Generate terrain heights and colors
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];

      // Sample value noise
      const nx = x / NOISE_SCALE;
      const ny = y / NOISE_SCALE;
      const noise = valueNoise(nx, ny, worldSpec.seed); // Returns 0 to 1

      // Convert noise (0 to 1) to height
      const height = (noise * 2 - 1) * MAX_HEIGHT; // Convert to -1 to 1, then scale
      positions[i + 2] = height;

      const BIOME_COLORS: Record<string, number> = {
        mountain: 0x8b7355,
        forest: 0x228b22,
        meadow: 0x90ee90,
        grass: 0x90ee90,
        desert: 0xdaa520,
        snow: 0xffffff,
        ice: 0xffffff,
      };

      // Color based on biome elevation ranges
      let color = new THREE.Color(0x808080);

      for (const biome of worldSpec.biomes) {
        const [minElev, maxElev] = biome.elevationRange;

        if (height >= minElev && height <= maxElev) {
          const biomeKey = Object.keys(BIOME_COLORS).find((key) =>
            biome.type.toLowerCase().includes(key)
          );

          if (biomeKey) {
            color = new THREE.Color(BIOME_COLORS[biomeKey]);
          }
          break;
        }
      }

      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    geo.attributes.position.needsUpdate = true;
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    setGeometry(geo);
  }, [worldSpec]);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function POIMarkers({ worldSpec }: { worldSpec: WorldSpec }) {
  const markers: JSX.Element[] = [];
  const random = new SeededRandom(worldSpec.seed + 9999); // Different seed offset
  const scale = 5;

  worldSpec.pointsOfInterest.forEach((poi, poiIndex) => {
    for (let i = 0; i < poi.count; i++) {
      const x = (random.next() - 0.5) * 90;
      const z = (random.next() - 0.5) * 90;

      const nx = x / scale;
      const nz = z / scale;
      const noise = valueNoise(nx, nz, worldSpec.seed); // Simple value noise
      const y = (noise * 2 - 1) * 20 + 2; // Match terrain height calculation

      markers.push(
        <group key={`${poiIndex}-${i}`} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[0.8, 16, 16]} />
            <meshStandardMaterial
              color="#ff0000"
              emissive="#ff0000"
              emissiveIntensity={0.5}
            />
          </mesh>
          <mesh position={[0, 2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 4]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      );
    }
  });

  return <>{markers}</>;
}

export default function WorldGenerator() {
  const [prompt, setPrompt] = useState("");
  const [worldSpec, setWorldSpec] = useState<WorldSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateWorld = async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setLoading(true);
    setError("");

    // Clear the random grid cache before generating new world
    randomGrids.clear();

    try {
      const response = await fetch("http://localhost:4000/generate-world", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setWorldSpec(data.worldSpec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate world");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      generateWorld();
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#1a1a2e",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px",
          background: "#16213e",
          borderBottom: "2px solid #0f3460",
        }}
      >
        <h1
          style={{ margin: "0 0 15px 0", fontSize: "28px", fontWeight: "600" }}
        >
          World Generator MVP
        </h1>

        <div style={{ display: "flex", gap: "10px", maxWidth: "800px" }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your world... (e.g., 'Create a fantasy world with mountains and forests')"
            style={{
              flex: 1,
              padding: "12px 16px",
              background: "#0f3460",
              border: "2px solid #533483",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "16px",
              outline: "none",
            }}
          />
          <button
            onClick={generateWorld}
            disabled={loading}
            style={{
              padding: "12px 32px",
              background: loading ? "#533483" : "#e94560",
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "16px",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: "10px",
              padding: "10px",
              background: "#e94560",
              borderRadius: "4px",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* 3D Viewer */}
      {worldSpec && (
        <div style={{ height: "calc(100vh - 140px)", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              background: "rgba(22, 33, 62, 0.9)",
              padding: "15px",
              borderRadius: "8px",
              zIndex: 10,
              maxWidth: "300px",
            }}
          >
            <h3 style={{ margin: "0 0 10px 0", fontSize: "18px" }}>
              {worldSpec.worldName}
            </h3>
            <p style={{ margin: "5px 0", fontSize: "14px", opacity: 0.8 }}>
              Seed: {worldSpec.seed}
            </p>
            <p style={{ margin: "5px 0", fontSize: "14px", opacity: 0.8 }}>
              Roughness: {worldSpec.terrain.roughness}
            </p>
            <div style={{ marginTop: "10px" }}>
              <p
                style={{ margin: "5px 0", fontSize: "14px", fontWeight: "600" }}
              >
                Biomes:
              </p>
              {worldSpec.biomes.map((biome, i) => (
                <p
                  key={i}
                  style={{
                    margin: "3px 0 3px 10px",
                    fontSize: "13px",
                    opacity: 0.8,
                  }}
                >
                  • {biome.type} ({Math.round(biome.coverage * 100)}%)
                </p>
              ))}
            </div>
            <div style={{ marginTop: "10px" }}>
              <p
                style={{ margin: "5px 0", fontSize: "14px", fontWeight: "600" }}
              >
                Points of Interest:
              </p>
              {worldSpec.pointsOfInterest.map((poi, i) => (
                <p
                  key={i}
                  style={{
                    margin: "3px 0 3px 10px",
                    fontSize: "13px",
                    opacity: 0.8,
                  }}
                >
                  • {poi.type} ({poi.count})
                </p>
              ))}
            </div>
          </div>

          <Canvas camera={{ position: [50, 50, 50], fov: 60 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <Terrain worldSpec={worldSpec} />
            {/* <WaterPlane /> */}
            <POIMarkers worldSpec={worldSpec} />
            <OrbitControls />
            <gridHelper args={[100, 20, "#533483", "#0f3460"]} />
          </Canvas>
        </div>
      )}

      {!worldSpec && !loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "calc(100vh - 140px)",
            fontSize: "18px",
            opacity: 0.5,
          }}
        >
          Enter a prompt above to generate your world
        </div>
      )}
    </div>
  );
}
