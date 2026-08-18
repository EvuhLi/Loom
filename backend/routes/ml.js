const router = require("express").Router();
const nodeFetch = require("node-fetch");
const FormData = require("form-data");

const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/umm-maybe/AI-image-detector";
const ML_SERVICE_URL_RAW = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
const ML_SERVICE_URL = /^https?:\/\//i.test(ML_SERVICE_URL_RAW)
  ? ML_SERVICE_URL_RAW
  : `http://${ML_SERVICE_URL_RAW}`;

router.post("/check-ai", async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData)
      return res.status(400).json({ error: "No image data provided" });

    if (!HF_API_TOKEN) {
      return res.status(503).json({ error: "HF_API_TOKEN not configured" });
    }

    const imageBuffer = Buffer.from(imageData, "base64");

    const hfResponse = await nodeFetch(HF_MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
      timeout: 30000,
    });

    if (!hfResponse.ok) {
      const errorText = await hfResponse.text();
      console.error(`HF API error ${hfResponse.status}:`, errorText);
      return res.status(502).json({ error: "HF API failed", detail: errorText });
    }

    const result = await hfResponse.json();
    res.json(result);
  } catch (err) {
    console.error("AI check error:", err.message);
    res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
});

router.post("/analyze", async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData)
      return res.status(400).json({ error: "No image data provided" });

    const imageBuffer = Buffer.from(imageData, "base64");

    const form = new FormData();
    form.append("image", imageBuffer, {
      filename: "artwork.jpg",
      contentType: "image/jpeg",
    });

    const mlResponse = await nodeFetch(`${ML_SERVICE_URL}/tagging/analyze`, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
      timeout: 30000,
    });

    if (!mlResponse.ok) {
      const err = await mlResponse.text();
      console.error("ML analyze error:", err);
      return res.json({});
    }

    const result = await mlResponse.json();
    res.json(result && typeof result === "object" ? result : {});
  } catch (err) {
    console.error("Analyze crash:", err.message);
    res.json({});
  }
});

module.exports = router;
