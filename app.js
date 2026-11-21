const $ = (selector) => document.querySelector(selector);
const statusEl = $("#apiState");
const connectButton = $("#connectButton");
const connectHint = $("#connectHint");
const form = $("#searchForm");
const searchButton = $("#searchButton");
const message = $("#message");
const results = $("#results");

function safeText(value) {
  return value == null || value === "" ? "Not provided" : String(value);
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    statusEl.textContent = data.connected ? "API CONNECTED" : (data.configured ? "NOT CONNECTED" : "API NOT CONFIGURED");
    connectButton.disabled = !data.configured;
    connectHint.textContent = !data.configured
      ? "Site owner must configure approved Snap API credentials"
      : data.connected ? "Authorized session active" : "Snap API approval required";
    connectButton.textContent = data.connected ? "Reconnect Snap API" : "Connect approved Snap API";
  } catch {
    statusEl.textContent = "SERVER UNAVAILABLE";
    connectButton.disabled = true;
  }
}

connectButton.addEventListener("click", () => {
  window.location.href = "/auth/snapchat";
});

function renderProfiles(data) {
  results.replaceChildren();
  $("#resultCount").textContent = `${data.profiles.length} RESULT(S)`;
  if (!data.profiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const title = document.createElement("b");
    title.textContent = "No eligible public profile returned";
    const note = document.createElement("p");
    note.textContent = data.note;
    empty.append(title, note);
    results.append(empty);
    return;
  }

  for (const profile of data.profiles) {
    const card = document.createElement("article");
    card.className = "profile-card";

    let avatar;
    if (profile.imageUrl && /^https:\/\//i.test(profile.imageUrl)) {
      avatar = document.createElement("img");
      avatar.className = "avatar";
      avatar.src = profile.imageUrl;
      avatar.alt = "";
      avatar.referrerPolicy = "no-referrer";
      avatar.onerror = () => {
        const fallback = document.createElement("div");
        fallback.className = "avatar avatar-fallback";
        fallback.textContent = (profile.displayName || profile.username || "?").charAt(0).toUpperCase();
        avatar.replaceWith(fallback);
      };
    } else {
      avatar = document.createElement("div");
      avatar.className = "avatar avatar-fallback";
      avatar.textContent = (profile.displayName || profile.username || "?").charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "profile-info";
    const heading = document.createElement("h3");
    heading.textContent = safeText(profile.displayName);
    const handle = document.createElement("div");
    handle.className = "handle";
    handle.textContent = profile.username ? `@${profile.username}` : "Username not provided";
    const description = document.createElement("p");
    description.className = "desc";
    description.textContent = safeText(profile.description);
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const label of [safeText(profile.category), safeText(profile.profileTier)]) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = label;
      chips.append(chip);
    }
    info.append(heading, handle, description, chips);

    card.append(avatar, info);

    const metric = document.createElement("div");
    metric.className = "metric";
    const metricLabel = document.createElement("span");
    metricLabel.textContent = "Public subscribers";
    const metricValue = document.createElement("strong");
    metricValue.textContent = profile.subscriberCount == null
      ? "Not provided by Snap API"
      : Number(profile.subscriberCount).toLocaleString();
    metric.append(metricLabel, metricValue);
    card.append(metric);

    if (profile.website) {
      const link = document.createElement("a");
      link.className = "profile-link";
      link.href = profile.website;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Public website ↗";
      card.append(link);
    }
    results.append(card);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#username").value.trim().replace(/^@+/, "");
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(query)) {
    message.textContent = "Enter a valid username.";
    return;
  }

  searchButton.disabled = true;
  message.textContent = "Searching Snapchat's official public-profile directory…";
  results.innerHTML = '<div class="empty"><b>Searching…</b><p>Waiting for the authorized Snap API response.</p></div>';
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();
    if (response.status === 401) {
      message.textContent = "Connect the approved Snap API account before searching.";
      results.innerHTML = '<div class="empty"><b>Authorization required</b><p>Use the connect button above.</p></div>';
    } else if (!response.ok) {
      throw new Error(data.error || "Search failed.");
    } else {
      message.textContent = data.note;
      renderProfiles(data);
    }
  } catch (error) {
    message.textContent = error.message;
    results.innerHTML = '<div class="empty"><b>Could not complete search</b><p>Check API approval, server logs and connection, then try again.</p></div>';
  } finally {
    searchButton.disabled = false;
  }
});

const params = new URLSearchParams(location.search);
if (params.has("connect")) {
  const value = params.get("connect");
  message.textContent = value === "success" ? "Snap API authorization completed." :
    value === "cancelled" ? "Authorization was cancelled." :
    "Authorization failed. Check API setup and try again.";
  history.replaceState({}, "", "/");
}
refreshStatus();
