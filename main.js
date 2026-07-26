/// <reference types="iina-plugin-definition" />

const { core, event, mpv, sidebar, console, file } = iina;

// ---- 字幕浏览器插件 ----

let subtitles = [];
let subtitleFile = null;
let currentIndex = -1;
let syncTimer = null;

// ---- SRT Parser ----
function parseSRT(content) {
  const entries = [];
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0].trim())) idx = 1;
    const timeMatch = lines[idx]?.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;
    const startTime = parseInt(timeMatch[1])*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4])/1000;
    const endTime = parseInt(timeMatch[5])*3600 + parseInt(timeMatch[6])*60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8])/1000;
    const subtitleText = lines.slice(idx + 1).join('\n').trim();
    if (!subtitleText) continue;
    entries.push({ index: entries.length, start: startTime, end: endTime, text: subtitleText, startDisplay: formatTime(startTime) });
  }
  return entries;
}

// ---- ASS Parser ----
function parseASS(content) {
  const entries = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inEvents = false;
  for (const line of lines) {
    if (line.startsWith('[Events]')) { inEvents = true; continue; }
    if (line.startsWith('[') && inEvents) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (!line.startsWith('Dialogue:')) continue;
    const match = line.match(/^Dialogue:\s*\d+\s*,\s*(\d+):(\d+):(\d+)[.](\d+)\s*,\s*(\d+):(\d+):(\d+)[.](\d+)\s*,(.*)$/);
    if (!match) continue;
    const startTime = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/100;
    const endTime = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/100;
    let text = match[9].replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ').trim();
    if (!text) continue;
    entries.push({ index: entries.length, start: startTime, end: endTime, text: text, startDisplay: formatTime(startTime) });
  }
  return entries;
}

// ---- WebVTT Parser ----
function parseVTT(content) {
  const entries = [];
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = text.replace(/^WEBVTT[^\n]*\n(?:[\s\S]*?\n\n)?/, '');
  const blocks = body.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 1) continue;
    let idx = 0;
    if (!lines[0].includes('-->') && lines.length > 1) idx = 1;
    const timeMatch = lines[idx]?.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!timeMatch) continue;
    const startTime = parseInt(timeMatch[1])*3600 + parseInt(timeMatch[2])*60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4])/1000;
    const endTime = parseInt(timeMatch[5])*3600 + parseInt(timeMatch[6])*60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8])/1000;
    const subtitleText = lines.slice(idx + 1).join('\n').trim();
    if (!subtitleText) continue;
    entries.push({ index: entries.length, start: startTime, end: endTime, text: subtitleText, startDisplay: formatTime(startTime) });
  }
  return entries;
}

function parseSubtitle(content, filepath) {
  const lower = filepath.toLowerCase();
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return parseASS(content);
  if (lower.endsWith('.vtt')) return parseVTT(content);
  return parseSRT(content);
}

// ---- Utils ----
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function findSubtitleIndex(time) {
  let lo = 0, hi = subtitles.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sub = subtitles[mid];
    if (time >= sub.start && time <= sub.end) return mid;
    if (time < sub.start) hi = mid - 1;
    else lo = mid + 1;
  }
  return -1;
}

function getSelectedSubtitleTrack() {
  try {
    const tracks = mpv.getNative('track-list');
    if (!tracks || !Array.isArray(tracks)) return null;
    for (const track of tracks) {
      if (track.type === 'sub' && track.selected) return track;
    }
  } catch (e) {
    console.log('[SubtitleBrowser] get track-list error: ' + e);
  }
  return null;
}

// ---- Load & Send Subtitles ----
function loadAndSendSubtitles() {
  subtitles = [];
  subtitleFile = null;
  const track = getSelectedSubtitleTrack();
  if (!track) {
    console.log('[SubtitleBrowser] No subtitle track');
    sidebar.postMessage('subtitles', { entries: [], error: '请先加载字幕文件' });
    return;
  }
  if (!track.external || !track['external-filename']) {
    console.log('[SubtitleBrowser] Not external subtitle');
    sidebar.postMessage('subtitles', { entries: [], error: '暂不支持内嵌字幕，请使用外挂字幕 (.srt/.ass/.vtt)' });
    return;
  }
  const filepath = track['external-filename'];
  if (!file.exists(filepath)) {
    console.log('[SubtitleBrowser] File not found: ' + filepath);
    sidebar.postMessage('subtitles', { entries: [], error: '字幕文件不存在' });
    return;
  }
  try {
    const content = file.read(filepath);
    subtitles = parseSubtitle(content, filepath);
    subtitleFile = filepath;
    console.log('[SubtitleBrowser] Loaded ' + subtitles.length + ' subs from ' + filepath);
    sidebar.postMessage('subtitles', { entries: subtitles });
  } catch (e) {
    console.log('[SubtitleBrowser] Read error: ' + e);
    sidebar.postMessage('subtitles', { entries: [], error: '读取失败: ' + e });
  }
}

// ---- Sync ----
function syncPosition() {
  if (subtitles.length === 0) return;
  let pos;
  try { pos = mpv.getNumber('time-pos'); } catch (e) { return; }
  if (pos === undefined || pos === null) return;
  const idx = findSubtitleIndex(pos);
  if (idx !== currentIndex) {
    currentIndex = idx;
    sidebar.postMessage('current', { index: idx, time: pos });
  }
}

function startSync() {
  stopSync();
  syncTimer = setInterval(syncPosition, 300);
}

function stopSync() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

// ---- Init: wait for window, then load sidebar ----
event.on('iina.window-loaded', () => {
  console.log('[SubtitleBrowser] window-loaded, loading sidebar');
  sidebar.loadFile('sidebar.html');

  // Listen for seek from sidebar webview
  sidebar.onMessage('seek', (data) => {
    console.log('[SubtitleBrowser] received seek: ' + JSON.stringify(data));
    if (data && typeof data.time === 'number') {
      core.seekTo(data.time);
    }
  });

  sidebar.onMessage('loaded', () => {
    console.log('[SubtitleBrowser] sidebar HTML says it loaded');
    loadAndSendSubtitles();
    startSync();
  });

  // Also try to load subtitles after a delay
  setTimeout(() => {
    loadAndSendSubtitles();
    startSync();
  }, 1000);
});

// Reload on video file load
event.on('mpv.file-loaded', () => {
  console.log('[SubtitleBrowser] mpv.file-loaded');
  setTimeout(() => { loadAndSendSubtitles(); startSync(); }, 800);
});

event.on('iina.file-loaded', () => {
  console.log('[SubtitleBrowser] iina.file-loaded');
  setTimeout(() => { loadAndSendSubtitles(); startSync(); }, 1000);
});

console.log('[SubtitleBrowser] Plugin initialized');
