require("dotenv").config();

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const mongoose = require("mongoose");

const Account = require("./models/Account");
const Post = require("./models/Post");
const { runBehaviorAnalysisBatch } = require("./services/behaviorAnalysis");
const { escapeRegex } = require("./utils/helpers");
const { hashPassword } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// =============================
// ENV
// =============================

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "loomadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "loomadmin";

async function ensureAdminAccount() {
  const usernameRegex = new RegExp(`^${escapeRegex(ADMIN_USERNAME)}$`, "i");
  const existing = await Account.findOne({ username: usernameRegex });
  if (!existing) {
    await Account.create({
      username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "admin",
      bio: "Loom platform administrator",
      profilePic: "",
      followersCount: 0,
      following: [],
    });
    console.log("Admin account seeded");
    return;
  }
  if (existing.role !== "admin") {
    existing.role = "admin";
    await existing.save();
  }
}

async function ensureIndexes() {
  try {
    // Create compound indexes for fast filtering + sorting
    await Post.collection.createIndex({ artistId: 1, date: -1 });
    await Post.collection.createIndex({ user: 1, date: -1 });
    await Post.collection.createIndex({ date: -1 });

    // Create **case-insensitive** index for username lookups
    // This allows fast username queries regardless of case
    const userCollation = { locale: "en", strength: 2 };
    await Post.collection.dropIndex("user_1_date_-1").catch(() => {}); // Remove old index if exists
    await Post.collection.createIndex(
      { user: 1, date: -1 },
      { collation: userCollation, name: "user_ci_date" },
    );

    console.log(
      "✓ Database indexes created (including case-insensitive user index)",
    );
  } catch (e) {
    console.warn("Index creation warning:", e.message);
  }
}

// =============================
// DATABASE
// =============================

if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI env var");
}

let _connectionPromise = null;
let _mongooseReady = false;

function getConnection() {
  if (!MONGODB_URI) return Promise.reject(new Error("Missing MONGODB_URI"));
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!_connectionPromise) {
    _connectionPromise = mongoose
      .connect(MONGODB_URI, {
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
      })
      .then(async () => {
        if (!_mongooseReady) {
          _mongooseReady = true;
          await ensureAdminAccount();
          await ensureIndexes();
        }
        console.log("MongoDB connected");
      })
      .catch((err) => {
        _connectionPromise = null;
        console.error("MongoDB connection error:", err);
        throw err;
      });
  }
  return _connectionPromise;
}

// Ensure DB is connected before every API request
app.use("/api", async (req, res, next) => {
  try {
    await getConnection();
    next();
  } catch (err) {
    res.status(503).json({ error: "Database unavailable, please try again" });
  }
});
app.use("/api", require("./routes/posts"));
app.use("/api", require("./routes/ml"));
app.use("/api", require("./routes/fyp"));
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/accounts"));
app.use("/api", require("./routes/admin"));
app.use("/api", require("./routes/search"));

// =============================
// START SERVER
// =============================

if (require.main === module) {
  if (
    (process.env.BEHAVIOR_ANALYSIS_ENABLED || "true").toLowerCase() !== "false"
  ) {
    const intervalMs = Math.max(
      Number(process.env.BEHAVIOR_ANALYSIS_INTERVAL_MS) || 15 * 60 * 1000,
      60 * 1000,
    );
    setInterval(() => {
      runBehaviorAnalysisBatch().catch((err) =>
        console.warn("Behavior batch error:", err.message || err),
      );
    }, intervalMs);
  }

  app.listen(PORT, () =>
    console.log(`🚀 Backend running on http://localhost:${PORT}`),
  );
}

module.exports = app;
