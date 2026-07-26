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

  // Try each subtitle extension (file.exists avoids sandbox dir-listing issue)
  for (const ext of SUB_EXTENSIONS) {
    const candidatePath = dirPath + '/' + nameWithoutExt + ext;
    if (file.exists(candidatePath)) {
      console.log('[SubtitleBrowser] Auto-loading: ' + candidatePath);

      // Load subtitle via mpv command
      try {
        mpv.command('sub-add', [candidatePath]);
      } catch (e) {
        console.log('[SubtitleBrowser] sub-add error: ' + e);
        sidebar.postMessage('subtitles', { entries: [], error: '自动加载字幕失败' });
        return;
      }

      // Give mpv a moment to register the track, then read & parse
      setTimeout(() => {
        readAndDisplaySubtitle(candidatePath);
      }, 300);
      return;
    }
  }

  sidebar.postMessage('subtitles', { entries: [], error: '未找到同名字幕文件 (.srt/.ass/.vtt)' });
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
