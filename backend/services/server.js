// backend/server.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const app = express();

const SECRET_KEY = 'your_super_secret_hackathon_key';

// --- 1. RATE LIMITING (The "Traffic Cop") ---
// If an IP hits this endpoint more than 50 times in 1 minute, block them.
const imageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, 
    message: "Too many requests from this IP. You look like a bot.",
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply to image routes
app.use('/api/tiles', imageLimiter);


// --- 2. SIGNED URL GENERATOR ---
// Create a temporary token valid for 5 minutes
function generateSignedUrl(filePath) {
    const expiry = Date.now() + (5 * 60 * 1000); // 5 mins from now
    const data = `${filePath}${expiry}`;
    const signature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
    
    return `${filePath}?expires=${expiry}&sig=${signature}`;
}

// --- 3. VERIFICATION MIDDLEWARE ---
// Check if the URL signature is valid before serving the file
function verifySignature(req, res, next) {
    const { expires, sig } = req.query;
    const filePath = req.path; // e.g., "/image_tile_0_0.jpg"

    if (!expires || !sig || Date.now() > parseInt(expires)) {
        return res.status(403).send("Link expired or invalid.");
    }

    const data = `${filePath}${expires}`;
    const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');

    if (sig !== expectedSig) {
        return res.status(403).send("Invalid signature.");
    }
    
    next();
}

// Route to serve protected tiles
app.get('/api/tiles/:filename', verifySignature, (req, res) => {
    // Logic to send file...
    res.sendFile(path.join(__dirname, 'tiles', req.params.filename));
});