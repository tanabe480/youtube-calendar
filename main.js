const STORAGE_KEY = "youtube_channels";

function normalizeText(text) {
  return text
    .normalize("NFKC")           // 全角半角統一
    .toLowerCase()
    .replace(/[・･]/g, "")       // 中点削除
    .replace(/\s+/g, "")         // 空白削除
    .replace(/[^\p{L}\p{N}]/gu, ""); // 記号削除（日本語OK）
}

/* ========= チャンネル検索 ========= */
async function searchChannels(keyword) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=channel&q=${encodeURIComponent(keyword)}` +
    `&maxResults=5&key=${API_KEY}`;

  const res = await fetch(url);

  if (!res.ok) {
    console.error("Channel search API error");
    return [];
  }

  const data = await res.json();
  if (!data.items) return [];

  // 正規化した検索ワード
  const normalizedKeyword = normalizeText(keyword);

  return data.items
    .map(item => ({
      channelId: item.id.channelId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.default.url
    }))
    .filter(ch =>
      normalizeText(ch.title).includes(normalizedKeyword)
    );
}


/* ========= 検索結果表示 ========= */
function renderSearchResults(results) {
  const ul = document.getElementById("searchResult");
  ul.innerHTML = "";

  results.forEach(ch => {
    const li = document.createElement("li");

    li.innerHTML = `
      <img src="${ch.thumbnail}" width="32">
      ${ch.title}
    `;

    const btn = document.createElement("button");
    btn.textContent = "追加";
    btn.onclick = () => {
      addChannel(ch);
      renderChannelList();
      fetchAllUpcomingLives();
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


/* ========= チャンネル保存 ========= */
function getChannels() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

function saveChannels(channels) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}

function addChannel(channel) {
  const channels = getChannels();

  if (!channels.find(c => c.id === channel.channelId)) {
    channels.push({
      id: channel.channelId,
      title: channel.title,
      thumbnail: channel.thumbnail
    });
    saveChannels(channels);
  }
}

function removeChannel(channelId) {
  const channels = getChannels().filter(c => c.id !== channelId);
  saveChannels(channels);
}


/* ========= チャンネル一覧表示 ========= */
function renderChannelList() {
  const ul = document.getElementById("channelList");
  ul.innerHTML = "";

  const channels = getChannels();

  channels.forEach(ch => {
    const li = document.createElement("li");

    li.innerHTML = `
      <img src="${ch.thumbnail}" width="24">
      ${ch.title}
    `;

    const btn = document.createElement("button");
    btn.textContent = "削除";
    btn.onclick = () => {
      removeChannel(ch.id);
      renderChannelList();
      fetchAllUpcomingLives();
    };

    li.appendChild(btn);
    ul.appendChild(li);
  });
}


/* ========= 配信予定取得 ========= */
async function fetchUpcomingByChannel(channelId) {

  // upcoming検索
  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=snippet&type=video&eventType=upcoming` +
    `&channelId=${channelId}&maxResults=5&key=${API_KEY}`;

  const searchRes = await fetch(searchUrl);

  if (!searchRes.ok) {
    console.error("Search API error:", channelId);
    return [];
  }

  const searchData = await searchRes.json();
  if (!searchData.items) return [];

  const videoIds = searchData.items
    .map(item => item.id.videoId)
    .join(",");

  if (!videoIds) return [];

  // 正確な配信時間取得
  const videoUrl =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${videoIds}&key=${API_KEY}`;

  const videoRes = await fetch(videoUrl);

  if (!videoRes.ok) {
    console.error("Videos API error");
    return [];
  }

  const videoData = await videoRes.json();

  return videoData.items
    .filter(v => v.liveStreamingDetails?.scheduledStartTime)
    .map(video => ({
      title: video.snippet.title,
      channelTitle: video.snippet.channelTitle,
      videoId: video.id,
      startTime: video.liveStreamingDetails.scheduledStartTime
    }));
}

/* ========= 全チャンネルまとめ（並列取得版） ========= */
async function fetchAllUpcomingLives() {
  const area = document.getElementById("liveList");
  area.innerHTML = "読み込み中…";

  const channels = getChannels();

  if (channels.length === 0) {
    area.textContent = "チャンネルが登録されていません";
    return;
  }

  try {
    // 並列取得（高速化）
    const results = await Promise.all(
      channels.map(ch => fetchUpcomingByChannel(ch.id))
    );

    let allLives = results.flat();

    // 開始時間順
    allLives.sort(
      (a, b) => new Date(a.startTime) - new Date(b.startTime)
    );

    renderLives(allLives);

  } catch (e) {
    console.error(e);
    area.textContent = "取得中にエラーが発生しました";
  }
}

/* ========= ICS生成 ========= */
function createICS(live) {
  const start = new Date(live.startTime);

  // 配信1時間と仮定（後で変更可）
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  // YYYYMMDDTHHMMSSZ 形式に変換
  const formatDate = (date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

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
  const area = document.getElementById("liveList");
  area.innerHTML = "";

  if (lives.length === 0) {
    area.textContent = "配信予定はありません";
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
          ▶ YouTubeで見る
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
fetchAllUpcomingLives();
