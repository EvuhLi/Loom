const crypto = require("crypto");
const AdminSession = require("../models/AdminSession");

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, keyHex] = storedHash.split(":");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(keyHex, "hex");
  if (derivedKey.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(derivedKey, keyBuffer);
}

async function createAdminSessionToken() {
  const token = crypto.randomBytes(32).toString("hex");
  await AdminSession.create({
    token,
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
  });
  return token;
}

async function isValidAdminSession(token = "") {
  const session = await AdminSession.findOne({
    token,
    expiresAt: { $gt: new Date() },
  }).lean();
  return Boolean(session);
}

function requireAdmin(req, res, next) {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin authorization required" });
  }
  const token = auth.slice("Bearer ".length).trim();
  isValidAdminSession(token)
    .then((valid) => {
      if (!valid)
        return res.status(403).json({ error: "Invalid or expired admin session" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Internal Server Error" }));
}

module.exports = { hashPassword, verifyPassword, createAdminSessionToken, requireAdmin };
