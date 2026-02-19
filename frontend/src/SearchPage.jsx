<<<<<<< HEAD
import React, { useState } from "react";
=======
import React, { useEffect, useState } from "react";
>>>>>>> e61095d (dabest)
import { Link } from "react-router-dom";

const BACKEND_URL = "http://localhost:3001";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

<<<<<<< HEAD
  const handleSearch = async (searchQuery) => {
    if (!searchQuery.trim()) {
      setUsers([]);
      setError("");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const res = await fetch(
        `${BACKEND_URL}/api/search/users?search=${encodeURIComponent(searchQuery)}&limit=50`
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error("Search error:", err);
      setError("Could not search users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (e) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    handleSearch(newQuery);
  };
=======
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        params.set("limit", "30");

        const res = await fetch(`${BACKEND_URL}/api/accounts/search?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to search accounts");
        const results = await res.json();

        if (active) setArtists(Array.isArray(results) ? results : []);
      } catch (err) {
        console.error("Search load error:", err);
        if (active) setError("Could not load artists.");
      } finally {
        if (active) setLoading(false);
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query]);
>>>>>>> e61095d (dabest)

  return (
    <div style={page}>
      <div style={card}>
        <h1 style={title}>Search Artists</h1>
<<<<<<< HEAD
        <p style={subtitle}>Search all users on Loom.</p>
=======
        <p style={subtitle}>Search accounts from MongoDB by username.</p>
>>>>>>> e61095d (dabest)

        <input
          value={query}
          onChange={handleQueryChange}
          placeholder="Search by username..."
          style={input}
        />

        {loading && <p style={meta}>Searching...</p>}
        {error && <p style={errorText}>{error}</p>}
        {!loading && !error && query && (
          <p style={meta}>
<<<<<<< HEAD
            {users.length} result{users.length === 1 ? "" : "s"}
=======
            {artists.length} result{artists.length === 1 ? "" : "s"}
>>>>>>> e61095d (dabest)
          </p>
        )}

        <div style={list}>
<<<<<<< HEAD
          {users.map((user) => {
            const to = `/profile/${encodeURIComponent(user._id)}`;
            return (
              <Link key={user._id} to={to} style={row}>
                <div>
                  <span style={username}>{user.username}</span>
                  {user.bio && <p style={bio}>{user.bio}</p>}
                </div>
                <span style={count}>{user.followersCount || 0} follower{user.followersCount === 1 ? "" : "s"}</span>
=======
          {artists.map((artist) => {
            const artistId = artist._id && typeof artist._id === "object" ? artist._id.$oid : artist._id;
            const profilePath = artistId ? `/profile/${encodeURIComponent(String(artistId))}` : "/profile";
            return (
              <Link key={`${artist.username}-${artistId || "none"}`} to={profilePath} style={row}>
                <span style={username}>{artist.username}</span>
                <span style={count}>{artist.followersCount || 0} followers</span>
>>>>>>> e61095d (dabest)
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const page = {
  minHeight: "calc(100vh - 56px)",
  padding: "84px 20px 20px",
  background: "#f5f1e8",
};

const card = {
  maxWidth: "760px",
  margin: "0 auto",
  background: "#fffdf8",
  border: "2px solid rgba(0,0,0,0.2)",
  borderRadius: "14px",
  padding: "18px",
};

const title = { margin: "0 0 6px", color: "#121212" };
const subtitle = { margin: "0 0 14px", color: "#555", fontSize: "14px" };

const input = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(0,0,0,0.2)",
  marginBottom: "10px",
  fontSize: "14px",
};

const meta = { margin: "0 0 12px", color: "#666", fontSize: "13px" };
const errorText = { margin: "0 0 12px", color: "#b42318", fontSize: "13px" };

const list = { display: "grid", gap: "8px" };

const row = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  textDecoration: "none",
  color: "#111",
  padding: "10px 12px",
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: "10px",
  background: "#fff",
};

const username = { fontWeight: 700 };
const bio = { margin: "4px 0 0", fontSize: "12px", color: "#999" };
const count = { color: "#666", fontSize: "12px" };
