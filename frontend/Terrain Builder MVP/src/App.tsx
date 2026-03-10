import React, { useState, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

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

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hashCorner(
  ix: number,
  iy: number,
  seed: number,
  octave: number,
): number {
  let h = seed ^ (ix * 1619 + iy * 31337 + octave * 6791);
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

// Base value noise — unchanged from original
function generateNoise(
  x: number,
  y: number,
  seed: number,
  roughness: number,
  octaves: number = 6,
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    const sampleX = x * frequency;
    const sampleY = y * frequency;

    const x0 = Math.floor(sampleX);
    const x1 = x0 + 1;
    const y0 = Math.floor(sampleY);
    const y1 = y0 + 1;

    const sx = smoothstep(sampleX - x0);
    const sy = smoothstep(sampleY - y0);

    const n00 = hashCorner(x0, y0, seed, i);
    const n10 = hashCorner(x1, y0, seed, i);
    const n01 = hashCorner(x0, y1, seed, i);
    const n11 = hashCorner(x1, y1, seed, i);

    const nx0 = lerp(n00, n10, sx);
    const nx1 = lerp(n01, n11, sx);
    const nxy = lerp(nx0, nx1, sy);

    total += nxy * amplitude;
    maxValue += amplitude;

    amplitude *= roughness;
    frequency *= 2.1;
  }

  return total / maxValue;
}

// NEW: Domain-warped noise — samples noise twice, using first result to offset
// the coordinates for the second sample. Creates organic, swirling terrain
// that looks like it was shaped by water flow rather than random blobs.
function domainWarpedNoise(
  x: number,
  y: number,
  seed: number,
  roughness: number,
  octaves: number,
  warpStrength: number = 0.8,
): number {
  // First pass — gives us warp offsets
  const warpX = generateNoise(
    x + 1.7,
    y + 9.2,
    seed,
    roughness,
    Math.max(3, octaves - 2),
  );
  const warpY = generateNoise(
    x + 8.3,
    y + 2.8,
    seed + 1,
    roughness,
    Math.max(3, octaves - 2),
  );

  // Second pass — sample at warped coordinates
  return generateNoise(
    x + warpStrength * warpX,
    y + warpStrength * warpY,
    seed,
    roughness,
    octaves,
  );
}

// NEW: Ridge noise — turns smooth hills into sharp mountain ridges by folding
// the noise around zero: ridge = 1 - |noise|. Creates natural-looking peaks
// with defined ridgelines rather than rounded bumps.
function ridgeNoise(
  x: number,
  y: number,
  seed: number,
  roughness: number,
  octaves: number = 5,
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  let prev = 1.0; // tracks previous octave for ridge weighting

  for (let i = 0; i < octaves; i++) {
    const sampleX = x * frequency;
    const sampleY = y * frequency;

    const x0 = Math.floor(sampleX);
    const x1 = x0 + 1;
    const y0 = Math.floor(sampleY);
    const y1 = y0 + 1;

    const sx = smoothstep(sampleX - x0);
    const sy = smoothstep(sampleY - y0);

    const n00 = hashCorner(x0, y0, seed + 77, i);
    const n10 = hashCorner(x1, y0, seed + 77, i);
    const n01 = hashCorner(x0, y1, seed + 77, i);
    const n11 = hashCorner(x1, y1, seed + 77, i);

    const nx0 = lerp(n00, n10, sx);
    const nx1 = lerp(n01, n11, sx);
    const nxy = lerp(nx0, nx1, sy);

    // Ridge fold: map [-1,1] to [0,1] with peak at 0
    const ridge = 1.0 - Math.abs(nxy);
    // Weight by previous octave to get sharp, interconnected ridges
    const weighted = ridge * ridge * prev;
    prev = weighted;

    total += weighted * amplitude;
    maxValue += amplitude;

    amplitude *= roughness;
    frequency *= 2.2;
  }

  return (total / maxValue) * 2 - 1; // remap to [-1, 1]
}

// NEW: Fast hydraulic erosion simulation using iterative height smoothing.
// Real erosion preferentially wears down peaks and fills valleys — we
// approximate this by repeatedly averaging each cell with its neighbors,
// but only applying the change when the neighbor is lower (water flows down).
// Multiple passes simulate sediment transport over time.
function applyErosion(
  heightMap: number[][],
  segments: number,
  passes: number,
  strength: number,
): number[][] {
  let current = heightMap.map((row) => [...row]);

  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((row) => [...row]);

    for (let iy = 1; iy < segments; iy++) {
      for (let ix = 1; ix < segments; ix++) {
        const h = current[iy][ix];

        // Sample 4 cardinal neighbours
        const neighbours = [
          current[iy - 1][ix],
          current[iy + 1][ix],
          current[iy][ix - 1],
          current[iy][ix + 1],
        ];

        const avgNeighbour = neighbours.reduce((a, b) => a + b, 0) / 4;
        const diff = h - avgNeighbour;

        if (diff > 0) {
          // Current cell is a local high point — erode it downward
          // Erosion is proportional to how much higher it is (steeper = faster)
          next[iy][ix] = h - diff * strength;
        } else {
          // Current cell is a local low point — deposit sediment
          // Deposition is weaker than erosion to preserve valley character
          next[iy][ix] = h - diff * strength * 0.3;
        }
      }
    }

    current = next;
  }

  return current;
}

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
  devSettings: {
    terrainSize: number;
    segments: number;
    noiseScale: number;
    heightScale: number;
    octaves: number;
  };
}

function Terrain({ worldSpec, devSettings }: TerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const { terrainSize, segments, noiseScale, octaves } = devSettings;
    const geo = new THREE.PlaneGeometry(
      terrainSize,
      terrainSize,
      segments,
      segments,
    );

    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);

    const sortedBiomes = [...worldSpec.biomes].sort(
      (a, b) => a.elevationRange[0] - b.elevationRange[0],
    );

    const minElevation = Math.min(
      ...sortedBiomes.map((b) => b.elevationRange[0]),
    );
    const maxElevation = Math.max(
      ...sortedBiomes.map((b) => b.elevationRange[1]),
    );
    const elevationRange = maxElevation - minElevation;

    const hasMountains = sortedBiomes.some(
      (b) =>
        b.type.toLowerCase().includes("mountain") ||
        b.type.toLowerCase().includes("peak") ||
        b.type.toLowerCase().includes("cliff"),
    );

    const hasHills = sortedBiomes.some(
      (b) =>
        b.type.toLowerCase().includes("hill") ||
        b.type.toLowerCase().includes("forest"),
    );

    let heightScale = 30;
    if (!hasMountains && !hasHills) {
      heightScale = 5;
    } else if (!hasMountains && hasHills) {
      heightScale = 12;
    }

    // NEW: how much ridge noise vs smooth noise to blend in, based on terrain type.
    // Mountains get strong ridges; hills get subtle ones; flat plains get none.
    const ridgeBlend = hasMountains ? 0.65 : hasHills ? 0.25 : 0.0;
    // Domain warp strength — mountains need more dramatic warping for realistic valleys
    const warpStrength = hasMountains ? 1.1 : hasHills ? 0.6 : 0.2;

    const getBiomeColor = (biomeType: string): THREE.Color => {
      const type = biomeType.toLowerCase();
      if (
        type.includes("mountain") ||
        type.includes("peak") ||
        type.includes("cliff")
      ) {
        return new THREE.Color(0x8b7355);
      } else if (
        type.includes("forest") ||
        type.includes("wood") ||
        type.includes("tree")
      ) {
        return new THREE.Color(0x2d5016);
      } else if (
        type.includes("meadow") ||
        type.includes("grass") ||
        type.includes("plain")
      ) {
        return new THREE.Color(0x7cb342);
      } else if (type.includes("desert") || type.includes("sand")) {
        return new THREE.Color(0xe0c097);
      } else if (
        type.includes("snow") ||
        type.includes("ice") ||
        type.includes("tundra")
      ) {
        return new THREE.Color(0xf0f0f0);
      } else if (
        type.includes("water") ||
        type.includes("ocean") ||
        type.includes("lake") ||
        type.includes("river")
      ) {
        return new THREE.Color(0x4a90e2);
      } else if (
        type.includes("swamp") ||
        type.includes("marsh") ||
        type.includes("bog")
      ) {
        return new THREE.Color(0x556b2f);
      } else if (type.includes("volcanic") || type.includes("lava")) {
        return new THREE.Color(0x8b0000);
      } else {
        return new THREE.Color(0x808080);
      }
    };

    // NEW: Blended biome color — instead of snapping to the nearest biome,
    // we compute a smooth weight for each biome based on how close the vertex
    // elevation is to that biome's center. This eliminates hard colour edges
    // between biomes and creates natural transition zones.
    const getBlendedBiomeColor = (elevation: number): THREE.Color => {
      const weights: { color: THREE.Color; weight: number }[] = [];
      let totalWeight = 0;

      for (const biome of sortedBiomes) {
        const [minElev, maxElev] = biome.elevationRange;
        const center = (minElev + maxElev) / 2;
        const span = Math.max(maxElev - minElev, 1);

        let weight: number;
        if (elevation >= minElev && elevation <= maxElev) {
          // Inside the biome — full contribution, fading toward edges
          const distFromCenter = Math.abs(elevation - center) / (span / 2);
          weight = 1.0 - distFromCenter * 0.4; // stays high inside, dips at edges
        } else {
          // Outside the biome — inverse distance weighting so nearby biomes bleed in
          const dist =
            elevation < minElev ? minElev - elevation : elevation - maxElev;
          weight = 1.0 / (1.0 + (dist / span) * 4.0);
        }

        if (weight > 0.01) {
          weights.push({ color: getBiomeColor(biome.type), weight });
          totalWeight += weight;
        }
      }

      if (weights.length === 0 || totalWeight === 0)
        return new THREE.Color(0x808080);

      // Weighted sum of RGB channels
      let r = 0,
        g = 0,
        b = 0;
      for (const { color, weight } of weights) {
        const norm = weight / totalWeight;
        r += color.r * norm;
        g += color.g * norm;
        b += color.b * norm;
      }

      return new THREE.Color(r, g, b);
    };

    // First pass: generate heights using domain warping + ridge noise blend
    const heightMap: number[][] = [];
    for (let iy = 0; iy <= segments; iy++) {
      heightMap[iy] = [];
      for (let ix = 0; ix <= segments; ix++) {
        const x = (ix / segments - 0.5) * 2;
        const y = (iy / segments - 0.5) * 2;

        const nx = x * noiseScale;
        const ny = y * noiseScale;

        // NEW: Blend domain-warped base noise with ridge noise.
        // Domain warping gives organic flowing shapes; ridge noise adds
        // sharp mountain ridges and defined peaks on top.
        const baseNoise = domainWarpedNoise(
          nx,
          ny,
          worldSpec.seed,
          worldSpec.terrain.roughness,
          octaves,
          warpStrength,
        );
        const rNoise = ridgeNoise(
          nx,
          ny,
          worldSpec.seed,
          worldSpec.terrain.roughness,
          Math.max(3, octaves - 1),
        );
        const blended = baseNoise * (1 - ridgeBlend) + rNoise * ridgeBlend;

        const normalizedNoise = (blended + 1) / 2;
        const elevation = minElevation + normalizedNoise * elevationRange;

        heightMap[iy][ix] = elevation;
      }
    }

    // NEW: Apply erosion simulation before smoothing.
    // Running erosion on the raw noisy heightmap means it carves into the
    // actual noise detail rather than the smoothed version, producing more
    // realistic drainage channels and talus slopes.
    const erosionPasses = hasMountains ? 4 : hasHills ? 2 : 0;
    const erosionStrength = hasMountains ? 0.18 : 0.1;
    const erodedHeightMap =
      erosionPasses > 0
        ? applyErosion(heightMap, segments, erosionPasses, erosionStrength)
        : heightMap;

    // Smoothing pass — gentler for mountains (preserve ridge detail)
    const smoothedHeightMap: number[][] = [];
    const smoothRadius = !hasMountains && !hasHills ? 2 : 1;

    for (let iy = 0; iy <= segments; iy++) {
      smoothedHeightMap[iy] = [];
      for (let ix = 0; ix <= segments; ix++) {
        let sum = 0;
        let count = 0;

        for (let dy = -smoothRadius; dy <= smoothRadius; dy++) {
          for (let dx = -smoothRadius; dx <= smoothRadius; dx++) {
            const nx = ix + dx;
            const ny = iy + dy;

            if (nx >= 0 && nx <= segments && ny >= 0 && ny <= segments) {
              const distance = Math.sqrt(dx * dx + dy * dy);
              const weight = Math.exp((-distance * distance) / 2);
              sum += erodedHeightMap[ny][nx] * weight;
              count += weight;
            }
          }
        }

        smoothedHeightMap[iy][ix] = sum / count;
      }
    }

    // Final pass: apply to geometry with blended colors
    for (let i = 0; i < positions.length; i += 3) {
      const vertexIndex = i / 3;
      const ix = vertexIndex % (segments + 1);
      const iy = Math.floor(vertexIndex / (segments + 1));

      const elevation = smoothedHeightMap[iy][ix];

      const height =
        ((elevation - minElevation) / elevationRange - 0.5) * heightScale;
      positions[i + 2] = height;

      // Slope for color darkening
      let slope = 0;
      if (ix > 0 && ix < segments && iy > 0 && iy < segments) {
        const dh_dx =
          smoothedHeightMap[iy][ix + 1] - smoothedHeightMap[iy][ix - 1];
        const dh_dy =
          smoothedHeightMap[iy + 1][ix] - smoothedHeightMap[iy - 1][ix];
        slope = Math.sqrt(dh_dx * dh_dx + dh_dy * dh_dy);
      }

      // NEW: Use blended biome color instead of hard nearest-biome snap
      const color = getBlendedBiomeColor(elevation);

      // Slope darkening — clamp to avoid black artifacts on dark biomes
      const slopeInfluence = Math.min(slope * 30, 0.15);
      color.offsetHSL(0, 0, -slopeInfluence);

      // Subtle height variation within each biome zone
      let biomeCenter = minElevation + elevationRange / 2;
      let biomeSpan = elevationRange;
      // Find the dominant biome for variation scale
      for (const biome of sortedBiomes) {
        const [minE, maxE] = biome.elevationRange;
        if (elevation >= minE && elevation <= maxE) {
          biomeCenter = (minE + maxE) / 2;
          biomeSpan = Math.max(maxE - minE, 1);
          break;
        }
      }
      const heightVariation = ((elevation - biomeCenter) / biomeSpan) * 0.08;
      color.offsetHSL(0, 0, heightVariation);

      // Clamp channels — prevents black patches on dark biomes
      color.r = Math.max(0.05, color.r);
      color.g = Math.max(0.05, color.g);
      color.b = Math.max(0.05, color.b);

      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }

    geo.attributes.position.needsUpdate = true;
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    setGeometry(geo);
  }, [worldSpec, devSettings]);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        flatShading={false}
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
}

function POIMarkers({ worldSpec }: { worldSpec: WorldSpec }) {
  const markers: React.ReactElement[] = [];
  const random = new SeededRandom(worldSpec.seed + 999);

  const sortedBiomes = [...worldSpec.biomes].sort(
    (a, b) => a.elevationRange[0] - b.elevationRange[0],
  );
  const minElevation = Math.min(
    ...sortedBiomes.map((b) => b.elevationRange[0]),
  );
  const maxElevation = Math.max(
    ...sortedBiomes.map((b) => b.elevationRange[1]),
  );
  const elevationRange = maxElevation - minElevation;

  // FIX: match the dynamic height scale used by Terrain instead of hardcoded 25
  const hasMountains = sortedBiomes.some(
    (b) =>
      b.type.toLowerCase().includes("mountain") ||
      b.type.toLowerCase().includes("peak") ||
      b.type.toLowerCase().includes("cliff"),
  );
  const hasHills = sortedBiomes.some(
    (b) =>
      b.type.toLowerCase().includes("hill") ||
      b.type.toLowerCase().includes("forest"),
  );
  const heightScale = hasMountains ? 30 : hasHills ? 12 : 5;

  worldSpec.pointsOfInterest.forEach((poi, poiIndex) => {
    for (let i = 0; i < poi.count; i++) {
      const x = (random.next() - 0.5) * 90;
      const z = (random.next() - 0.5) * 90;

      const noiseValue = generateNoise(
        x / 50,
        z / 50,
        worldSpec.seed,
        worldSpec.terrain.roughness,
      );
      const normalizedNoise = (noiseValue + 1) / 2;
      const elevation = minElevation + normalizedNoise * elevationRange;
      const y =
        ((elevation - minElevation) / elevationRange - 0.5) * heightScale + 3;

      markers.push(
        <group key={`${poiIndex}-${i}`} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[0.8, 16, 16]} />
            <meshStandardMaterial
              color="#ff3333"
              emissive="#ff0000"
              emissiveIntensity={0.6}
            />
          </mesh>
          <mesh position={[0, -2, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 4]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>,
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

  const [showDevControls, setShowDevControls] = useState(false);
  const [devSettings, setDevSettings] = useState({
    terrainSize: 100,
    segments: 200,
    noiseScale: 2,
    heightScale: 30,
    octaves: 6,
  });

  const generateWorld = async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt");
      return;
    }

    setLoading(true);
    setError("");

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
      console.log("Received world spec:", data.worldSpec);
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
      <div
        style={{
          padding: "20px",
          background: "#16213e",
          borderBottom: "2px solid #0f3460",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: "600" }}>
            World Generator MVP
          </h1>
          <button
            onClick={() => setShowDevControls(!showDevControls)}
            style={{
              padding: "8px 16px",
              background: "#533483",
              border: "none",
              borderRadius: "6px",
              color: "#fff",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            {showDevControls ? "🔧 Hide Dev Tools" : "🔧 Show Dev Tools"}
          </button>
        </div>

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

        {showDevControls && (
          <div
            style={{
              marginTop: "15px",
              padding: "15px",
              background: "rgba(83, 52, 131, 0.2)",
              borderRadius: "8px",
              border: "1px solid #533483",
            }}
          >
            <h3
              style={{
                margin: "0 0 10px 0",
                fontSize: "16px",
                color: "#e94560",
              }}
            >
              🔧 Development Controls
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "15px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    marginBottom: "5px",
                    opacity: 0.8,
                  }}
                >
                  Terrain Size: {devSettings.terrainSize}
                </label>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={devSettings.terrainSize}
                  onChange={(e) =>
                    setDevSettings({
                      ...devSettings,
                      terrainSize: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "11px", opacity: 0.6 }}>
                  Physical world size in units
                </span>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    marginBottom: "5px",
                    opacity: 0.8,
                  }}
                >
                  Resolution: {devSettings.segments}
                </label>
                <input
                  type="range"
                  min="50"
                  max="300"
                  step="10"
                  value={devSettings.segments}
                  onChange={(e) =>
                    setDevSettings({
                      ...devSettings,
                      segments: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "11px", opacity: 0.6 }}>
                  Higher = smoother (slower)
                </span>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    marginBottom: "5px",
                    opacity: 0.8,
                  }}
                >
                  Noise Scale: {devSettings.noiseScale.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.1"
                  value={devSettings.noiseScale}
                  onChange={(e) =>
                    setDevSettings({
                      ...devSettings,
                      noiseScale: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "11px", opacity: 0.6 }}>
                  Lower = bigger features
                </span>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    marginBottom: "5px",
                    opacity: 0.8,
                  }}
                >
                  Height Scale: {devSettings.heightScale}
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={devSettings.heightScale}
                  onChange={(e) =>
                    setDevSettings({
                      ...devSettings,
                      heightScale: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "11px", opacity: 0.6 }}>
                  Vertical exaggeration
                </span>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    marginBottom: "5px",
                    opacity: 0.8,
                  }}
                >
                  Octaves: {devSettings.octaves}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={devSettings.octaves}
                  onChange={(e) =>
                    setDevSettings({
                      ...devSettings,
                      octaves: Number(e.target.value),
                    })
                  }
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "11px", opacity: 0.6 }}>
                  Detail layers (higher = more detail)
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center" }}>
                <button
                  onClick={() =>
                    setDevSettings({
                      terrainSize: 100,
                      segments: 200,
                      noiseScale: 2,
                      heightScale: 30,
                      octaves: 6,
                    })
                  }
                  style={{
                    padding: "8px 16px",
                    background: "#0f3460",
                    border: "1px solid #533483",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {worldSpec && (
        <div style={{ height: "calc(100vh - 140px)", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              background: "rgba(22, 33, 62, 0.95)",
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

          <Canvas camera={{ position: [60, 40, 60], fov: 60 }}>
            <ambientLight intensity={0.4} />
            <directionalLight
              position={[10, 20, 10]}
              intensity={1.2}
              castShadow
            />
            <directionalLight position={[-10, 10, -10]} intensity={0.4} />
            <Terrain worldSpec={worldSpec} devSettings={devSettings} />
            <POIMarkers worldSpec={worldSpec} />
            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minDistance={20}
              maxDistance={150}
            />
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
