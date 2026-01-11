import React, { useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

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

// Improved Perlin-style noise with interpolation
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function generateNoise(x: number, y: number, seed: number, roughness: number): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  
  const octaves = 6;
  
  for (let i = 0; i < octaves; i++) {
    const sampleX = x * frequency;
    const sampleY = y * frequency;
    
    const x0 = Math.floor(sampleX);
    const x1 = x0 + 1;
    const y0 = Math.floor(sampleY);
    const y1 = y0 + 1;
    
    const random = new SeededRandom(seed + x0 * 374761393 + y0 * 668265263 + i * 1013);
    
    const sx = smoothstep(sampleX - x0);
    const sy = smoothstep(sampleY - y0);
    
    const n00 = random.next() * 2 - 1;
    random.next();
    const n10 = random.next() * 2 - 1;
    random.next();
    const n01 = random.next() * 2 - 1;
    random.next();
    const n11 = random.next() * 2 - 1;
    
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

function Terrain({ worldSpec }: TerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    const size = 100;
    const segments = 200; // Higher resolution for smoother terrain
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    
    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);
    
    const sortedBiomes = [...worldSpec.biomes].sort((a, b) => a.elevationRange[0] - b.elevationRange[0]);
    
    const minElevation = Math.min(...sortedBiomes.map(b => b.elevationRange[0]));
    const maxElevation = Math.max(...sortedBiomes.map(b => b.elevationRange[1]));
    const elevationRange = maxElevation - minElevation;
    
    // Determine terrain style based on biomes
    const hasMountains = sortedBiomes.some(b => 
      b.type.toLowerCase().includes('mountain') || 
      b.type.toLowerCase().includes('peak') ||
      b.type.toLowerCase().includes('cliff')
    );
    
    const hasHills = sortedBiomes.some(b => 
      b.type.toLowerCase().includes('hill') || 
      b.type.toLowerCase().includes('forest')
    );
    
    // Adjust height scale based on terrain type
    let heightScale = 30;
    if (!hasMountains && !hasHills) {
      heightScale = 5; // Very flat for pure grasslands/plains
    } else if (!hasMountains && hasHills) {
      heightScale = 12; // Gentle rolling hills
    }
    
    const getBiomeColor = (biomeType: string): THREE.Color => {
      const type = biomeType.toLowerCase();
      if (type.includes('mountain') || type.includes('peak') || type.includes('cliff')) {
        return new THREE.Color(0x8b7355);
      } else if (type.includes('forest') || type.includes('wood') || type.includes('tree')) {
        return new THREE.Color(0x2d5016);
      } else if (type.includes('meadow') || type.includes('grass') || type.includes('plain')) {
        return new THREE.Color(0x7cb342);
      } else if (type.includes('desert') || type.includes('sand')) {
        return new THREE.Color(0xe0c097);
      } else if (type.includes('snow') || type.includes('ice') || type.includes('tundra')) {
        return new THREE.Color(0xf0f0f0);
      } else if (type.includes('water') || type.includes('ocean') || type.includes('lake') || type.includes('river')) {
        return new THREE.Color(0x4a90e2);
      } else if (type.includes('swamp') || type.includes('marsh') || type.includes('bog')) {
        return new THREE.Color(0x556b2f);
      } else if (type.includes('volcanic') || type.includes('lava')) {
        return new THREE.Color(0x8b0000);
      } else {
        return new THREE.Color(0x808080);
      }
    };
    
    // First pass: Generate raw heights
    const heightMap: number[][] = [];
    for (let iy = 0; iy <= segments; iy++) {
      heightMap[iy] = [];
      for (let ix = 0; ix <= segments; ix++) {
        const x = (ix / segments - 0.5) * 2;
        const y = (iy / segments - 0.5) * 2;
        
        const noiseValue = generateNoise(x * 2, y * 2, worldSpec.seed, worldSpec.terrain.roughness);
        const normalizedNoise = (noiseValue + 1) / 2;
        const elevation = minElevation + normalizedNoise * elevationRange;
        
        heightMap[iy][ix] = elevation;
      }
    }
    
    // Second pass: Apply erosion-style smoothing
    const smoothedHeightMap: number[][] = [];
    // Increase smoothing for flatter terrains
    const smoothRadius = (!hasMountains && !hasHills) ? 2 : 1;
    
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
              const weight = Math.exp(-distance * distance / 2);
              sum += heightMap[ny][nx] * weight;
              count += weight;
            }
          }
        }
        
        smoothedHeightMap[iy][ix] = sum / count;
      }
    }
    
    // Third pass: Apply to geometry with colors
    for (let i = 0; i < positions.length; i += 3) {
      const vertexIndex = i / 3;
      const ix = vertexIndex % (segments + 1);
      const iy = Math.floor(vertexIndex / (segments + 1));
      
      const elevation = smoothedHeightMap[iy][ix];
      
      const height = ((elevation - minElevation) / elevationRange - 0.5) * heightScale;
      positions[i + 2] = height;
      
      // Calculate slope for color variation
      let slope = 0;
      if (ix > 0 && ix < segments && iy > 0 && iy < segments) {
        const dh_dx = smoothedHeightMap[iy][ix + 1] - smoothedHeightMap[iy][ix - 1];
        const dh_dy = smoothedHeightMap[iy + 1][ix] - smoothedHeightMap[iy - 1][ix];
        slope = Math.sqrt(dh_dx * dh_dx + dh_dy * dh_dy);
      }
      
      let color = new THREE.Color(0x808080);
      
      for (const biome of sortedBiomes) {
        const [minElev, maxElev] = biome.elevationRange;
        if (elevation >= minElev && elevation <= maxElev) {
          color = getBiomeColor(biome.type);
          
          // Darken steep slopes (adds realism)
          const slopeInfluence = Math.min(slope * 50, 0.3);
          color.offsetHSL(0, 0, -slopeInfluence);
          
          // Add subtle height-based variation
          const heightVariation = ((elevation - minElev) / (maxElev - minElev) - 0.5) * 0.1;
          color.offsetHSL(0, 0, heightVariation);
          
          break;
        }
      }
      
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    
    geo.attributes.position.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    
    setGeometry(geo);
  }, [worldSpec]);

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
  
  const sortedBiomes = [...worldSpec.biomes].sort((a, b) => a.elevationRange[0] - b.elevationRange[0]);
  const minElevation = Math.min(...sortedBiomes.map(b => b.elevationRange[0]));
  const maxElevation = Math.max(...sortedBiomes.map(b => b.elevationRange[1]));
  const elevationRange = maxElevation - minElevation;
  const heightScale = 25;
  
  worldSpec.pointsOfInterest.forEach((poi, poiIndex) => {
    for (let i = 0; i < poi.count; i++) {
      const x = (random.next() - 0.5) * 90;
      const z = (random.next() - 0.5) * 90;
      
      const noiseValue = generateNoise(x / 50, z / 50, worldSpec.seed, worldSpec.terrain.roughness);
      const normalizedNoise = (noiseValue + 1) / 2;
      const elevation = minElevation + normalizedNoise * elevationRange;
      const y = ((elevation - minElevation) / elevationRange - 0.5) * heightScale + 3;
      
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
        </group>
      );
    }
  });
  
  return <>{markers}</>;
}

export default function WorldGenerator() {
  const [prompt, setPrompt] = useState('');
  const [worldSpec, setWorldSpec] = useState<WorldSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateWorld = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:4000/generate-world', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Received world spec:', data.worldSpec);
      setWorldSpec(data.worldSpec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate world');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      generateWorld();
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e', color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ padding: '20px', background: '#16213e', borderBottom: '2px solid #0f3460' }}>
        <h1 style={{ margin: '0 0 15px 0', fontSize: '28px', fontWeight: '600' }}>World Generator MVP</h1>
        
        <div style={{ display: 'flex', gap: '10px', maxWidth: '800px' }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your world... (e.g., 'Create a fantasy world with mountains and forests')"
            style={{
              flex: 1,
              padding: '12px 16px',
              background: '#0f3460',
              border: '2px solid #533483',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '16px',
              outline: 'none',
            }}
          />
          <button
            onClick={generateWorld}
            disabled={loading}
            style={{
              padding: '12px 32px',
              background: loading ? '#533483' : '#e94560',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '16px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>
        
        {error && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#e94560', borderRadius: '4px' }}>
            {error}
          </div>
        )}
      </div>

      {worldSpec && (
        <div style={{ height: 'calc(100vh - 140px)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'rgba(22, 33, 62, 0.95)', padding: '15px', borderRadius: '8px', zIndex: 10, maxWidth: '300px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>{worldSpec.worldName}</h3>
            <p style={{ margin: '5px 0', fontSize: '14px', opacity: 0.8 }}>Seed: {worldSpec.seed}</p>
            <p style={{ margin: '5px 0', fontSize: '14px', opacity: 0.8 }}>Roughness: {worldSpec.terrain.roughness}</p>
            <div style={{ marginTop: '10px' }}>
              <p style={{ margin: '5px 0', fontSize: '14px', fontWeight: '600' }}>Biomes:</p>
              {worldSpec.biomes.map((biome, i) => (
                <p key={i} style={{ margin: '3px 0 3px 10px', fontSize: '13px', opacity: 0.8 }}>
                  • {biome.type} ({Math.round(biome.coverage * 100)}%)
                </p>
              ))}
            </div>
            <div style={{ marginTop: '10px' }}>
              <p style={{ margin: '5px 0', fontSize: '14px', fontWeight: '600' }}>Points of Interest:</p>
              {worldSpec.pointsOfInterest.map((poi, i) => (
                <p key={i} style={{ margin: '3px 0 3px 10px', fontSize: '13px', opacity: 0.8 }}>
                  • {poi.type} ({poi.count})
                </p>
              ))}
            </div>
          </div>

          <Canvas camera={{ position: [60, 40, 60], fov: 60 }}>
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />
            <directionalLight position={[-10, 10, -10]} intensity={0.4} />
            <Terrain worldSpec={worldSpec} />
            <POIMarkers worldSpec={worldSpec} />
            <OrbitControls 
              enableDamping
              dampingFactor={0.05}
              minDistance={20}
              maxDistance={150}
            />
            <gridHelper args={[100, 20, '#533483', '#0f3460']} />
          </Canvas>
        </div>
      )}

      {!worldSpec && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 140px)', fontSize: '18px', opacity: 0.5 }}>
          Enter a prompt above to generate your world
        </div>
      )}
    </div>
  );
}