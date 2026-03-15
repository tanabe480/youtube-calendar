const STORAGE_KEY = "youtube_channels";
const SEARCH_CACHE_KEY = "youtube_search_cache";
const LIVE_CACHE_KEY = "youtube_live_cache";
const LAST_RENDERED_LIVES_KEY = "youtube_last_rendered_lives";

const SEARCH_CACHE_TTL = 1000 * 60 * 60 * 24; // 24時間
const LIVE_CACHE_TTL = 1000 * 60 * 10; // 10分
const REFRESH_COOLDOWN = 5000; // 5秒

let isRefreshing = false;
let currentSearchResults = [];

function normalizeText(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[・･]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/* ========= キャッシュ共通 ========= */
function loadCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function saveCache(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isFresh(timestamp, ttl) {
  return Date.now() - timestamp < ttl;
}

/* 閉じる前のキャッシュを保存 */
function saveLastRenderedLives(lives) {
  localStorage.setItem(LAST_RENDERED_LIVES_KEY, JSON.stringify(lives));
}
function getLastRenderedLives() {
  try {
    return JSON.parse(localStorage.getItem(LAST_RENDERED_LIVES_KEY)) || [];
  } catch {
    return [];
  }
}

/* ========= チャンネル検索 ========= */
async function searchChannels(keyword) {
  const normalizedKeyword = normalizeText(keyword);
  const cache = loadCache(SEARCH_CACHE_KEY);

  if (
    cache[normalizedKeyword] &&
    isFresh(cache[normalizedKeyword].timestamp, SEARCH_CACHE_TTL)
  ) {
    return cache[normalizedKeyword].items;
  }

  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=channel&q=${encodeURIComponent(keyword)}` +
    `&maxResults=5&key=${API_KEY}`;

  const res = await fetch(url);

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Channel search API error:", res.status, errorText);
    return [];
  }

  const data = await res.json();
  if (!data.items) return [];

  const items = data.items
    .map(item => ({
      channelId: item.id.channelId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url || ""
    }))
    .filter(ch => normalizeText(ch.title).includes(normalizedKeyword));

  cache[normalizedKeyword] = {
    timestamp: Date.now(),
    items
  };
  saveCache(SEARCH_CACHE_KEY, cache);

  return items;
}

/* ========= 検索結果表示 ========= */
function renderSearchResults(results) {
  currentSearchResults = results;
  const ul = document.getElementById("searchResult");
  ul.innerHTML = "";

  if (results.length === 0) {
    ul.innerHTML = `<li class="liveEmpty">検索結果がありません</li>`;
    return;
  }
  results.forEach(ch => {
    const li = document.createElement("li");

    li.innerHTML = `
      <img src="${ch.thumbnail}" width="32" alt="">
      <span>${ch.title}</span>
    `;

    const btn = document.createElement("button");
    const registered = isRegisteredChannel(ch.channelId);

    btn.textContent = registered ? "登録済" : "登録";
    btn.disabled = registered;

    btn.onclick = async () => {
      const added = addChannel(ch);
      renderChannelList();

      if (added) {
        await fetchAllUpcomingLives({ force: false });
      }

      // 検索結果も更新
      renderSearchResults(currentSearchResults);
    };

    li.appendChild(btn);
    ul.appendChild(li);
  });
}

document.getElementById("searchBtn").addEventListener("click", async () => {
  const input = document.getElementById("channelInput");
  const keyword = input.value.trim();
  if (!keyword) return;

  const results = await searchChannels(keyword);
  renderSearchResults(results);
});

const channelInput = document.getElementById("channelInput");
const clearInputBtn = document.getElementById("clearInputBtn");

function toggleClearButton() {
  clearInputBtn.style.display = channelInput.value ? "flex" : "none";
}

channelInput.addEventListener("input", toggleClearButton);

clearInputBtn.addEventListener("click", () => {
  channelInput.value = "";
  toggleClearButton();
  channelInput.focus();
});

toggleClearButton();

/* ========= チャンネル保存 ========= */
function getChannels() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

function saveChannels(channels) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}

function isRegisteredChannel(channelId) {
  return getChannels().some(c => c.id === channelId);
}

function addChannel(channel) {
  const channels = getChannels();

  if (channels.find(c => c.id === channel.channelId)) {
    return false;
  }

  channels.push({
    id: channel.channelId,
    title: channel.title,
    thumbnail: channel.thumbnail
  });
  saveChannels(channels);
  return true;
}

function removeChannel(channelId) {
  const channels = getChannels().filter(c => c.id !== channelId);
  saveChannels(channels);

  const liveCache = loadCache(LIVE_CACHE_KEY);
  delete liveCache[channelId];
  saveCache(LIVE_CACHE_KEY, liveCache);
}

/* ========= チャンネル一覧表示 ========= */
function renderChannelList() {
  const ul = document.getElementById("channelList");
  ul.innerHTML = "";

  const channels = getChannels();

  if (channels.length === 0) {
    ul.innerHTML = `<li class="liveEmpty">登録済みチャンネルはありません</li>`;
    return;
  }

  channels.forEach(ch => {
    const li = document.createElement("li");

    li.innerHTML = `
      <img src="${ch.thumbnail}" width="24" alt="">
      <span>${ch.title}</span>
    `;

    const btn = document.createElement("button");
    btn.textContent = "削除";
    btn.onclick = () => {
      removeChannel(ch.id);
      renderChannelList();

      // API再取得せず、残っているキャッシュだけで再描画
      renderLivesFromCacheOnly();

      // 検索結果のボタン表示も更新
      renderSearchResults(currentSearchResults);
    };

    li.appendChild(btn);
    ul.appendChild(li);
  });
}

/* ========= 配信予定取得 ========= */
async function fetchUpcomingByChannel(channelId, { force = false } = {}) {
  const liveCache = loadCache(LIVE_CACHE_KEY);

  if (
    !force &&
    liveCache[channelId] &&
    isFresh(liveCache[channelId].timestamp, LIVE_CACHE_TTL)
  ) {
    return liveCache[channelId].items;
  }

  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=video&eventType=upcoming` +
    `&channelId=${channelId}&maxResults=5&key=${API_KEY}`;

  const searchRes = await fetch(searchUrl);

  if (!searchRes.ok) {
    const errorText = await searchRes.text();
    console.error("Search API error:", searchRes.status, channelId, errorText);

    // 失敗時は古いキャッシュがあればそれを返す
    if (liveCache[channelId]?.items) {
      return liveCache[channelId].items;
    }
    return [];
  }

  const searchData = await searchRes.json();
  if (!searchData.items) return [];

  const videoIds = searchData.items
    .map(item => item.id.videoId)
    .filter(Boolean)
    .join(",");

  if (!videoIds) {
    liveCache[channelId] = {
      timestamp: Date.now(),
      items: []
    };
    saveCache(LIVE_CACHE_KEY, liveCache);
    return [];
  }

  const videoUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${videoIds}&key=${API_KEY}`;

  const videoRes = await fetch(videoUrl);

  if (!videoRes.ok) {
    const errorText = await videoRes.text();
    console.error("Videos API error:", videoRes.status, channelId, errorText);

    if (liveCache[channelId]?.items) {
      return liveCache[channelId].items;
    }
    return [];
  }

  const videoData = await videoRes.json();

  const items = (videoData.items || [])
  .filter(v => {
    const details = v.liveStreamingDetails;
    if (!details?.scheduledStartTime) return false;

    // 終了済み配信は除外
    if (details.actualEndTime) return false;

    return true;
  })
  .map(video => ({
    title: video.snippet.title,
    channelTitle: video.snippet.channelTitle,
    videoId: video.id,
    startTime: video.liveStreamingDetails.scheduledStartTime,
    channelId,
    isLive: !!video.liveStreamingDetails.actualStartTime
  }));

  liveCache[channelId] = {
    timestamp: Date.now(),
    items
  };
  saveCache(LIVE_CACHE_KEY, liveCache);

  return items;
}

/* ========= キャッシュだけで表示 ========= */
function renderLivesFromCacheOnly() {
  const channels = getChannels();
  const channelIds = new Set(channels.map(ch => ch.id));
  const liveCache = loadCache(LIVE_CACHE_KEY);

  let allLives = Object.entries(liveCache)
    .filter(([channelId]) => channelIds.has(channelId))
    .flatMap(([, value]) => value.items || []);

  allLives.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  renderLives(allLives);
}

/* ========= 全チャンネルまとめ ========= */
async function fetchAllUpcomingLives({ force = false } = {}) {
  const area = document.getElementById("liveList");
  area.innerHTML = "読み込み中…";

  const channels = getChannels();

  if (channels.length === 0) {
    area.innerHTML = `<div class="liveEmpty">配信予定はありません</div>`;
    return;
  }

  try {
    const results = await Promise.all(
      channels.map(ch => fetchUpcomingByChannel(ch.id, { force }))
    );

    let allLives = results.flat();

    allLives.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    renderLives(allLives);
  } catch (e) {
    console.error(e);
    area.textContent = "取得中にエラーが発生しました";
  }
}

/* ========= 更新ボタン用 ========= */
async function refreshUpcomingLives() {
  if (isRefreshing) return;

  isRefreshing = true;
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    await fetchAllUpcomingLives({ force: true });
  } finally {
    setTimeout(() => {
      isRefreshing = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }, REFRESH_COOLDOWN);
  }
}

/* ========= ICS生成 ========= */
function createICS(live) {
  const start = new Date(live.startTime);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const formatDate = (date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  /* ※インデントそろえるとエラーになる */
  const icsContent =
`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:${live.title}
DTSTART:${formatDate(start)}
DTEND:${formatDate(end)}
DESCRIPTION:${live.channelTitle}
URL:https://www.youtube.com/watch?v=${live.videoId}
END:VEVENT
END:VCALENDAR`;
  return icsContent;
}

function downloadICS(live) {
  const ics = createICS(live);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "youtube_live.ics";

  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========= 表示 ========= */
function renderLives(lives) {
  saveLastRenderedLives(lives);
  const area = document.getElementById("liveList");
  area.innerHTML = "";

  if (lives.length === 0) {
    area.innerHTML = `<div class="liveEmpty">配信予定はありません</div>`;
    return;
  }

  lives.forEach(live => {
    const start = new Date(live.startTime);
    const week = ["日","月","火","水","木","金","土"];
    const y = start.getFullYear();
    const m = start.getMonth() + 1;
    const d = start.getDate();
    const w = week[start.getDay()];
    const hh = start.getHours().toString().padStart(2, "0");
    const mm = start.getMinutes().toString().padStart(2, "0");
    const dateStr = `${y}年${m}月${d}日(${w}) ${hh}:${mm}`;
    const card = document.createElement("div");
    card.className = "liveCard";

    card.innerHTML = `
      <div class="liveDate">${dateStr}</div>
      <div class="liveTitle">${live.title}</div>
      <div class="liveChannel">${live.channelTitle}</div>
      <a class="liveLink" href="https://www.youtube.com/watch?v=${live.videoId}" target="_blank" rel="noopener">
        ▷YouTubeで見る
      </a>
      <button class="calendarBtn">📅 カレンダー追加</button>
    `;

    card.querySelector(".calendarBtn")
      .addEventListener("click", () => downloadICS(live));

    area.appendChild(card);
  });
}

/* ========= 初期実行 ========= */
renderChannelList();
renderLives(getLastRenderedLives());

const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", refreshUpcomingLives);
}
