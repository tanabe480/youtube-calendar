const API_KEY = "AIzaSyB-V1-oz0G_5Pt-taRzAVbQIr1uTPKgU3c";
const CHANNEL_ID = "UCM2SwvNjA0uH8oc5D0ihSDA";

async function getLiveSchedule() {
  const list = document.getElementById("list");
  list.innerHTML = "";

  // ① 配信予定の videoId を取得
  const searchUrl =
    "https://www.googleapis.com/youtube/v3/search" +
    "?part=snippet" +
    "&channelId=" + CHANNEL_ID +
    "&eventType=upcoming" +
    "&type=video" +
    "&maxResults=5" +
    "&key=" + API_KEY;

  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();

  if (!searchData.items || searchData.items.length === 0) {
    list.textContent = "配信予定はありません";
    return;
  }

  // videoId をまとめる
  const videoIds = searchData.items
    .map(item => item.id.videoId)
    .join(",");

  // ② 正確な配信時間を取得
  const videoUrl =
    "https://www.googleapis.com/youtube/v3/videos" +
    "?part=snippet,liveStreamingDetails" +
    "&id=" + videoIds +
    "&key=" + API_KEY;

  const videoRes = await fetch(videoUrl);
  const videoData = await videoRes.json();

  // ③ 表示 & カレンダーURL生成
  videoData.items.forEach(video => {
    const title = video.snippet.title;
    const start = new Date(
      video.liveStreamingDetails.scheduledStartTime
    );

    // 配信は1時間想定
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    // Googleカレンダー用日時形式
    const startStr =
      start.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const endStr =
      end.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const watchUrl =
      "https://www.youtube.com/watch?v=" + video.id;

    const calendarUrl =
      "https://www.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(title) +
      "&dates=" + startStr + "/" + endStr +
      "&details=" + encodeURIComponent(
        "YouTube配信\n" + watchUrl
      );

    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <p>📺 ${title}</p>
      <p>🕒 ${start.toLocaleString()}</p>
      <a href="${watchUrl}" target="_blank">▶ 配信ページ</a><br>
      <a href="${calendarUrl}" target="_blank">📅 カレンダーに追加</a>
      <hr>
    `;

    list.appendChild(div);
  });
}

const STORAGE_KEY = "youtube_channels";
function getChannels() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}
function saveChannels(channels) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}
//チャンネルを追加
function addChannel(channelId) {
  const channels = getChannels();
  if (!channels.includes(channelId)) {
    channels.push(channelId);
    saveChannels(channels);
  }
}
//チャンネルを削除
function removeChannel(channelId) {
  const channels = getChannels().filter(id => id !== channelId);
  saveChannels(channels);
}

document.getElementById("addBtn").addEventListener("click", () => {
  const input = document.getElementById("channelInput");
  if (!input.value) return;

  addChannel(input.value.trim());
  input.value = "";
  renderChannelList();
});

function renderChannelList() {
  const list = document.getElementById("channelList");
  list.innerHTML = "";

  getChannels().forEach(id => {
    const li = document.createElement("li");
    li.textContent = id;

    const del = document.createElement("button");
    del.textContent = "削除";
    del.onclick = () => {
      removeChannel(id);
      renderChannelList();
    };

    li.appendChild(del);
    list.appendChild(li);
  });
}

renderChannelList();

// 実行
getLiveSchedule();