const router = require("express").Router();
const mongoose = require("mongoose");
const Post = require("../models/Post");
const Account = require("../models/Account");
const ActivityLog = require("../models/ActivityLog");
const Community = require("../models/Community");
const { requireAdmin } = require("../middleware/auth");
const { runBehaviorAnalysisBatch } = require("../services/behaviorAnalysis");
const { escapeRegex } = require("../utils/helpers");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "loomadmin";

router.get("/admin/accounts", requireAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

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
          likesGiven: { $sum: { $cond: [{ $eq: ["$eventType", "like"] }, 1, 0] } },
          commentsMade: { $sum: { $cond: [{ $eq: ["$eventType", "comment_create"] }, 1, 0] } },
          followsGiven: { $sum: { $cond: [{ $eq: ["$eventType", "follow"] }, 1, 0] } },
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
      const followingCount = Array.isArray(account.following) ? account.following.length : 0;
      const botProbability = Math.max(
        0,
        Math.min(1, Number(account.botScore ?? account.behaviorFeatures?.botScore ?? 0)),
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

    return res.json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (err) {
    console.error("Admin list accounts error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/admin/accounts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid account ID" });
    }

    const account = await Account.findById(id).lean();
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    if (String(account.username || "").toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
      return res.status(403).json({ error: "Cannot delete admin account" });
    }

    const usernameRegex = new RegExp(`^${escapeRegex(String(account.username || ""))}$`, "i");

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

    await Account.updateMany({ following: account._id }, { $pull: { following: account._id } });

    const ownedCommunities = await Community.find({ ownerAccountId: account._id });
    for (const community of ownedCommunities) {
      const remainingFollowers = (community.followers || []).filter(
        (fid) => String(fid) !== String(account._id),
      );
      const nextOwnerId = remainingFollowers.length ? remainingFollowers[0] : null;
      if (!nextOwnerId) {
        await Community.deleteOne({ _id: community._id });
        await Account.updateMany(
          { communityFollowing: community._id },
          { $pull: { communityFollowing: community._id } },
        );
        await Post.updateMany({}, { $pull: { communityTags: { communityId: community._id } } });
        continue;
      }
      const nextOwner = await Account.findById(nextOwnerId, "_id username").lean();
      if (!nextOwner) continue;
      await Community.updateOne(
        { _id: community._id },
        {
          $set: {
            ownerAccountId: nextOwner._id,
            ownerUsername: String(nextOwner.username || "").toLowerCase(),
            followers: remainingFollowers,
          },
          $pull: { pendingRequests: { requesterAccountId: account._id } },
        },
      );
      await Post.updateMany(
        { "communityTags.communityId": community._id },
        { $set: { "communityTags.$[elem].ownerAccountId": nextOwner._id } },
        { arrayFilters: [{ "elem.communityId": community._id }] },
      );
    }

    await Community.updateMany(
      {},
      { $pull: { followers: account._id, pendingRequests: { requesterAccountId: account._id } } },
    );

    await Account.deleteOne({ _id: account._id });

    await Account.updateMany({}, { $set: { followersCount: 0 } });
    const followerAgg = await Account.aggregate([
      { $unwind: "$following" },
      { $group: { _id: "$following", count: { $sum: 1 } } },
    ]);
    if (followerAgg.length) {
      await Account.bulkWrite(
        followerAgg.map((r) => ({
          updateOne: { filter: { _id: r._id }, update: { $set: { followersCount: r.count } } },
        })),
      );
    }

    return res.json({ ok: true, deletedAccountId: id, username: account.username });
  } catch (err) {
    console.error("Admin delete account error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/behavior/recompute", async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 200, 5000);
    const result = await runBehaviorAnalysisBatch(limit);
    res.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err) {
    console.error("Behavior recompute error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
