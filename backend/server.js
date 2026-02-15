require('dotenv').config(); // Loads your HF_API_TOKEN from .env
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Ensure you have node-fetch installed
const mongoose = require('mongoose');
const Post = require('./models/Post');
const Account = require('./models/Account');

const app = express();

// Enable CORS so your frontend (on port 5173/3000) can talk to this server (on 3001)
app.use(cors());

// Increase the limit because images sent as strings (Base64) are large
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment. Add it to backend .env');
} else {
  mongoose
    .connect(MONGODB_URI)
    .then(async () => {
      console.log('MongoDB connected');
      try {
        const [titleResult, descResult, tagsResult] = await Promise.all([
          Post.updateMany(
            { title: { $exists: false } },
            { $set: { title: '' } }
          ),
          Post.updateMany(
            { description: { $exists: false } },
            { $set: { description: '' } }
          ),
          Post.updateMany(
            { tags: { $exists: false } },
            { $set: { tags: [] } }
          ),
        ]);
        if (
          titleResult.modifiedCount ||
          descResult.modifiedCount ||
          tagsResult.modifiedCount
        ) {
          console.log(
            `Post backfill complete: title=${titleResult.modifiedCount}, description=${descResult.modifiedCount}, tags=${tagsResult.modifiedCount}`
          );
        }

        const postsMissingArtist = await Post.find({ artistId: { $exists: false } });
        if (postsMissingArtist.length > 0) {
          for (const post of postsMissingArtist) {
            if (!post.user) continue;
            const account = await Account.findOneAndUpdate(
              { username: post.user },
              { $setOnInsert: { username: post.user } },
              { new: true, upsert: true, setDefaultsOnInsert: true }
            );
            if (account?._id) {
              await Post.updateOne(
                { _id: post._id },
                { $set: { artistId: account._id } }
              );
            }
          }
          console.log(`Post artistId backfill complete: ${postsMissingArtist.length}`);
        }
      } catch (err) {
        console.error('Post backfill failed:', err);
      }
    })
    .catch((err) => console.error('MongoDB connection error:', err));
}

const MODEL_URL = "https://router.huggingface.co/hf-inference/models/umm-maybe/AI-image-detector";

app.post('/api/check-ai', async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // 1. Convert Base64 string back into binary Buffer for the AI model
    const imageBuffer = Buffer.from(imageData, 'base64');

    console.log("Sending image to Hugging Face for scanning...");

    // 2. Make the request using the SECRET KEY stored in process.env
    const hfResponse = await fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageBuffer,
    });

    const result = await hfResponse.json();
    
    // 3. Send the AI's answer back to your frontend
    console.log("Scan complete. Sending results back to frontend.");
    res.json(result);

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ date: -1 });
    res.json(posts);
  } catch (error) {
    console.error('Get Posts Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { user, artistId, likes, comments, url, date, title, description, tags, medium } = req.body;
    if (!user || !url) {
      return res.status(400).json({ error: 'user and url are required' });
    }

    let resolvedArtistId = artistId;
    if (!resolvedArtistId) {
      const account = await Account.findOneAndUpdate(
        { username: user },
        { $setOnInsert: { username: user } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      resolvedArtistId = account?._id;
    }

    if (!resolvedArtistId) {
      return res.status(400).json({ error: 'artistId is required' });
    }

    const newPost = await Post.create({
      artistId: resolvedArtistId,
      user,
      likes: likes ?? 0,
      comments: comments ?? [],
      url,
      title: typeof title === 'string' ? title.trim() : '',
      description: typeof description === 'string' ? description.trim() : '',
      tags: Array.isArray(tags)
        ? tags.map((t) => String(t).trim()).filter(Boolean)
        : [],
      medium: typeof medium === 'string' ? medium.trim() : undefined,
      date: date ? new Date(date) : undefined,
    });

    res.status(201).json(newPost);
  } catch (error) {
    console.error('Create Post Error:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// Accounts
app.get('/api/accounts/id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    let account = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      account = await Account.findById(id);
    }

    if (!account) {
      account = await Account.findOne({ _id: id });
    }

    if (!account) {
      account = await Account.findOne({ username: id });
    }

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(account);
  } catch (error) {
    console.error('Get Account By Id Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    let account = await Account.findOne({ username });
    if (!account) {
      account = await Account.create({ username });
    }

    res.json(account);
  } catch (error) {
    console.error('Get Account Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { username, bio, followersCount, following } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const existing = await Account.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'username already exists' });
    }

    const account = await Account.create({
      username,
      bio: typeof bio === 'string' ? bio : undefined,
      followersCount: Number.isFinite(followersCount)
        ? followersCount
        : undefined,
      following: Array.isArray(following) ? following : undefined,
    });

    res.status(201).json(account);
  } catch (error) {
    console.error('Create Account Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.patch('/api/posts/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const delta = Number(req.body?.delta ?? 1);

    const updatedPost = await Post.findByIdAndUpdate(
      id,
      { $inc: { likes: delta } },
      { new: true }
    );

    if (!updatedPost) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(updatedPost);
  } catch (error) {
    console.error('Like Post Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend secure bridge running on port ${PORT}`));