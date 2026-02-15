from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
from transformers import CLIPProcessor, CLIPModel
import io
import torch.nn.functional as F
import numpy as np
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

device = "cpu"  # Explicitly use CPU to ensure stability while debugging

# -------- MODEL LOADING -------- #
try:
    logger.info("Loading CLIP model...")
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
    processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    model.eval()
except Exception as e:
    logger.error(f"Model failed to load: {e}")
    raise RuntimeError(e)

ART_TAXONOMY = {
    "medium": [
        "oil painting", "watercolor painting", "acrylic painting", "digital art",
        "charcoal drawing", "pencil sketch", "photography", "ink drawing", "mixed media artwork"
    ],
    "subject": [
        "portrait", "landscape", "still life", "abstract art", "cityscape",
        "animal", "fantasy scene", "mythological scene", "self portrait"
    ],
    "style": [
        "impressionism", "realism", "surrealism", "cubism", "minimalism",
        "baroque art", "modern art", "contemporary art", "pop art", "expressionism"
    ],
    "aesthetic_features": [
        "high contrast", "soft lighting", "vibrant colors", "monochromatic palette",
        "textured brushstrokes", "smooth gradients", "geometric composition", "symmetrical composition"
    ]
}

# -------- HELPERS -------- #

def extract_tensor(output):
    """
    Safely extracts a plain torch.Tensor from either a raw tensor
    or a BaseModelOutputWithPooling object returned by some transformers versions.
    """
    if isinstance(output, torch.Tensor):
        return output
    # BaseModelOutputWithPooling: prefer pooler_output (the projected embedding)
    if hasattr(output, "pooler_output") and output.pooler_output is not None:
        return output.pooler_output
    # Last resort: first element of the output tuple
    return output[0]


def compute_text_embeddings(labels):
    try:
        inputs = processor(text=labels, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            raw = model.get_text_features(**inputs)
            features = extract_tensor(raw)
        return F.normalize(features.float(), p=2, dim=-1)
    except Exception as e:
        logger.error(f"Text embedding error: {e}")
        return None


# -------- PRE-COMPUTE TAXONOMY EMBEDDINGS -------- #

TEXT_EMBEDDINGS = {}
logger.info("Pre-computing taxonomy...")
for category, labels in ART_TAXONOMY.items():
    emb = compute_text_embeddings(labels)
    if emb is not None:
        TEXT_EMBEDDINGS[category] = emb
        logger.info(f"Loaded {category}: {emb.shape}")
    else:
        logger.warning(f"Failed to compute embeddings for category: {category}")


# -------- ANALYZER -------- #

@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    if not TEXT_EMBEDDINGS:
        raise HTTPException(status_code=503, detail="Embeddings not initialized.")

    try:
        # 1. Load Image
        contents = await image.read()
        img = Image.open(io.BytesIO(contents)).convert("RGB")

        # 2. Get Image Features
        inputs = processor(images=img, return_tensors="pt").to(device)
        with torch.no_grad():
            raw = model.get_image_features(**inputs)
            img_emb = extract_tensor(raw)
            img_emb = F.normalize(img_emb.float(), p=2, dim=-1)

        # 3. Compare with Taxonomy
        results = {}
        for category, text_emb in TEXT_EMBEDDINGS.items():
            # Dot product: [1, 512] @ [512, N] -> [1, N]
            probs = (img_emb @ text_emb.T).squeeze(0)

            category_results = []
            labels = ART_TAXONOMY[category]
            for i, score in enumerate(probs):
                conf = float(score.item())
                # Basic weighting to boost confidence slightly
                if category == "medium":
                    conf *= 1.1

                if conf > 0.22:  # Static threshold for testing
                    category_results.append({"label": labels[i], "confidence": round(conf, 3)})

            category_results.sort(key=lambda x: x["confidence"], reverse=True)
            results[category] = category_results

        return results

    except Exception as e:
        logger.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))