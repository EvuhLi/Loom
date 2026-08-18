const router = require("express").Router();
const Account = require("../models/Account");
const { escapeRegex } = require("../utils/helpers");

router.get("/search/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const query = { role: { $ne: "admin" } };
    if (search) {
      query.username = new RegExp(escapeRegex(search), "i");
    }

    const users = await Account.find(query, "_id username bio followersCount createdAt")
      .sort({ username: 1 })
      .limit(limit)
      .lean();

    res.json(users);
  } catch (err) {
    console.error("User search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
