import { useState } from "react";
import axios from "axios";

function App() {
  const [prompt, setPrompt] = useState("");
  const [world, setWorld] = useState("");

  const generateWorld = async () => {
    const res = await axios.post("http://localhost:4000/generate-world", {
      prompt,
    });
    setWorld(res.data.data);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Prompt-Driven World Generator</h1>

      <textarea
        rows={5}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the world you want..."
        style={{ width: "100%" }}
      />

      <button onClick={generateWorld} style={{ marginTop: 10 }}>
        Generate World
      </button>

      <pre style={{ padding: 20, background: "#eee", marginTop: 20 }}>
        {world}
      </pre>
    </div>
  );
}

export default App;
