import React, { useState, useRef, useEffect } from "react";

// Add this helper function at the top of your component or outside it
const applyNoise = (ctx, width, height, intensity = 20) => {
  // 1. Get the raw pixel data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data; // This is a massive array of [R, G, B, A, R, G, B, A...]

  // 2. Loop through every pixel and mess it up slightly
  for (let i = 0; i < data.length; i += 4) {
    // Generate a random shift (e.g., -20 to +20)
    const noise = (Math.random() - 0.5) * intensity;
    
    // Apply to Red, Green, Blue channels
    data[i] = Math.min(255, Math.max(0, data[i] + noise));     // R
    data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise)); // G
    data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise)); // B
    // We leave data[i+3] (Alpha/Transparency) alone
  }

  // 3. Put the "poisoned" pixels back
  ctx.putImageData(imageData, 0, 0);
};

const TestBench = () => {
  const [originalImage, setOriginalImage] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const canvasRef = useRef(null);

  // 1. SIMULATE SERVER SLICING
  // In production, your Node server does this. Here, we do it in browser for testing.
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      setOriginalImage(img);

      // Calculate tile size (3x3 grid)
      const rows = 3;
      const cols = 3;
      const tileW = img.width / cols;
      const tileH = img.height / rows;
      const newTiles = [];
      // applyNoise(img.getContext("2d"), img.width, img.height); // Optional: Add noise to the original image before slicing
      // Create a temporary canvas to slice the image
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      tempCanvas.width = tileW;
      tempCanvas.height = tileH;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Clear temp canvas
          tempCtx.clearRect(0, 0, tileW, tileH);

          // Draw just ONE tile section onto temp canvas
          tempCtx.drawImage(
            img,
            c * tileW,
            r * tileH,
            tileW,
            tileH, // Source (Slice)
            0,
            0,
            tileW,
            tileH, // Destination (Temp Canvas)
          );

          // Save that tile as a "blob" URL (Simulating a server URL)
          newTiles.push({
            row: r,
            col: c,
            src: tempCanvas.toDataURL(),
            x: c * tileW,
            y: r * tileH,
            w: tileW,
            h: tileH,
          });
        }
      }
      setTiles(newTiles);
    };
  };

  // 2. RECONSTRUCT ON CLIENT
  useEffect(() => {
    if (!canvasRef.current || tiles.length === 0 || !originalImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Match canvas size to original image
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;

    tiles.forEach((tile) => {
      const img = new Image();
      img.src = tile.src;
      img.onload = () => {
        ctx.drawImage(img, tile.x, tile.y, tile.w, tile.h);

        // DEBUG: Draw red lines if debug mode is on
        if (debugMode) {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 2;
          ctx.strokeRect(tile.x, tile.y, tile.w, tile.h);
        }
      };
    });
  }, [tiles, debugMode, originalImage]);

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "sans-serif",
        backgroundColor: "#f4ecd8",
        minHeight: "100vh",
        color: "#2c241b",
      }}
    >
      <h1>Loom Protection Test</h1>

      {/* CONTROLS */}
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #d4c5b0",
          background: "#fff",
        }}
      >
        <input type="file" onChange={handleImageUpload} accept="image/*" />
        <label style={{ marginLeft: "20px" }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
          />{" "}
          Show Grid Lines (Prove Slicing)
        </label>
      </div>

      <div style={{ display: "flex", gap: "40px" }}>
        {/* COLUMN 1: The Trap (What the user sees) */}
        <div>
          <h3>Protected View (Try Right-Clicking)</h3>
          {/* COLUMN 1: The Trap (What the user sees) */}
          <div>
            <h3>Protected View (Try Right-Clicking)</h3>

            {/* CONTAINER: constrained to the width of the parent column */}
            <div
              style={{
                position: "relative",
                display: "inline-block",
                border: "5px solid #d4af37",
                maxWidth: "100%", // <--- ADD THIS: Ensures it never exceeds screen width
                lineHeight: 0, // <--- ADD THIS: Removes tiny gap at bottom of canvas
              }}
            >
              {/* CANVAS: Scales down visually, keeps resolution internally */}
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  width: "100%", // <--- ADD THIS: Forces canvas to fit container
                  height: "auto", // <--- ADD THIS: Maintains aspect ratio
                }}
              />

              {/* THE TRAP: Now uses percentages to match the responsive canvas */}
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  alert("LOOM PROTOCOL: Right-click disabled.");
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 10,
                  cursor: "default",
                  backgroundImage:
                    'url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")',
                }}
              />
            </div>
          </div>
        </div>

        {/* COLUMN 2: What the Bot Sees (Behind the scenes) */}
        <div>
          <h3>What a Scraper Sees</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "5px",
              width: "300px",
            }}
          >
            {tiles.map((tile, i) => (
              <img
                key={i}
                src={tile.src}
                alt={`Fragment ${i}`}
                style={{ width: "100%", border: "1px dashed #999" }}
              />
            ))}
          </div>
          <p
            style={{ marginTop: "10px", fontSize: "0.9em", maxWidth: "300px" }}
          >
            A bot trying to download the image URL will fail because the "image"
            doesn't exist as one file. It only sees these 9 disconnected
            fragments.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestBench;
