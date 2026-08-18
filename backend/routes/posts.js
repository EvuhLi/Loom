const router = require("express").Router();
const nodeFetch = require("node-fetch");
const Post = require("../models/Post");
const Account = require("../models/Account");
const mongoose = require("mongoose");
const ML_SERVICE_URL = process.env.ML_SERVICE_URL;
const { logActivityEvent } = require("../services/behaviorTracking");
const FormData = require("form-data");
const { escapeRegex } = require("../utils/helpers");
const { uploadToS3 } = require("../services/s3");

router.get("/posts/:id/image", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const post = await Post.findById(id)
      .select("_id url")
      .lean()
      .maxTimeMS(2000);

    if (!post || !post.url) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Return just the image URL - gzip compression handles the rest
    res.set("Cache-Control", "public, max-age=604800"); // 7 day cache
    res.json({
      _id: post._id.toString(),
      url: post.url,
    });
  } catch (err) {
    console.error("Image fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

router.get("/posts", async (req, res) => {
  const t0 = Date.now();
  try {
    const { artistId, username, skip, limit } = req.query;
    const skipVal = Math.max(0, parseInt(skip) || 0);
    const limitVal = Math.min(parseInt(limit) || 36, 120);

    let query = {};
    const rawUsername = username ? String(username).trim() : "";
    const normalizedUsername = rawUsername.toLowerCase();
    const artistIdStr = artistId ? String(artistId) : "";
    const hasArtistIdObject =
      artistIdStr && mongoose.Types.ObjectId.isValid(artistIdStr);
    const artistIdOr = [
      ...(hasArtistIdObject
        ? [{ artistId: new mongoose.Types.ObjectId(artistIdStr) }]
        : []),
      ...(artistIdStr ? [{ artistId: artistIdStr }] : []),
    ];
    const userOr = [
      ...(normalizedUsername ? [{ user: normalizedUsername }] : []),
      ...(rawUsername && rawUsername !== normalizedUsername
        ? [{ user: rawUsername }]
        : []),
    ];

    // Prefer a precise artistId lookup, but if both artistId and username are provided
    // allow either to match to avoid empty results when one side is inconsistent.
    if (artistIdOr.length && userOr.length) {
      query = { $or: [...artistIdOr, ...userOr] };
    } else if (artistIdOr.length) {
      // Use direct query when only one condition for optimal index usage
      query = artistIdOr.length === 1 ? artistIdOr[0] : { $or: artistIdOr };
    } else if (userOr.length) {
      query = userOr.length === 1 ? userOr[0] : { $or: userOr };
    }

    const t_query = Date.now();
    const queryBuilder = Post.find(query).select(
      "_id artistId user previewUrl title likes date",
    ); // Minimal fields for grid view

    // Use case-insensitive collation if querying by username
    if (query.user) {
      queryBuilder.collation({ locale: "en", strength: 2 });
    }
    const posts = await queryBuilder
      .sort({ date: -1 })
      .skip(skipVal)
      .limit(limitVal)
      .maxTimeMS(8000)
      .lean();
    console.log(`[Posts] Find query: ${Date.now() - t_query}ms`, query);

    const normalized = posts.map((p) => ({
      _id: String(p._id),
      artistId: p.artistId ? String(p.artistId) : p.artistId,
      user: p.user,
      url: p.previewUrl || p.url || "",
      previewUrl: p.previewUrl || "",
      title: p.title,
      likes: p.likes || 0,
      date: p.date,
      // STRIPPED: description, tags, medium, postCategory, postType, likedBy, processSlides, comments, mlTags
      // Grid view only needs minimal data - fetch full post when opening modal
      // Use /api/posts/:id/full endpoint if full data needed
    }));

    console.log(
      `[Posts] Total time: ${Date.now() - t0}ms, posts: ${posts.length}`,
    );
    // Return array directly (ProfilePage expects this format)
    res.json(normalized);
  } catch (err) {
    console.error("Get Posts Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post("/posts", async (req, res) => {
  try {
    const {
      user,
      artistId,
      url,
      processSlides,
      previewUrl,
      postCategory,
      title,
      description,
      tags,
      mlTags,
      medium,
      postType,
      inReplyToPostId,
    } = req.body;
    // NORMALIZE: Store usernames in lowercase for consistent index-based queries
    const normalizedUser = String(user || "")
      .trim()
      .toLowerCase();
    const resolvedCategory = ["artwork", "process", "sketch"].includes(
      postCategory,
    )
      ? postCategory
      : "artwork";
    const normalizedSlides = Array.isArray(processSlides)
      ? processSlides
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => s.trim())
      : [];
    let coverUrl =
      typeof url === "string" && url.trim()
        ? url.trim()
        : normalizedSlides[0] || "";
    let coverPreviewUrl =
      typeof previewUrl === "string" && previewUrl.trim()
        ? previewUrl.trim()
        : coverUrl;

    if (!normalizedUser || !coverUrl)
      return res.status(400).json({ error: "user and image(s) required" });

    let resolvedArtistId = artistId;
    const resolvedPostType = ["original", "reply", "repost"].includes(postType)
      ? postType
      : "original";
    let resolvedInReplyToPostId = null;
    let parentPostTimestamp = null;

    if (!resolvedArtistId) {
      const account = await Account.findOneAndUpdate(
        { username: normalizedUser },
        { $setOnInsert: { username: normalizedUser } },
        { new: true, upsert: true },
      );
      resolvedArtistId = account._id;
    }

    if (
      resolvedPostType === "reply" &&
      inReplyToPostId &&
      mongoose.Types.ObjectId.isValid(inReplyToPostId)
    ) {
      const parentPost = await Post.findById(inReplyToPostId, "date").lean();
      if (parentPost) {
        resolvedInReplyToPostId = parentPost._id;
        parentPostTimestamp = parentPost.date || null;
      }
    }
    const imageBuffer = coverUrl.startsWith("data:image")
      ? Buffer.from(coverUrl.split(",")[1], "base64")
      : null;
    if (imageBuffer) {
      try {
        const key = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        coverUrl = await uploadToS3(imageBuffer, key);
      } catch (err) {
        console.warn("S3 upload failed, keeping base64:", err.message);
      }
    }
    const previewBuffer = coverPreviewUrl && coverPreviewUrl.startsWith("data:image")?Buffer.from(coverPreviewUrl.split(",")[1], "base64"): null;
    if (previewBuffer){
        try {
        const key = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        coverPreviewUrl = await uploadToS3(previewBuffer, key);
      } catch (err) {
        console.warn("S3 upload failed, keeping base64:", err.message);
      }
    }

    // AUTO-GENERATE ML TAGS if not provided and category is artwork
    let autoGeneratedTags = mlTags;
    if (!mlTags && resolvedCategory === "artwork" && coverUrl) {
      try {
        const form = new FormData();
        form.append("image", imageBuffer, {
          filename: "artwork.jpg",
          contentType: "image/jpeg",
        });

        const mlResponse = await nodeFetch(
          `${ML_SERVICE_URL}/tagging/analyze`,
          {
            method: "POST",
            body: form,
            headers: form.getHeaders(),
            timeout: 10000,
          },
        );

        if (mlResponse.ok) {
          const result = await mlResponse.json();
          autoGeneratedTags =
            result && typeof result === "object" ? result : {};
          console.log("Auto-generated ML tags for new post");
        }
      } catch (err) {
        console.warn(
          "ML tagging failed, continuing without tags:",
          err.message,
        );
        // Continue post creation even if tagging fails
      }
    }

    const newPost = await Post.create({
      artistId: resolvedArtistId,
      user: normalizedUser,
      postCategory: resolvedCategory,
      postType: resolvedPostType,
      inReplyToPostId: resolvedInReplyToPostId,
      originalPostTimestamp: parentPostTimestamp,
      url: coverUrl,
      previewUrl: coverPreviewUrl,
      processSlides: normalizedSlides,
      title: title?.trim() || "",
      description: description?.trim() || "",
      tags: Array.isArray(tags) ? tags : [],
      mlTags:
        resolvedCategory === "artwork"
          ? autoGeneratedTags || {}
          : autoGeneratedTags && typeof autoGeneratedTags === "object"
            ? autoGeneratedTags
            : {},
      medium,
      likedBy: [],
    });

    const account = await Account.findById(
      resolvedArtistId,
      "_id username",
    ).lean();
    await logActivityEvent({
      req,
      eventType:
        resolvedPostType === "reply"
          ? "post_reply"
          : resolvedPostType === "repost"
            ? "post_repost"
            : "post_create",
      account,
      username: normalizedUser,
      post: newPost,
      postType: resolvedPostType,
      inReplyToPostId: resolvedInReplyToPostId,
      originalPostTimestamp: parentPostTimestamp,
      replyTimestamp: resolvedPostType === "reply" ? new Date() : null,
      latencyMs:
        resolvedPostType === "reply" && parentPostTimestamp
          ? Date.now() - new Date(parentPostTimestamp).getTime()
          : null,
      metadata: {
        medium: medium || "",
        postCategory: resolvedCategory,
        slideCount: normalizedSlides.length,
        hasMlTags: Boolean(
          autoGeneratedTags && Object.keys(autoGeneratedTags).length,
        ),
      },
    });

    res.status(201).json(newPost);
  } catch (err) {
    console.error("Create Post Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/posts/:id/full", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const post = await Post.findById(id).lean();
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Return full post with all details
    res.json({
      ...post,
      _id: post._id.toString(),
      artistId: post.artistId?.toString(),
      // processSlides and comments included here (only fetched on-demand)
    });
  } catch (err) {
    console.error("Get Full Post Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// GET POST COMMENTS (PAGINATED)
// =============================
// Fast endpoint to fetch paginated comments for a post
router.get("/posts/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(0, Number(req.query.page) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const skip = page * limit;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Use aggregation to fetch only the comments slice we need
    const result = await Post.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      { $project: { comments: 1 } },
      {
        $facet: {
          metadata: [
            { $project: { count: { $size: { $ifNull: ["$comments", []] } } } },
          ],
          comments: [
            { $unwind: "$comments" },
            { $replaceRoot: { newRoot: "$comments" } },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
          ],
        },
      },
    ]);

    const totalCount = result[0]?.metadata[0]?.count || 0;
    const comments = result[0]?.comments || [];

    res.json({
      comments,
      total: totalCount,
      page,
      limit,
      hasMore: skip + limit < totalCount,
    });
  } catch (err) {
    console.error("Get Comments Error:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// =============================
// LIKE POST
// =============================

router.patch("/posts/:id/like", async (req, res) => {
  try {
    const { id } = req.params;
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username required" });
    }

    const post = await Post.findById(id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const normalizedUsername = username.trim().toLowerCase();

    const alreadyLiked = post.likedBy
      .map((u) => u.toLowerCase())
      .includes(normalizedUsername);

    let updatedPost;

    if (alreadyLiked) {
      // 🔥 UNLIKE
      updatedPost = await Post.findByIdAndUpdate(
        id,
        {
          $pull: { likedBy: normalizedUsername },
          $inc: { likes: -1 },
        },
        { new: true },
      );
    } else {
      // 🔥 LIKE
      updatedPost = await Post.findByIdAndUpdate(
        id,
        {
          $addToSet: { likedBy: normalizedUsername },
          $inc: { likes: 1 },
        },
        { new: true },
      );
    }

    if (!alreadyLiked) {
      try {
        const allPosts = await Post.distinct("_id");
        const allPostIds = allPosts.map((id) => id.toString());
        await nodeFetch(`${ML_SERVICE_URL}/recommendation/interaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: normalizedUsername,
            post_id: String(id),
            interaction_type: "like",
            all_post_ids: allPostIds,
          }),
        });
      } catch (mlErr) {
        console.warn(
          "Like interaction tracking failed:",
          mlErr.message || mlErr,
        );
      }
    }

    const likeAccount = await Account.findOne(
      { username: new RegExp(`^${escapeRegex(normalizedUsername)}$`, "i") },
      "_id username",
    ).lean();
    await logActivityEvent({
      req,
      eventType: alreadyLiked ? "unlike" : "like",
      account: likeAccount,
      username: normalizedUsername,
      post: updatedPost,
      postType: updatedPost?.postType || "original",
      inReplyToPostId: updatedPost?.inReplyToPostId || null,
      originalPostTimestamp: updatedPost?.originalPostTimestamp || null,
      metadata: { alreadyLiked },
    });

    res.json(updatedPost);
  } catch (err) {
    console.error("Like Toggle Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// =============================
// DELETE POST
// =============================
router.delete("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Check if the ID is a valid MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // 2. Find and delete the post
    const deletedPost = await Post.findByIdAndDelete(id);

    if (!deletedPost) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.status(200).json({ message: "Post deleted successfully", id });
  } catch (err) {
    console.error("Delete Post Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/posts/:id/comment", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, text } = req.body;

    if (!username || !text) {
      return res.status(400).json({ error: "username and text required" });
    }

    const comment = {
      user: username,
      text: String(text),
      createdAt: new Date(),
    };

    const updated = await Post.findByIdAndUpdate(
      id,
      { $push: { comments: comment } },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json(updated.toObject ? updated.toObject() : updated);

    (async () => {
      try {
        const post = await Post.findById(id, "date").lean();

        nodeFetch(`${ML_SERVICE_URL}/recommendation/interaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: String(username).toLowerCase(),
            post_id: String(id),
            interaction_type: "comment",
          }),
        }).catch((e) => console.warn("ML tracking failed:", e.message));

        const commentAccount = await Account.findOne(
          { username: new RegExp(`^${escapeRegex(String(username))}$`, "i") },
          "_id username",
        ).lean();

        const parentTimestamp = post?.date ? new Date(post.date) : null;
        await logActivityEvent({
          req,
          eventType: "comment_create",
          account: commentAccount,
          username,
          post: updated,
          postType: "reply",
          inReplyToPostId: post?._id || null,
          originalPostTimestamp: parentTimestamp,
          replyTimestamp: comment.createdAt,
          latencyMs: parentTimestamp
            ? comment.createdAt.getTime() - parentTimestamp.getTime()
            : null,
          metadata: { textLength: String(text).length },
        }).catch((e) => console.warn("Activity logging failed:", e.message));
      } catch (bgErr) {
        console.warn("Background operation error:", bgErr.message);
      }
    })();
  } catch (err) {
    console.error("Add Comment Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
