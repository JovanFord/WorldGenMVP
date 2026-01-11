import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/generate-world", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4",
      temperature: 0.7, // Increased for more variety
      messages: [
        {
          role: "system",
          content: `
You are a world generation assistant that creates diverse, natural terrain specifications.

Output ONLY valid JSON matching this schema:

{
  "worldName": string,
  "biomes": [
    { 
      "type": string (e.g., "Forest", "Mountain", "Desert", "Grassland", "Snow", "Water"),
      "coverage": number (0-1, total should sum to 1.0),
      "elevationRange": [number, number] (use 0-100 scale where 0=lowest, 100=highest)
    }
  ],
  "terrain": {
    "heightmapStyle": string (descriptive style like "gentle rolling hills", "jagged peaks", "flat plains"),
    "roughness": number (0.3=very smooth, 0.5=moderate detail, 0.7=very rough/detailed)
  },
  "pointsOfInterest": [
    { "type": string (descriptive like "Ancient Tree", "Cave Entrance", "Stone Circle"), "count": number (1-5) }
  ]
}

IMPORTANT RULES:
1. Elevation ranges should NOT overlap - each biome gets a distinct height band
2. Lower elevations (0-30) = water, valleys, lowlands
3. Middle elevations (30-60) = plains, forests, grasslands  
4. Higher elevations (60-100) = hills, mountains, peaks
5. Biome coverages must sum to approximately 1.0
6. Match terrain complexity to the prompt (gentle = low roughness, dramatic = high roughness)
7. For simple prompts like "small forest", use ONE biome at 100% coverage
8. Do NOT include a "seed" field

Examples:
- "small forest" → ONE biome: Forest (100%), elevation 20-50, roughness 0.4
- "mountain range" → Mountains (80%) at 60-100, Foothills (20%) at 40-60, roughness 0.7
- "desert oasis" → Desert (85%) at 10-40, Water (15%) at 0-10, roughness 0.3
`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const rawContent = response.choices[0].message.content;

    let worldSpec;
    try {
      worldSpec = JSON.parse(rawContent);

      // Generate a fresh random seed
      worldSpec.seed = Math.floor(Math.random() * 999000) + 1000;

      // Validate and fix biomes
      if (!worldSpec.biomes || worldSpec.biomes.length === 0) {
        throw new Error("No biomes generated");
      }

      // Sort biomes by elevation (lowest to highest)
      worldSpec.biomes.sort((a, b) => a.elevationRange[0] - b.elevationRange[0]);

      // Normalize coverage to sum to 1.0
      const totalCoverage = worldSpec.biomes.reduce((sum, b) => sum + b.coverage, 0);
      if (totalCoverage > 0) {
        worldSpec.biomes.forEach(b => {
          b.coverage = b.coverage / totalCoverage;
        });
      }

      // Ensure roughness is in valid range
      if (worldSpec.terrain.roughness < 0.3) worldSpec.terrain.roughness = 0.3;
      if (worldSpec.terrain.roughness > 0.8) worldSpec.terrain.roughness = 0.8;

      console.log("=== GENERATED WORLDSPEC ===");
      console.log(JSON.stringify(worldSpec, null, 2));
      console.log("===========================");

    } catch (parseErr) {
      console.error("Parse error:", parseErr);
      return res.status(500).json({
        error: "Failed to parse world specification",
        raw: rawContent,
      });
    }

    res.json({
      worldSpec,
      raw: rawContent,
    });
  } catch (err) {
    console.error("Generation error:", err);
    res.status(500).json({ error: "World generation failed." });
  }
});

app.listen(4000, () => console.log("Backend running on port 4000"));