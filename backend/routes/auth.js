const router = require("express").Router();
const Account = require("../models/Account");
const { logActivityEvent } = require("../services/behaviorTracking");
const { hashPassword, verifyPassword, createAdminSessionToken } = require("../middleware/auth");
const { escapeRegex } = require("../utils/helpers");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "loomadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "loomadmin";

router.post("/auth/register", async (req, res) => {
  try {
    const usernameRaw = (req.body.username || "").trim();
    const emailRaw = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!usernameRaw || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (String(usernameRaw).toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
      return res.status(403).json({ error: "This username is reserved" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const usernameRegex = new RegExp(`^${escapeRegex(usernameRaw)}$`, "i");

    const existingUsername = await Account.findOne({ username: usernameRegex });
    if (existingUsername) {
      return res.status(409).json({ error: "Username is taken, choose another" });
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

router.post("/auth/login", async (req, res) => {
  try {
    const usernameRaw = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!usernameRaw || !password) {
      return res.status(400).json({ error: "Username and password are required" });
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

module.exports = router;
