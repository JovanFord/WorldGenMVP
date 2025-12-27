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
  "seed": number,
  "biomes": [
    { "type": string, "coverage": number, "elevationRange": [number, number] }
  ],
  "terrain": {
    "heightmapStyle": string,
    "roughness": number
  },
  "pointsOfInterest": [
    { "type": string, "count": number }
  ]
}
`
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    
    
    const rawContent = response.choices[0].message.content;

    let worldSpec;
    try {
    worldSpec = JSON.parse(rawContent);
    } catch (parseErr) {
    return res.status(500).json({ 
        error: "Failed to parse world specification",
        raw: rawContent 
    });
    }

    console.log("=== RAW WORLDSPEC ===");
    console.log(rawContent);
    console.log("=====================");

    res.json({
        worldSpec,
        raw: rawContent
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "World generation failed." });
  }
});

app.listen(4000, () => console.log("Backend running on port 4000"));
