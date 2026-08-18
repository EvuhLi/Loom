const router = require("express").Router();
const nodeFetch = require("node-fetch");
const Post = require("../models/Post");

const ML_SERVICE_URL_RAW = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
const ML_SERVICE_URL = /^https?:\/\//i.test(ML_SERVICE_URL_RAW)
  ? ML_SERVICE_URL_RAW
  : `http://${ML_SERVICE_URL_RAW}`;

router.get("/fyp", async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 30);
    const page = Math.max(parseInt(req.query.page) || 0, 0);
    const skip = page * limit;

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
    console.log(`[FYP] Query time: ${Date.now() - t_query}ms, posts: ${posts.length}`);

    if (!posts.length) return res.json([]);

    const serializedPosts = posts.map((p) => ({
      _id: p._id.toString(),
      artistId: p.artistId?.toString(),
      user: p.user,
      title: p.title,
      imageUrl: `/api/posts/${p._id}/image`,
      previewUrl: p.previewUrl || "",
      likes: p.likes || 0,
      date: p.date,
    }));

    console.log(`[FYP] Total time: ${Date.now() - t0}ms`);
    res.set("Cache-Control", "public, max-age=30");
    return res.json(serializedPosts);
  } catch (err) {
    console.error("FYP Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/interaction", async (req, res) => {
  try {
    const { username, postId, type } = req.body;
    if (!username || !postId || !type) {
      return res.status(400).json({ error: "username, postId, type required" });
    }

    const allPosts = await Post.distinct("_id");
    const allPostIds = allPosts.map((id) => String(id));

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

module.exports = router;
