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
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
You are a world generation assistant.
Output ONLY valid JSON matching this schema:

{
  "worldName": string,
  "biomes": [
    { 
      "type": string, 
      "coverage": number (0-1), 
      "elevationRange": [number, number] (range from -20 to 20)
    }
  ],
  "terrain": {
    "heightmapStyle": string (e.g., "fractal", "rolling", "mountainous"),
    "roughness": number (0.3 to 0.7, where higher = more detail)
  },
  "pointsOfInterest": [
    { "type": string, "count": number }
  ]
}

Note: Do NOT include a seed field - it will be generated automatically.
Lower elevations (negative values) = valleys/water
Higher elevations (positive values) = hills/mountains
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

      // ALWAYS generate a fresh random seed on the server
      worldSpec.seed = Math.floor(Math.random() * 999000) + 1000;
      console.log("Generated seed:", worldSpec.seed);
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse world specification",
        raw: rawContent,
      });
    }

    console.log("=== GENERATED WORLDSPEC ===");
    console.log(JSON.stringify(worldSpec, null, 2));
    console.log("===========================");

    res.json({
      worldSpec,
      raw: rawContent,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "World generation failed." });
  }
});
app.listen(4000, () => console.log("Backend running on port 4000"));
