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

// Simple Perlin-like noise generator
function generateNoise(x: number, y: number, seed: number, roughness: number): number {
  const random = new SeededRandom(seed + Math.floor(x * 1000) + Math.floor(y * 1000));
  let noise = 0;
  let amplitude = 1;
  let frequency = 0.5; // Start with lower frequency for smoother base
  let maxAmplitude = 0;
  
  for (let i = 0; i < 5; i++) { // Use 5 octaves for smoother result
    const nx = x * frequency;
    const ny = y * frequency;
    
    // Smoother noise using multiple sine waves
    const noiseValue = 
      Math.sin(nx * 3.14 + random.next() * 6.28) * 
      Math.cos(ny * 3.14 + random.next() * 6.28);
    
    noise += noiseValue * amplitude;
    maxAmplitude += amplitude;
    
    amplitude *= roughness;
    frequency *= 2;
  }
  
  // Normalize to -1 to 1 range
  return noise / maxAmplitude;
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
    const segments = 128;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    
    const positions = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(positions.length);
    
    // Generate terrain heights and colors
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] / size;
      const y = positions[i + 1] / size;
      
      // Generate height using noise
      const height = generateNoise(x, y, worldSpec.seed, worldSpec.terrain.roughness) * 8;
      positions[i + 2] = height;
      
      // Color based on biome elevation ranges
      let color = new THREE.Color(0x808080); // default gray
      
      for (const biome of worldSpec.biomes) {
        const [minElev, maxElev] = biome.elevationRange;
        const normalizedHeight = (height + 10) * 100; // Scale to rough elevation range
        
        if (normalizedHeight >= minElev && normalizedHeight <= maxElev) {
          if (biome.type.toLowerCase().includes('mountain')) {
            color = new THREE.Color(0x8b7355); // brown
          } else if (biome.type.toLowerCase().includes('forest')) {
            color = new THREE.Color(0x228b22); // forest green
          } else if (biome.type.toLowerCase().includes('meadow')) {
            color = new THREE.Color(0x90ee90); // light green
          } else if (biome.type.toLowerCase().includes('desert')) {
            color = new THREE.Color(0xdaa520); // goldenrod
          } else if (biome.type.toLowerCase().includes('snow') || biome.type.toLowerCase().includes('ice')) {
            color = new THREE.Color(0xffffff); // white
          }
          break;
        }
      }
      
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    
    geo.attributes.position.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Smooth the terrain
const smoothPositions = new Float32Array(positions.length);
for (let i = 0; i < positions.length; i += 3) {
  const idx = i / 3;
  const gridX = idx % (segments + 1);
  const gridY = Math.floor(idx / (segments + 1));
  
  let totalHeight = positions[i + 2];
  let count = 1;
  
  // Average with neighbors
  const checkNeighbor = (dx: number, dy: number) => {
    const nx = gridX + dx;
    const ny = gridY + dy;
    if (nx >= 0 && nx <= segments && ny >= 0 && ny <= segments) {
      const nIdx = (ny * (segments + 1) + nx) * 3;
      totalHeight += positions[nIdx + 2];
      count++;
    }
  };
  
  checkNeighbor(-1, 0);
  checkNeighbor(1, 0);
  checkNeighbor(0, -1);
  checkNeighbor(0, 1);
  
  smoothPositions[i] = positions[i];
  smoothPositions[i + 1] = positions[i + 1];
  smoothPositions[i + 2] = totalHeight / count;
}

// Copy smoothed positions back
for (let i = 0; i < positions.length; i++) {
  positions[i] = smoothPositions[i];
}
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
  const random = new SeededRandom(worldSpec.seed);
  
  worldSpec.pointsOfInterest.forEach((poi, poiIndex) => {
    for (let i = 0; i < poi.count; i++) {
      const x = (random.next() - 0.5) * 80;
      const z = (random.next() - 0.5) * 80;
      const y = generateNoise(x / 100, z / 100, worldSpec.seed, worldSpec.terrain.roughness) * 20 + 5;
      
      markers.push(
        <group key={`${poiIndex}-${i}`} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[1, 16, 16]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 6]} />
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
      {/* Header */}
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

      {/* 3D Viewer */}
      {worldSpec && (
        <div style={{ height: 'calc(100vh - 140px)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'rgba(22, 33, 62, 0.9)', padding: '15px', borderRadius: '8px', zIndex: 10, maxWidth: '300px' }}>
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

          <Canvas camera={{ position: [50, 50, 50], fov: 60 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <Terrain worldSpec={worldSpec} />
            <POIMarkers worldSpec={worldSpec} />
            <OrbitControls />
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