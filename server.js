import "dotenv/config";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.SNAP_REDIRECT_URI || `${BASE_URL}/auth/callback`;
const SNAP_CLIENT_ID = process.env.SNAP_CLIENT_ID;
const SNAP_CLIENT_SECRET = process.env.SNAP_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  name: "snaptrack.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many searches. Please wait a minute and try again." }
});

function configReady() {
  return Boolean(SNAP_CLIENT_ID && SNAP_CLIENT_SECRET);
}

function requireSnapConfig(req, res, next) {
  if (!configReady()) {
    return res.status(503).json({
      error: "Snap API credentials are not configured. The site owner must configure an approved Snap Public Profile API app."
    });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.snapAccessToken) {
    return res.status(401).json({ error: "Connect an approved Snapchat API account first." });
  }
  next();
}

app.get("/api/status", (req, res) => {
  res.json({
    configured: configReady(),
    connected: Boolean(req.session.snapAccessToken),
    provider: "Snapchat Public Profile API",
    mode: "official-public-profiles-only"
  });
});

app.get("/auth/snapchat", requireSnapConfig, (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const url = new URL("https://accounts.snapchat.com/login/oauth2/authorize");
  url.searchParams.set("client_id", SNAP_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snapchat-profile-api");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth/callback", requireSnapConfig, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect("/?connect=cancelled");
  if (!code || !state || !req.session.oauthState ||
      !crypto.timingSafeEqual(Buffer.from(String(state)), Buffer.from(req.session.oauthState))) {
    return res.status(400).send("OAuth state check failed. Return to SNAPTRACK and connect again.");
  }
  delete req.session.oauthState;

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: SNAP_CLIENT_ID,
      client_secret: SNAP_CLIENT_SECRET,
      code: String(code),
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Snap OAuth token exchange failed:", tokenData.error || tokenResponse.status);
      return res.redirect("/?connect=failed");
    }

    req.session.snapAccessToken = tokenData.access_token;
    req.session.snapRefreshToken = tokenData.refresh_token || null;
    req.session.snapTokenExpiresAt = Date.now() + (Number(tokenData.expires_in || 1800) * 1000);
    res.redirect("/?connect=success");
  } catch (err) {
    console.error("OAuth callback error:", err.message);
    res.redirect("/?connect=failed");
  }
});

async function refreshAccessToken(req) {
  if (!req.session.snapRefreshToken) return false;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: SNAP_CLIENT_ID,
    client_secret: SNAP_CLIENT_SECRET,
    refresh_token: req.session.snapRefreshToken
  });
  const response = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) return false;
  req.session.snapAccessToken = data.access_token;
  if (data.refresh_token) req.session.snapRefreshToken = data.refresh_token;
  req.session.snapTokenExpiresAt = Date.now() + (Number(data.expires_in || 1800) * 1000);
  return true;
}

async function snapGet(req, url) {
  if (req.session.snapTokenExpiresAt && Date.now() > req.session.snapTokenExpiresAt - 60000) {
    const refreshed = await refreshAccessToken(req);
    if (!refreshed) {
      req.session.snapAccessToken = null;
      throw Object.assign(new Error("Snap authorization expired. Connect again."), { status: 401 });
    }
  }

  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${req.session.snapAccessToken}` }
  });

  if (response.status === 401 && await refreshAccessToken(req)) {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${req.session.snapAccessToken}` }
    });
  }
  if (response.status === 401) {
    req.session.snapAccessToken = null;
    throw Object.assign(new Error("Snap authorization expired. Connect again."), { status: 401 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.display_message || data.debug_message || `Snap API returned ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return data;
}

app.get("/api/search", searchLimiter, requireSnapConfig, requireAuth, async (req, res) => {
  const query = String(req.query.q || "").trim().replace(/^@+/, "");
  if (!query || query.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(query)) {
    return res.status(400).json({ error: "Enter a valid Snapchat username." });
  }

  try {
    // Snap's public search endpoint returns only eligible official public profiles.
    // Search both person and business categories; the API requires an approved token.
    const base = "https://businessapi.snapchat.com/public/v1/public_profiles/search";
    const params = new URLSearchParams({
      query,
      limit: "100",
      tier: "TIER_PUBLIC_OFFICIAL"
    });

    const [people, businesses] = await Promise.all([
      snapGet(req, `${base}?${params.toString()}&category=CATEGORY_PERSON`),
      snapGet(req, `${base}?${params.toString()}&category=CATEGORY_BUSINESS`)
    ]);

    const entries = [...(people.public_profiles || []), ...(businesses.public_profiles || [])]
      .filter(item => item.sub_request_status === "SUCCESS" && item.public_profile)
      .map(item => item.public_profile);

    const exact = entries.filter(profile =>
      String(profile.snap_user_name || "").toLowerCase() === query.toLowerCase()
    );

    const profiles = (exact.length ? exact : entries).slice(0, 10).map(profile => ({
      id: profile.id || null,
      username: profile.snap_user_name || null,
      displayName: profile.display_name || null,
      description: profile.description || null,
      category: profile.category || null,
      website: profile.website || null,
      subscriberCount: Number.isFinite(Number(profile.subscriber_count))
        ? Number(profile.subscriber_count) : null,
      imageUrl: profile.logo_urls?.original_logo_url || null,
      profileTier: profile.profile_tier || null,
      source: "Snapchat Public Profile API"
    }));

    res.set("Cache-Control", "no-store");
    res.json({
      query,
      profiles,
      exactMatch: exact.length > 0,
      note: profiles.length
        ? "Results are limited to profiles returned by Snap's official public-profile search."
        : "No eligible official public profile was returned. This does not prove the Snapchat account does not exist.",
      unavailable: {
        snapscore: "Not provided by this public search endpoint",
        lastActive: "Not provided by this public search endpoint",
        friends: "Private / not provided by this public search endpoint"
      }
    });
  } catch (err) {
    console.error("Snap public profile search failed:", err.message);
    res.status(err.status || 502).json({ error: err.message || "Unable to search Snap public profiles." });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("snaptrack.sid");
    res.json({ ok: true });
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(express.static("public", { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`SNAPTRACK running at ${BASE_URL}`);
});
