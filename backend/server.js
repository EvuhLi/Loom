require("dotenv").config();

const express = require("express");
const cors = require("cors");
const compression = require("compression");
const mongoose = require("mongoose");
const nodeFetch = require("node-fetch");
const FormData = require("form-data");
const crypto = require("crypto");

const Post = require("./models/Post");
const Account = require("./models/Account");
const ActivityLog = require("./models/ActivityLog");
const AdminSession = require("./models/AdminSession");
const Community = require("./models/Community");
const { logActivityEvent } = require("./services/behaviorTracking");
const { runBehaviorAnalysisBatch } = require("./services/behaviorAnalysis");
const { escapeRegex } = require("./utils/helpers");
const app = express();

app.use(cors());
app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
        return res
          .status(403)
          .json({ error: "Invalid or expired admin session" });
      next();
    })
    .catch(() => res.status(500).json({ error: "Internal Server Error" }));
}

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
// ENV
// =============================

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const ML_SERVICE_URL_RAW =
  process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
const ML_SERVICE_URL = /^https?:\/\//i.test(ML_SERVICE_URL_RAW)
  ? ML_SERVICE_URL_RAW
  : `http://${ML_SERVICE_URL_RAW}`;
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/umm-maybe/AI-image-detector";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "loomadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "loomadmin";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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

// =============================
// AI DETECTION PROXY
// =============================

app.post("/api/check-ai", async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData)
      return res.status(400).json({ error: "No image data provided" });

    if (!HF_API_TOKEN) {
      return res.status(503).json({ error: "HF_API_TOKEN not configured" });
    }

    const imageBuffer = Buffer.from(imageData, "base64");
    console.log("🔍 Checking AI with Hugging Face...");

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
      return res
        .status(502)
        .json({ error: "HF API failed", detail: errorText });
    }

    const result = await hfResponse.json();
    console.log("✅ AI check complete");
    res.json(result);
  } catch (err) {
    console.error("AI check error:", err.message);
    res
      .status(500)
      .json({ error: "Internal Server Error", detail: err.message });
  }
});

// =============================
// ML TAGGING PROXY
// =============================

app.post("/api/analyze", async (req, res) => {
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
      // Graceful fallback: keep post flow working even if tagging service is down.
      return res.json({});
    }

    const result = await mlResponse.json();
    res.json(result && typeof result === "object" ? result : {});
  } catch (err) {
    console.error("Analyze crash:", err.message);
    // Graceful fallback instead of surfacing 500 to frontend.
    res.json({});
  }
});

// =============================
// GET ACCOUNT BY ID
// =============================

app.get("/api/accounts/id/:id", async (req, res) => {
  const t0 = Date.now();
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid account ID" });
    }
    const account = await Account.findById(id);

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`[Accounts/ID] ${id}: ${Date.now() - t0}ms`);
    res.json(account);
  } catch (err) {
    console.error("Get Account By ID Error:", err?.message || err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// FYP RECOMMENDATIONS
// =============================

app.get("/api/fyp", async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 30); // Reduced default to 6
    const page = Math.max(parseInt(req.query.page) || 0, 0);
    const skip = page * limit;

    // Minimal fields for fast initial load (exclude url base64 data)
    const t_query = Date.now();
    const posts = await Post.find(
      {},
      "_id artistId user title previewUrl likes date",
    )
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .maxTimeMS(5000)
      .lean();
    console.log(
      `[FYP] Query time: ${Date.now() - t_query}ms, posts: ${posts.length}`,
    );

    if (!posts.length) return res.json([]);

    // Minimal serialization for speed - send image URLs separately
    const serializedPosts = posts.map((p) => ({
      _id: p._id.toString(),
      artistId: p.artistId?.toString(),
      user: p.user,
      title: p.title,
      imageUrl: `/api/posts/${p._id}/image`, // Lazy load images
      previewUrl: p.previewUrl || "",
      likes: p.likes || 0,
      date: p.date,
    }));

    console.log(`[FYP] Total time: ${Date.now() - t0}ms`);
    res.set("Cache-Control", "public, max-age=30"); // Increased cache time
    return res.json(serializedPosts);
  } catch (err) {
    console.error("FYP Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// =============================
// INTERACTION TRACKING
// =============================

app.post("/api/interaction", async (req, res) => {
  try {
    const { username, postId, type } = req.body;
    if (!username || !postId || !type) {
      return res.status(400).json({ error: "username, postId, type required" });
    }

    const allPosts = await Post.distinct("_id");
    const allPostIds = allPosts.map((p) => String(p._id));

    await nodeFetch(`${ML_SERVICE_URL}/recommendation/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: username,
        post_id: postId,
        interaction_type: type,
        all_post_ids: allPostIds,
      }),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Interaction Error:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// POSTS
// =============================


// =============================
// AUTH
// =============================

app.post("/api/auth/register", async (req, res) => {
  try {
    const usernameRaw = (req.body.username || "").trim();
    const emailRaw = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!usernameRaw || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    if (String(usernameRaw).toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
      return res.status(403).json({ error: "This username is reserved" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const usernameRegex = new RegExp(`^${escapeRegex(usernameRaw)}$`, "i");

    const existingUsername = await Account.findOne({ username: usernameRegex });
    if (existingUsername) {
      return res
        .status(409)
        .json({ error: "Username is taken, choose another" });
    }

    if (emailRaw) {
      const existingEmail = await Account.findOne({ email: emailRaw });
      if (existingEmail) {
        return res.status(409).json({ error: "Email already registered" });
      }
    }

    const newAccount = await Account.create({
      username: usernameRaw,
      email: emailRaw || undefined,
      passwordHash: hashPassword(password),
      profilePic: "",
      bio: "",
      followersCount: 0,
      following: [],
    });

    return res.status(201).json({
      message: "Sign up successful",
      user: {
        id: newAccount._id,
        username: newAccount.username,
        email: newAccount.email || null,
      },
    });
  } catch (err) {
    console.error("Register Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const usernameRaw = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!usernameRaw || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const normalizedUsername = usernameRaw.toLowerCase();
    if (
      normalizedUsername === ADMIN_USERNAME.toLowerCase() &&
      password === ADMIN_PASSWORD
    ) {
      const adminAccount = await Account.findOne({
        username: new RegExp(`^${escapeRegex(ADMIN_USERNAME)}$`, "i"),
      }).lean();
      const adminToken = await createAdminSessionToken();
      return res.json({
        message: "Admin login successful",
        user: {
          id: adminAccount?._id || "admin",
          username: ADMIN_USERNAME,
          role: "admin",
          email: adminAccount?.email || null,
          adminToken,
        },
      });
    }

    const usernameRegex = new RegExp(`^${escapeRegex(usernameRaw)}$`, "i");

    const account = await Account.findOne({
      $or: [{ username: usernameRegex }, { email: usernameRaw.toLowerCase() }],
    });

    if (!account || !verifyPassword(password, account.passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    await logActivityEvent({
      req,
      eventType: "login",
      account,
      username: account.username,
      metadata: { via: "password" },
    });

    return res.json({
      message: "Login successful",
      user: {
        id: account._id,
        username: account.username,
        email: account.email || null,
        role: account.role || "user",
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// ACCOUNTS
// =============================

app.get("/api/accounts/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const query = q ? { username: new RegExp(escapeRegex(q), "i") } : {};

    const results = await Account.find(query)
      .select("_id username bio followersCount profilePic")
      .sort({ username: 1 })
      .limit(limit)
      .lean();

    res.json(results);
  } catch (err) {
    console.error("Account Search Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.patch("/api/accounts/:id/profile-pic", async (req, res) => {
  try {
    const { id } = req.params;
    const { actorAccountId, profilePic } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid target account ID" });
    }

    if (!mongoose.Types.ObjectId.isValid(actorAccountId || "")) {
      return res.status(400).json({ error: "Invalid actor account ID" });
    }

    if (String(id) !== String(actorAccountId)) {
      return res
        .status(403)
        .json({ error: "You can only update your own profile picture" });
    }

    if (!profilePic || typeof profilePic !== "string") {
      return res.status(400).json({ error: "profilePic is required" });
    }

    const updated = await Account.findByIdAndUpdate(
      id,
      { profilePic },
      { new: true },
    );

    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  } catch (err) {
    console.error("Profile Pic Update Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/api/accounts/:username", async (req, res) => {
  const t0 = Date.now();
  try {
    const usernameRaw = String(req.params.username || "").trim();
    const usernameRegex = new RegExp(`^${escapeRegex(usernameRaw)}$`, "i");

    let account = await Account.findOne({ username: usernameRegex });
    if (!account) account = await Account.create({ username: usernameRaw });

    console.log(`[Accounts] ${usernameRaw}: ${Date.now() - t0}ms`);
    res.json(account);
  } catch (err) {
    console.error("Account Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// FOLLOW / UNFOLLOW
// =============================

app.patch("/api/accounts/:id/bio", async (req, res) => {
  try {
    const { id } = req.params;
    const { bio } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid target account ID" });
    }

    const updated = await Account.findByIdAndUpdate(
      id,
      { bio: bio },
      { new: true },
    );

    if (!updated) {
      console.error(`[Bio Update] Account not found for ID: ${id}`);
      return res.status(404).json({ error: "Account not found" });
    }

    console.log(`[Bio Update] Successfully updated bio for account ${id}`);
    res.json(updated);
  } catch (err) {
    console.error("Bio Update Error:", err?.message || err);
    console.error("Bio Update Stack:", err?.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.patch("/api/accounts/:username/follow", async (req, res) => {
  try {
    const { username } = req.params;
    const { follower } = req.body;

    if (!follower || !username) {
      return res.status(400).json({ error: "follower and username required" });
    }

    const target = await Account.findOne({ username });
    if (!target)
      return res.status(404).json({ error: "Target account not found" });

    const followerAccount = await Account.findOneAndUpdate(
      { username: follower },
      { $setOnInsert: { username: follower } },
      { new: true, upsert: true },
    );

    const targetId = target._id;
    const alreadyFollowing = (followerAccount.following || []).some(
      (id) => String(id) === String(targetId),
    );

    let updatedFollower;
    let updatedTarget;

    if (alreadyFollowing) {
      updatedFollower = await Account.findByIdAndUpdate(
        followerAccount._id,
        { $pull: { following: targetId } },
        { new: true },
      );
      updatedTarget = await Account.findByIdAndUpdate(
        targetId,
        { $inc: { followersCount: -1 } },
        { new: true },
      );
    } else {
      updatedFollower = await Account.findByIdAndUpdate(
        followerAccount._id,
        { $addToSet: { following: targetId } },
        { new: true },
      );
      updatedTarget = await Account.findByIdAndUpdate(
        targetId,
        { $inc: { followersCount: 1 } },
        { new: true },
      );
    }

    await logActivityEvent({
      req,
      eventType: alreadyFollowing ? "unfollow" : "follow",
      account: followerAccount,
      username: follower,
      metadata: {
        targetUsername: username,
        targetId: String(targetId),
      },
    });

    res.json({
      target: updatedTarget,
      follower: updatedFollower,
      isFollowing: !alreadyFollowing,
    });
  } catch (err) {
    console.error("Follow Toggle Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// CREATE ACCOUNT
// =============================

app.post("/api/accounts", async (req, res) => {
  try {
    const { username, bio, followersCount } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: "Username required" });
    }

    const existing = await Account.findOne({ username: username.trim() });
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const newAccount = await Account.create({
      username: username.trim(),
      profilePic: "",
      bio: bio || "",
      followersCount: followersCount || 0,
      following: [],
    });

    res.status(201).json(newAccount);
  } catch (err) {
    console.error("Create Account Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// ADMIN PORTAL
// =============================

app.get("/api/admin/accounts", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize) || 25),
    );

    const query = {};
    if (search) {
      query.username = new RegExp(escapeRegex(search), "i");
    }

    const total = await Account.countDocuments(query);
    const accounts = await Account.find(
      query,
      "_id username bio followersCount following botScore behaviorFeatures lastBehaviorComputedAt createdAt",
    )
      .sort({ username: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const accountIds = accounts.map((a) => a._id);

    const postStats = await Post.aggregate([
      { $match: { artistId: { $in: accountIds } } },
      {
        $project: {
          artistId: 1,
          likes: { $ifNull: ["$likes", 0] },
          commentsCount: { $size: { $ifNull: ["$comments", []] } },
        },
      },
      {
        $group: {
          _id: "$artistId",
          postsCount: { $sum: 1 },
          likesReceived: { $sum: "$likes" },
          commentsReceived: { $sum: "$commentsCount" },
        },
      },
    ]);

    const activityStats = await ActivityLog.aggregate([
      { $match: { userId: { $in: accountIds } } },
      {
        $group: {
          _id: "$userId",
          totalEvents: { $sum: 1 },
          likesGiven: {
            $sum: { $cond: [{ $eq: ["$eventType", "like"] }, 1, 0] },
          },
          commentsMade: {
            $sum: { $cond: [{ $eq: ["$eventType", "comment_create"] }, 1, 0] },
          },
          followsGiven: {
            $sum: { $cond: [{ $eq: ["$eventType", "follow"] }, 1, 0] },
          },
          lastActiveAt: { $max: "$timestamp" },
        },
      },
    ]);

    const postMap = new Map(postStats.map((s) => [String(s._id), s]));
    const activityMap = new Map(activityStats.map((s) => [String(s._id), s]));

    const items = accounts.map((account) => {
      const id = String(account._id);
      const ps = postMap.get(id) || {};
      const as = activityMap.get(id) || {};
      const followingCount = Array.isArray(account.following)
        ? account.following.length
        : 0;
      const botProbability = Math.max(
        0,
        Math.min(
          1,
          Number(account.botScore ?? account.behaviorFeatures?.botScore ?? 0),
        ),
      );

      return {
        profile: {
          id,
          username: account.username,
          bio: account.bio || "",
          followersCount: Number(account.followersCount || 0),
          followingCount,
          createdAt: account.createdAt || null,
          lastBehaviorComputedAt: account.lastBehaviorComputedAt || null,
        },
        engagement: {
          postsCount: Number(ps.postsCount || 0),
          likesReceived: Number(ps.likesReceived || 0),
          commentsReceived: Number(ps.commentsReceived || 0),
          likesGiven: Number(as.likesGiven || 0),
          commentsMade: Number(as.commentsMade || 0),
          followsGiven: Number(as.followsGiven || 0),
          totalEvents: Number(as.totalEvents || 0),
          lastActiveAt: as.lastActiveAt || null,
        },
        bot: {
          probability: Number(botProbability.toFixed(4)),
          behaviorFeatures: account.behaviorFeatures || {},
        },
      };
    });

    return res.json({
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    console.error("Admin list accounts error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.delete("/api/admin/accounts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid account ID" });
    }

    const account = await Account.findById(id).lean();
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    if (
      String(account.username || "").toLowerCase() ===
      ADMIN_USERNAME.toLowerCase()
    ) {
      return res.status(403).json({ error: "Cannot delete admin account" });
    }

    const usernameRegex = new RegExp(
      `^${escapeRegex(String(account.username || ""))}$`,
      "i",
    );

    await Post.deleteMany({ artistId: account._id });
    await Post.updateMany(
      {},
      {
        $pull: {
          likedBy: {
            $in: [
              String(account.username || "").toLowerCase(),
              String(account.username || ""),
            ],
          },
          comments: { user: usernameRegex },
        },
      },
    );

    await ActivityLog.deleteMany({
      $or: [{ userId: account._id }, { username: usernameRegex }],
    });

    await Account.updateMany(
      { following: account._id },
      { $pull: { following: account._id } },
    );
    const ownedCommunities = await Community.find({
      ownerAccountId: account._id,
    });
    for (const community of ownedCommunities) {
      const remainingFollowers = (community.followers || []).filter(
        (fid) => String(fid) !== String(account._id),
      );
      const nextOwnerId = remainingFollowers.length
        ? remainingFollowers[0]
        : null;
      if (!nextOwnerId) {
        await Community.deleteOne({ _id: community._id });
        await Account.updateMany(
          { communityFollowing: community._id },
          { $pull: { communityFollowing: community._id } },
        );
        await Post.updateMany(
          {},
          { $pull: { communityTags: { communityId: community._id } } },
        );
        continue;
      }
      const nextOwner = await Account.findById(
        nextOwnerId,
        "_id username",
      ).lean();
      if (!nextOwner) continue;
      await Community.updateOne(
        { _id: community._id },
        {
          $set: {
            ownerAccountId: nextOwner._id,
            ownerUsername: String(nextOwner.username || "").toLowerCase(),
            followers: remainingFollowers,
          },
          $pull: {
            pendingRequests: { requesterAccountId: account._id },
          },
        },
      );
      await Post.updateMany(
        { "communityTags.communityId": community._id },
        {
          $set: {
            "communityTags.$[elem].ownerAccountId": nextOwner._id,
          },
        },
        {
          arrayFilters: [{ "elem.communityId": community._id }],
        },
      );
    }

    await Community.updateMany(
      {},
      {
        $pull: {
          followers: account._id,
          pendingRequests: { requesterAccountId: account._id },
        },
      },
    );

    await Account.deleteOne({ _id: account._id });

    // Recompute followersCount after relationship cleanup.
    await Account.updateMany({}, { $set: { followersCount: 0 } });
    const followerAgg = await Account.aggregate([
      { $unwind: "$following" },
      { $group: { _id: "$following", count: { $sum: 1 } } },
    ]);
    if (followerAgg.length) {
      await Account.bulkWrite(
        followerAgg.map((r) => ({
          updateOne: {
            filter: { _id: r._id },
            update: { $set: { followersCount: r.count } },
          },
        })),
      );
    }

    return res.json({
      ok: true,
      deletedAccountId: id,
      username: account.username,
    });
  } catch (err) {
    console.error("Admin delete account error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/behavior/recompute", async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 200, 5000);
    const result = await runBehaviorAnalysisBatch(limit);
    res.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err) {
    console.error("Behavior recompute error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// START SERVER
// =============================

// Public search users endpoint
app.get("/api/search/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const query = { role: { $ne: "admin" } };
    if (search) {
      query.username = new RegExp(escapeRegex(search), "i");
    }

    const users = await Account.find(
      query,
      "_id username bio followersCount createdAt",
    )
      .sort({ username: 1 })
      .limit(limit)
      .lean();

    res.json(users);
  } catch (err) {
    console.error("User search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

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
