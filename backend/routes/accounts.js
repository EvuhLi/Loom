const router = require("express").Router();
const mongoose = require("mongoose");
const Account = require("../models/Account");
const { logActivityEvent } = require("../services/behaviorTracking");
const { escapeRegex } = require("../utils/helpers");

router.get("/accounts/id/:id", async (req, res) => {
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

router.get("/accounts/search", async (req, res) => {
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

router.patch("/accounts/:id/profile-pic", async (req, res) => {
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
      return res.status(403).json({ error: "You can only update your own profile picture" });
    }
    if (!profilePic || typeof profilePic !== "string") {
      return res.status(400).json({ error: "profilePic is required" });
    }

    const updated = await Account.findByIdAndUpdate(id, { profilePic }, { new: true });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  } catch (err) {
    console.error("Profile Pic Update Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/accounts/:username", async (req, res) => {
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

router.patch("/accounts/:id/bio", async (req, res) => {
  try {
    const { id } = req.params;
    const { bio } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid target account ID" });
    }

    const updated = await Account.findByIdAndUpdate(id, { bio }, { new: true });
    if (!updated) {
      console.error(`[Bio Update] Account not found for ID: ${id}`);
      return res.status(404).json({ error: "Account not found" });
    }
    console.log(`[Bio Update] Successfully updated bio for account ${id}`);
    res.json(updated);
  } catch (err) {
    console.error("Bio Update Error:", err?.message || err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/accounts/:username/follow", async (req, res) => {
  try {
    const { username } = req.params;
    const { follower } = req.body;

    if (!follower || !username) {
      return res.status(400).json({ error: "follower and username required" });
    }

    const target = await Account.findOne({ username });
    if (!target) return res.status(404).json({ error: "Target account not found" });

    const followerAccount = await Account.findOneAndUpdate(
      { username: follower },
      { $setOnInsert: { username: follower } },
      { new: true, upsert: true },
    );

    const targetId = target._id;
    const alreadyFollowing = (followerAccount.following || []).some(
      (id) => String(id) === String(targetId),
    );

    let updatedFollower, updatedTarget;

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
      metadata: { targetUsername: username, targetId: String(targetId) },
    });

    res.json({ target: updatedTarget, follower: updatedFollower, isFollowing: !alreadyFollowing });
  } catch (err) {
    console.error("Follow Toggle Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/accounts", async (req, res) => {
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

module.exports = router;
