/// <reference types="iina-plugin-definition" />

const { core, event, mpv, sidebar, console, file } = iina;

// ---- 字幕浏览器插件 ----

let subtitles = [];
let subtitleFile = null;
let currentIndex = -1;
let syncTimer = null;

// Supported subtitle extensions for auto-scan
const SUB_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt'];

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
  stopSync();

  const track = getSelectedSubtitleTrack();
  if (track) {
    // IINA already has a subtitle track selected
    if (!track.external || !track['external-filename']) {
      console.log('[SubtitleBrowser] Not external subtitle');
      sidebar.postMessage('subtitles', { entries: [], error: '暂不支持内嵌字幕，请使用外挂字幕 (.srt/.ass/.vtt)' });
      return;
    }
    readAndDisplaySubtitle(track['external-filename']);
    return;
  }

  // No subtitle track selected — try auto-scan
  console.log('[SubtitleBrowser] No subtitle track, trying auto-scan');
  autoScanAndLoad();
}

function readAndDisplaySubtitle(filepath) {
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
    startSync();
  } catch (e) {
    console.log('[SubtitleBrowser] Read error: ' + e);
    sidebar.postMessage('subtitles', { entries: [], error: '读取失败: ' + e });
  }
}

function autoScanAndLoad() {
  // Get the current media file path from mpv
  let mediaPath;
  try {
    mediaPath = mpv.getString('file-path');
  } catch (e) {
    console.log('[SubtitleBrowser] get file-path error: ' + e);
  }

  // Skip auto-scan for network streams
  if (!mediaPath ||
      mediaPath.startsWith('http://') ||
      mediaPath.startsWith('https://') ||
      mediaPath.startsWith('rtmp://') ||
      mediaPath.startsWith('rtsp://')) {
    sidebar.postMessage('subtitles', { entries: [], error: '请先加载字幕文件' });
    return;
  }

  // Get directory and basename
  const sepIdx = Math.max(mediaPath.lastIndexOf('/'), mediaPath.lastIndexOf('\\'));
  if (sepIdx === -1) {
    sidebar.postMessage('subtitles', { entries: [], error: '请先加载字幕文件' });
    return;
  }
  const dirPath = mediaPath.substring(0, sepIdx);
  const filename = mediaPath.substring(sepIdx + 1);
  const dotIdx = filename.lastIndexOf('.');
  const nameWithoutExt = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;

  // List files in the same directory
  let files;
  try {
    files = file.list(dirPath, {});
  } catch (e) {
    console.log('[SubtitleBrowser] file.list error: ' + e);
    sidebar.postMessage('subtitles', { entries: [], error: '无法扫描字幕目录' });
    return;
  }

  if (!files || files.length === 0) {
    sidebar.postMessage('subtitles', { entries: [], error: '未找到字幕文件' });
    return;
  }

  // Find and score subtitle files
  const candidates = [];
  for (const f of files) {
    if (f.isDir) continue;
    const lower = f.filename.toLowerCase();
    for (const ext of SUB_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        const cBase = f.filename.substring(0, f.filename.lastIndexOf('.'));
        let score = 0;
        if (cBase.toLowerCase() === nameWithoutExt.toLowerCase()) {
          score = 2; // Exact match: 01标题.mp3 + 01标题.srt
        } else if (cBase.toLowerCase().startsWith(nameWithoutExt.toLowerCase())) {
          score = 1; // Prefix match: 01标题 + 01标题_双语.srt
        }
        candidates.push({ filename: f.filename, fullPath: dirPath + f.path, score });
        break;
      }
    }
  }

  if (candidates.length === 0) {
    sidebar.postMessage('subtitles', { entries: [], error: '未找到 .srt/.ass/.vtt 字幕文件' });
    return;
  }

  // Pick the best match (highest score, then alphabetically)
  candidates.sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename));
  const best = candidates[0];
  console.log('[SubtitleBrowser] Auto-loading: ' + best.filename);

  // Load subtitle via mpv command
  try {
    mpv.command('sub-add', [best.fullPath]);
  } catch (e) {
    console.log('[SubtitleBrowser] sub-add error: ' + e);
    sidebar.postMessage('subtitles', { entries: [], error: '自动加载字幕失败' });
    return;
  }

  // Give mpv a moment to register the track, then read & parse
  setTimeout(() => {
    readAndDisplaySubtitle(best.fullPath);
  }, 300);
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
  });

  // Also try to load subtitles after a delay
  setTimeout(() => {
    loadAndSendSubtitles();
  }, 1000);
});

// Reload on video file load
event.on('mpv.file-loaded', () => {
  console.log('[SubtitleBrowser] mpv.file-loaded');
  setTimeout(() => { loadAndSendSubtitles(); }, 800);
});

event.on('iina.file-loaded', () => {
  console.log('[SubtitleBrowser] iina.file-loaded');
  setTimeout(() => { loadAndSendSubtitles(); }, 1000);
});

console.log('[SubtitleBrowser] Plugin initialized');
