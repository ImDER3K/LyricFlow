/* ============================================================
   LyricFlow — app.js  (v3 — Backend AI Integration)

   Real features:
   ─ FastAPI backend → Whisper transcription + rapidfuzz sync (real ms timing)
   ─ iTunes Search API → real song metadata + album artwork + 30s audio preview
   ─ HTML5 Audio element → real playback with timeupdate events
   ─ lyrics.ovh API → real lyrics (frontend fallback when backend offline)
   ─ YouTube IFrame API → full-track playback when a YT link is pasted
   ─ Live search dropdown → autocomplete with album art + song cards
   ─ Word-by-word karaoke sync driven by real audio currentTime
   ─ Volume control
   ─ Share + Export (txt / lrc / TikTok PNG)
   ─ Backend status indicator (online / offline)
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
//  Backend config
// ─────────────────────────────────────────────
const BACKEND_URL = 'http://localhost:8000';
let backendOnline = false;

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const state = {
  isPlaying: false,
  lyricsData: [],       // [{time, text, words:[]}]
  currentLineIndex: -1,
  animFrame: null,
  song: null,           // {title, artist, album, thumbnail, previewUrl, duration}
  mode: 'none',         // 'audio' | 'yt'
  // YouTube
  ytPlayer: null,
  ytReady: false,
  // Search
  itunesResults: [],
  searchDebounce: null,
};

// ─────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

const searchSection = $('searchSection');
const playerSection = $('playerSection');
const searchInput = $('searchInput');
const searchBtn = $('searchBtn');
const searchBtnText = $('searchBtnText');
const searchSpinner = $('searchSpinner');
const searchSuggestions = $('searchSuggestions');
const lyricsContent = $('lyricsContent');
const lyricsContainer = $('lyricsContainer');
const albumArt = $('albumArt');
const albumArtWrapper = albumArt.parentElement;
const songTitle = $('songTitle');
const songArtist = $('songArtist');
const progressFill = $('progressFill');
const progressTrack = $('progressTrack');
const timeElapsed = $('timeElapsed');
const timeDuration = $('timeDuration');
const btnPlay = $('btnPlay');
const btnPrev = $('btnPrev');
const btnNext = $('btnNext');
const iconPlay = btnPlay.querySelector('.icon-play');
const iconPause = btnPlay.querySelector('.icon-pause');
const btnShare = $('btnShare');
const btnExport = $('btnExport');
const btnSearchAgain = $('btnSearchAgain');
const toast = $('toast');
const modalOverlay = $('modalOverlay');
const modalClose = $('modalClose');
const exportOverlay = $('exportOverlay');
const exportClose = $('exportClose');
const shareUrlInput = $('shareUrlInput');
const btnCopyUrl = $('btnCopyUrl');
const btnTikTok = $('btnTikTok');
const btnTwitter = $('btnTwitter');
const btnWhatsApp = $('btnWhatsApp');
const exportTxt = $('exportTxt');
const exportLRC = $('exportLRC');
const exportPng = $('exportPng');
const audioPlayer = $('audioPlayer');
const volumeSlider = $('volumeSlider');
const sourceBadge = $('sourceBadge');
const backendStatus = $('backendStatus');
const statusDot = $('statusDot');
const statusLabel = $('statusLabel');
const processingOverlay = $('processingOverlay');
const procProgressFill = $('procProgressFill');
const procProgressPct = $('procProgressPct');
const processingSubtitle = $('processingSubtitle');

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const s = sec % 60;
  const m = Math.floor(sec / 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.className = 'toast hidden', 3000);
}

function setLoading(on) {
  searchBtnText.classList.toggle('hidden', on);
  searchSpinner.classList.toggle('hidden', !on);
  searchBtn.disabled = on;
}

// ─────────────────────────────────────────────
//  iTunes Search API  (free, no key)
// ─────────────────────────────────────────────
async function searchItunes(query, limit = 6) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}&media=music`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('iTunes error');
  const data = await res.json();
  return (data.results || []).map(r => ({
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName,
    thumbnail: (r.artworkUrl100 || '').replace('100x100', '600x600'),
    thumbnailSm: (r.artworkUrl100 || ''),
    previewUrl: r.previewUrl || null,     // 30-second .m4a preview
    duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 30,
    trackId: r.trackId,
  }));
}

async function getItunesMeta(artist, title) {
  try {
    const results = await searchItunes(`${title} ${artist}`, 1);
    return results[0] || null;
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────
//  Lyrics API  (lyrics.ovh — real API, no key)
// ─────────────────────────────────────────────
async function fetchLyrics(artist, title) {
  // lyrics.ovh
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics && data.lyrics.trim().length > 30) return cleanLyrics(data.lyrics);
    }
  } catch (_) { }

  // Fallback: try swapping title/artist order
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics && data.lyrics.trim().length > 30) return cleanLyrics(data.lyrics);
    }
  } catch (_) { }

  return null; // caller handles null
}

function cleanLyrics(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // max double blank lines
    .trim();
}

// ─────────────────────────────────────────────
//  Build timed lyric lines from plain text
//  Distributes lines evenly over real duration
// ─────────────────────────────────────────────
function parseLyricsToTimed(rawLyrics, duration) {
  const allLines = rawLyrics.split('\n').map(l => l.trim());
  // Keep blank lines as section spacers but don't show them
  const lines = allLines.filter(l => l.length > 0);
  if (!lines.length) return [];

  const usable = Math.max(duration, 30);
  // Intro silence: first lyric at ~8% of duration
  const introFrac = 0.08;
  const outroFrac = 0.06;
  const lyricStart = usable * introFrac;
  const lyricEnd = usable * (1 - outroFrac);
  const span = lyricEnd - lyricStart;
  const gap = span / lines.length;

  return lines.map((text, i) => ({
    time: lyricStart + i * gap,
    text,
    words: text.split(/\s+/).filter(w => w.length > 0),
    isBlank: false,
  }));
}

// ─────────────────────────────────────────────
//  Render lyrics DOM
// ─────────────────────────────────────────────
function renderLyrics(lyricsData) {
  lyricsContent.innerHTML = '';
  if (!lyricsData.length) {
    lyricsContent.innerHTML = `
      <div class="lyrics-empty">
        <div class="lyrics-empty-icon">🎵</div>
        <div class="lyrics-empty-text">No se encontraron letras para esta canción.<br/>Intenta con otra o pega un enlace de YouTube.</div>
      </div>`;
    return;
  }
  lyricsData.forEach((line, idx) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.index = idx;
    const span = document.createElement('span');
    span.className = 'line-text';
    span.textContent = line.text;
    div.appendChild(span);
    div.addEventListener('click', () => seekToLine(idx));
    lyricsContent.appendChild(div);
  });
}

// ─────────────────────────────────────────────
//  Playback — HTML5 Audio events
// ─────────────────────────────────────────────
audioPlayer.addEventListener('timeupdate', () => {
  if (state.mode !== 'audio') return;
  const t = audioPlayer.currentTime;
  const d = audioPlayer.duration || state.song?.duration || 30;
  updateProgressBarDirect(t, d);
  updateActiveLine(t);
});

audioPlayer.addEventListener('play', () => setPlayingUI(true));
audioPlayer.addEventListener('pause', () => setPlayingUI(false));
audioPlayer.addEventListener('ended', () => {
  setPlayingUI(false);
  // Restart from beginning
  audioPlayer.currentTime = 0;
  updateProgressBarDirect(0, audioPlayer.duration || 30);
});
audioPlayer.addEventListener('loadedmetadata', () => {
  if (state.song) {
    const d = audioPlayer.duration;
    state.song.duration = d;
    // Re-parse lyrics with real duration now that we know it
    if (state._rawLyrics) {
      state.lyricsData = parseLyricsToTimed(state._rawLyrics, d);
      renderLyrics(state.lyricsData);
    }
    timeDuration.textContent = formatTime(d);
  }
});
audioPlayer.addEventListener('error', (e) => {
  // Ignore errors when src is empty — stopAll() sets src='' which triggers this
  if (!audioPlayer.src || audioPlayer.src === window.location.href) return;

  let errorMsg = 'Error al cargar el audio. Verifica tu conexión.';
  switch (audioPlayer.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      errorMsg = 'Carga de audio abortada.';
      break;
    case MediaError.MEDIA_ERR_NETWORK:
      errorMsg = 'Error de red. Verifica tu conexión.';
      break;
    case MediaError.MEDIA_ERR_DECODE:
      errorMsg = 'Error al decodificar el audio. Formato no compatible.';
      break;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      errorMsg = 'Fuente de audio no compatible o no encontrada.';
      break;
  }

  console.error('AudioPlayer error:', e, audioPlayer.error);
  showToast(errorMsg);
  setPlayingUI(false);
});

// ─────────────────────────────────────────────
//  Playback — YouTube IFrame API
// ─────────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => { state.ytReady = true; };

function createYTPlayer(videoId, autoplay = true) {
  return new Promise(resolve => {
    const poll = setInterval(() => {
      if (typeof YT === 'undefined' || !YT.Player) return;
      clearInterval(poll);
      // Destroy old iframe and recreate the target div if needed
      const container = $('ytPlayerContainer');
      if (!document.getElementById('ytPlayer')) {
        const div = document.createElement('div');
        div.id = 'ytPlayer';
        container.appendChild(div);
      }
      const p = new YT.Player('ytPlayer', {
        height: '0', width: '0',
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          controls: 0,
          disablekb: 1,
          rel: 0,
          iv_load_policy: 3,
          mute: 0,
          enablejsapi: 1,
          playsinline: 1,
          modestbranding: 1
        },
        events: {
          onReady: (event) => {
            console.log('YouTube player ready');
            // Asegurar que el volumen esté al máximo (100)
            event.target.setVolume(100);
            if (autoplay) {
              try {
                event.target.playVideo();
              } catch (error) {
                console.error('Error al reproducir YouTube:', error);
                showToast('Autoplay bloqueado. Haz clic en ▶ para reproducir.');
              }
            }
            resolve(p);
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PLAYING) {
              console.log('YouTube playing');
              setPlayingUI(true);
            }
            if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
              console.log('YouTube paused/ended');
              setPlayingUI(false);
            }
          },
          onError: (e) => {
            console.error('YouTube player error code:', e.data);
            let errorMsg = 'Error al reproducir video';
            switch (e.data) {
              case 2:
                errorMsg = 'ID de video inválido';
                break;
              case 5:
                errorMsg = 'Video no disponible en tu región';
                break;
              case 100:
                errorMsg = 'Video no encontrado';
                break;
              case 101:
              case 150:
              case 153:
                // Error común: intentar reproducir con el reproductor de audio
                console.log('YouTube embed restricted, trying workaround...');
                // No mostrar error, intentar reproducir de todas formas
                return;
            }
            showToast(errorMsg);
            setPlayingUI(false);
          }
        },
      });
    }, 200);
  });
}

// YT tick (rAF loop for progress)
function ytTick() {
  if (state.mode !== 'yt' || !state.isPlaying) return;
  try {
    const t = state.ytPlayer.getCurrentTime();
    const d = state.ytPlayer.getDuration() || state.song?.duration || 180;
    if (!state.song.duration) state.song.duration = d;
    updateProgressBarDirect(t, d);
    updateActiveLine(t);
  } catch (_) { }
  state.animFrame = requestAnimationFrame(ytTick);
}

// ─────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────
function setPlayingUI(on) {
  state.isPlaying = on;
  iconPlay.classList.toggle('hidden', on);
  iconPause.classList.toggle('hidden', !on);
  albumArtWrapper.classList.toggle('playing', on);
  if (state.mode === 'yt') {
    cancelAnimationFrame(state.animFrame);
    if (on) state.animFrame = requestAnimationFrame(ytTick);
  }
}

function updateProgressBarDirect(t, d) {
  const pct = d > 0 ? Math.min((t / d) * 100, 100) : 0;
  progressFill.style.width = `${pct}%`;
  timeElapsed.textContent = formatTime(t);
  timeDuration.textContent = formatTime(d);
}

// ─────────────────────────────────────────────
//  Active lyric line + word animation
// ─────────────────────────────────────────────
function updateActiveLine(t) {
  if (!state.lyricsData.length) return;

  let activeIdx = -1;
  for (let i = 0; i < state.lyricsData.length; i++) {
    if (state.lyricsData[i].time <= t) activeIdx = i;
    else break;
  }

  if (activeIdx === state.currentLineIndex) {
    animateWords(activeIdx, t);
    return;
  }

  const prev = state.currentLineIndex;
  state.currentLineIndex = activeIdx;

  lyricsContent.querySelectorAll('.lyric-line').forEach((el, i) => {
    el.classList.remove('active', 'active-beat', 'past');
    const span = el.querySelector('.line-text');
    if (i < activeIdx) {
      el.classList.add('past');
      span.textContent = state.lyricsData[i].text;
    } else if (i === activeIdx) {
      el.classList.add('active', 'active-beat');
      span.innerHTML = state.lyricsData[i].words
        .map(w => `<span class="lyric-word unlit">${escHtml(w)}</span>`)
        .join(' ');
      setTimeout(() => el.classList.remove('active-beat'), 600);
      scrollToLine(el);
    } else {
      if (span.children.length) span.textContent = state.lyricsData[i].text;
    }
    if (prev >= 0 && i === prev && i !== activeIdx) {
      span.textContent = state.lyricsData[i].text;
    }
  });
}

function animateWords(activeIdx, t) {
  if (activeIdx < 0) return;
  const line = state.lyricsData[activeIdx];
  const el = lyricsContent.querySelector(`.lyric-line[data-index="${activeIdx}"]`);
  if (!el) return;

  const lineStart = line.time;
  const lineEnd = activeIdx + 1 < state.lyricsData.length
    ? state.lyricsData[activeIdx + 1].time
    : (state.song?.duration || 30);
  const lineDur = Math.max(lineEnd - lineStart, 0.5);
  const pct = Math.min((t - lineStart) / lineDur, 1);
  const spans = el.querySelectorAll('.lyric-word');
  const litCount = Math.ceil(pct * spans.length);

  spans.forEach((s, i) => {
    s.classList.toggle('lit', i < litCount);
    s.classList.toggle('unlit', i >= litCount);
  });
}

function scrollToLine(el) {
  const rect = el.getBoundingClientRect();
  const cRect = lyricsContainer.getBoundingClientRect();
  lyricsContainer.scrollTo({
    top: lyricsContainer.scrollTop + (rect.top - cRect.top) - cRect.height * 0.32,
    behavior: 'smooth',
  });
}

function seekTo(seconds) {
  state.currentLineIndex = -1;
  lyricsContent.querySelectorAll('.lyric-line').forEach(el => {
    el.classList.remove('active', 'active-beat', 'past');
    const i = parseInt(el.dataset.index);
    const span = el.querySelector('.line-text');
    if (span) span.textContent = state.lyricsData[i]?.text || '';
  });

  if (state.mode === 'audio') {
    audioPlayer.currentTime = seconds;
  } else if (state.mode === 'yt' && state.ytPlayer) {
    try { state.ytPlayer.seekTo(seconds, true); } catch (_) { }
  }
}

function seekToLine(idx) {
  const t = Math.max(0, (state.lyricsData[idx]?.time ?? 0) - 0.3);
  seekTo(t);
}

// ─────────────────────────────────────────────
//  Search flow — live dropdown
// ─────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

searchInput.addEventListener('input', () => {
  clearTimeout(state.searchDebounce);
  const val = searchInput.value.trim();
  if (!val || val.length < 2) { hideSuggestions(); return; }
  if (extractYTId(val)) { hideSuggestions(); return; } // Don't autocomplete YT links
  state.searchDebounce = setTimeout(() => loadSuggestions(val), 420);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { hideSuggestions(); handleSearch(searchInput.value); }
  if (e.key === 'Escape') hideSuggestions();
});

document.addEventListener('click', e => {
  if (!searchSuggestions.contains(e.target) && e.target !== searchInput) hideSuggestions();
});

async function loadSuggestions(query) {
  try {
    const results = await searchItunes(query, 6);
    state.itunesResults = results;
    renderSuggestions(results);
  } catch (_) { hideSuggestions(); }
}

function renderSuggestions(results) {
  if (!results.length) { hideSuggestions(); return; }
  searchSuggestions.innerHTML = results.map((r, i) => `
    <div class="suggestion-item" data-index="${i}">
      <img class="sugg-thumb" src="${escHtml(r.thumbnailSm)}" alt="" loading="lazy"
           onerror="this.style.display='none'" />
      <div class="sugg-info">
        <span class="sugg-title">${escHtml(r.title)}</span>
        <span class="sugg-artist">${escHtml(r.artist)} · ${escHtml(r.album || '')}</span>
      </div>
      ${r.previewUrl ? '<span class="sugg-pill">▶ Preview</span>' : ''}
    </div>
  `).join('');
  searchSuggestions.classList.add('open');

  searchSuggestions.querySelectorAll('.suggestion-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      const chosen = state.itunesResults[idx];
      if (!chosen) return;
      searchInput.value = `${chosen.title} — ${chosen.artist}`;
      hideSuggestions();
      loadFromItunes(chosen);
    });
  });
}

function hideSuggestions() {
  searchSuggestions.classList.remove('open');
  searchSuggestions.innerHTML = '';
}

// ─────────────────────────────────────────────
//  Handle search button / Enter
// ─────────────────────────────────────────────
searchBtn.addEventListener('click', () => handleSearch(searchInput.value));

async function handleSearch(raw) {
  console.log('handleSearch called with:', raw);
  const val = raw.trim();
  if (!val) { showToast('Ingresa el nombre de una canción ♪'); return; }
  hideSuggestions();
  setLoading(true);

  // YouTube link?
  const ytId = extractYTId(val);
  if (ytId) {
    // Use backend-enhanced handler if available, else original
    const handler = window._lyricFlowHandleYT || handleYouTube;
    await handler(ytId);
    setLoading(false);
    return;
  }

  // Parse "Song - Artist" or "Song — Artist"
  let title = val, artist = '';
  const sep = val.match(/\s[-—–]\s/);
  if (sep) {
    const idx = val.indexOf(sep[0]);
    title = val.slice(0, idx).trim();
    artist = val.slice(idx + sep[0].length).trim();
  }

  // Try iTunes first to get metadata
  try {
    const results = await searchItunes(`${title} ${artist}`, 1);
    if (results.length) {
      await loadFromItunes(results[0]);
    } else {
      // No iTunes result — load with just lyrics
      await loadLyricsOnly(title, artist || 'Unknown', null);
    }
  } catch (e) {
    showToast('Error de red. Verifica tu conexión.');
  }
  setLoading(false);
}

// ─────────────────────────────────────────────
//  Load a song from an iTunes result object
// ─────────────────────────────────────────────
async function loadFromItunes(result) {
  setLoading(true);
  stopAll();

  state.song = { ...result };
  state.mode = 'audio';
  state._rawLyrics = null;

  // Update UI immediately with what we know
  songTitle.textContent = result.title;
  songArtist.textContent = result.artist;
  albumArt.src = result.thumbnail || result.thumbnailSm;
  albumArt.onerror = () => { albumArt.src = FALLBACK_IMG; };
  timeDuration.textContent = formatTime(result.duration);
  updateProgressBarDirect(0, result.duration);
  setSourceBadge(result.previewUrl ? '30s Preview · iTunes' : 'Sin audio', result.previewUrl ? 'preview' : 'none');

  // Set audio source (30s preview)
  if (result.previewUrl) {
    audioPlayer.src = result.previewUrl;
    const volumeValue = volumeSlider?.value ?? 80;
    audioPlayer.volume = volumeValue / 100;
    console.log(`Volumen configurado a: ${volumeValue}%`);
    audioPlayer.load();
  } else {
    audioPlayer.src = '';
    showToast('Sin preview de audio. Mostrando letras en modo visual.');
  }

  // Fetch lyrics in parallel
  lyricsContent.innerHTML = `<div class="lyrics-loading"><div class="lyrics-loading-spinner"></div><span>Buscando letras…</span></div>`;
  showPlayer();
  setLoading(false);

  const rawLyrics = await fetchLyrics(result.artist, result.title);
  state._rawLyrics = rawLyrics;

  if (rawLyrics) {
    state.lyricsData = parseLyricsToTimed(rawLyrics, result.duration);
    renderLyrics(state.lyricsData);
  } else {
    lyricsContent.innerHTML = `
      <div class="lyrics-empty">
        <div class="lyrics-empty-icon">🔍</div>
        <div class="lyrics-empty-text">No encontramos letras para <strong>${escHtml(result.title)}</strong>.<br/>
        Intenta buscar manualmente: <strong>${escHtml(result.artist + ' ' + result.title)}</strong></div>
      </div>`;
    state.lyricsData = [];
  }

  // Auto-play
  if (result.previewUrl) {
    audioPlayer.play().catch(() => {
      showToast('Haz clic en ▶ para reproducir');
    });
  }
}

// ─────────────────────────────────────────────
//  Load lyrics only (no iTunes result)
// ─────────────────────────────────────────────
async function loadLyricsOnly(title, artist, thumbnail) {
  stopAll();
  state.song = { title, artist, thumbnail, duration: 210 };
  state.mode = 'audio';
  state._rawLyrics = null;
  audioPlayer.src = '';

  songTitle.textContent = title;
  songArtist.textContent = artist;
  albumArt.src = thumbnail || FALLBACK_IMG;
  setSourceBadge('Sin audio', 'none');
  updateProgressBarDirect(0, 210);
  lyricsContent.innerHTML = `<div class="lyrics-loading"><div class="lyrics-loading-spinner"></div><span>Buscando letras…</span></div>`;
  showPlayer();

  const rawLyrics = await fetchLyrics(artist, title);
  state._rawLyrics = rawLyrics;
  if (rawLyrics) {
    state.lyricsData = parseLyricsToTimed(rawLyrics, 210);
    renderLyrics(state.lyricsData);
    showToast('Letras encontradas — usa el modo demo para sincronizar ♪');
    // Demo playback (simulated timer) since no real audio
    startDemoPlayback(210);
  } else {
    lyricsContent.innerHTML = `<div class="lyrics-empty"><div class="lyrics-empty-icon">😔</div><div class="lyrics-empty-text">No se encontraron letras. Verifica el nombre o pega un link de YouTube.</div></div>`;
    state.lyricsData = [];
  }
}

// Demo playback fallback (no real audio)
let _demoInterval = null;
let _demoTime = 0;
function startDemoPlayback(duration) {
  clearInterval(_demoInterval);
  _demoTime = 0;
  setPlayingUI(true);
  _demoInterval = setInterval(() => {
    _demoTime += 0.1;
    if (_demoTime >= duration) { clearInterval(_demoInterval); setPlayingUI(false); return; }
    updateProgressBarDirect(_demoTime, duration);
    updateActiveLine(_demoTime);
  }, 100);
}
function stopDemoPlayback() {
  clearInterval(_demoInterval);
  _demoInterval = null;
  _demoTime = 0;
}

// ─────────────────────────────────────────────
//  YouTube flow
// ─────────────────────────────────────────────
function extractYTId(url) {
  console.log('extractYTId called with:', url);
  const re = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/;
  const m = url.match(re);
  const result = m ? m[1] : null;
  console.log('extractYTId result:', result);
  return result;
}

async function handleYouTube(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  stopAll();
  state.mode = 'audio'; // Use audio mode instead of YT
  state.song = {
    title: 'Cargando…',
    artist: 'YouTube',
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    duration: 0,
  };

  albumArt.src = state.song.thumbnail;
  albumArt.onerror = () => { albumArt.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`; };
  songTitle.textContent = 'Descargando audio…';
  songArtist.textContent = 'YouTube';
  setSourceBadge('Descargando audio…', 'downloading');
  showPlayer();

  // Show processing modal like before
  showProcessingModal('Descargando audio de YouTube…');

  try {
    // Download audio from YouTube using backend
    const response = await fetch(`${BACKEND_URL}/api/process/download-audio?url=${encodeURIComponent(ytUrl)}`);
    if (!response.ok) {
      throw new Error('Failed to download audio');
    }
    const data = await response.json();

    // Get the audio URL
    const audioUrl = `${BACKEND_URL}${data.audio_url}`;
    console.log('Audio downloaded:', audioUrl);

    // Set up audio player
    audioPlayer.src = audioUrl;
    audioPlayer.volume = (volumeSlider?.value ?? 80) / 100;
    state.song.previewUrl = audioUrl;

    // Get video info for title and thumbnail
    const infoRes = await fetch(`${BACKEND_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: ytUrl })
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info.song_info) {
        state.song.title = info.song_info.title || 'YouTube';
        state.song.artist = info.song_info.artist || 'YouTube';
        state.song.duration = info.song_info.duration || 180;
        songTitle.textContent = state.song.title;
        songArtist.textContent = state.song.artist;
        updateProgressBarDirect(0, state.song.duration);

        // Render lyrics if available
        if (info.timed_lyrics && info.timed_lyrics.length > 0) {
          state.lyricsData = info.timed_lyrics.map(l => ({
            time: l.time,
            text: l.text,
            words: l.text.split(/\s+/).filter(w => w.length > 0),
            isBlank: false,
          }));
          renderLyrics(state.lyricsData);
          setSourceBadge('YouTube · Audio descargado', 'yt');
        } else {
          lyricsContent.innerHTML = `<div class="lyrics-empty"><div class="lyrics-empty-icon">🎵</div><div class="lyrics-empty-text">Audio descargado. Buscando letras…</div></div>`;
          // Try to fetch lyrics
          fetchLyrics(state.song.artist, state.song.title).then(raw => {
            if (raw) {
              state._rawLyrics = raw;
              state.lyricsData = parseLyricsToTimed(raw, state.song.duration);
              renderLyrics(state.lyricsData);
            }
          });
        }
      }
    }

    // Load audio and prepare to play
    audioPlayer.load();

    // Set volume after load (it may reset to default)
    audioPlayer.volume = (volumeSlider?.value ?? 80) / 100;

    // Auto-play after loading (best UX)
    // The 'play' event will trigger setPlayingUI(true) automatically
    if (audioPlayer.readyState >= 2) {
      // Already have enough data
      audioPlayer.play()
        .then(() => console.log('Auto-play started'))
        .catch(err => {
          console.warn('Auto-play blocked by browser:', err);
          showToast('Haz clic en ▶ para reproducir');
        });
    } else {
      // Wait for canplay event
      audioPlayer.addEventListener('canplay', () => {
        audioPlayer.play()
          .then(() => console.log('Auto-play started after canplay'))
          .catch(err => {
            console.warn('Auto-play blocked:', err);
            showToast('Haz clic en ▶ para reproducir');
          });
      }, { once: true });
    }

    hideProcessingModal();

  } catch (error) {
    hideProcessingModal();
    console.error('Error downloading audio:', error);
    showToast('Error al descargar audio. Usando modo demo.');
    // Fallback to demo mode (lyrics sync without real audio)
    state.mode = 'audio';
    state.song.previewUrl = null;
    audioPlayer.src = '';

    // Fetch lyrics for demo mode
    fetchLyrics('YouTube', videoId).then(raw => {
      if (raw) {
        state._rawLyrics = raw;
        state.lyricsData = parseLyricsToTimed(raw, 180);
        renderLyrics(state.lyricsData);
        showToast('Modo demo: letras sincronizadas sin audio');
      }
    });
  }
}

// ─────────────────────────────────────────────
//  Stop all playback
// ─────────────────────────────────────────────
function stopAll() {
  // Audio
  try { audioPlayer.pause(); audioPlayer.src = ''; } catch (_) { }
  // YT
  if (state.ytPlayer) { try { state.ytPlayer.pauseVideo(); } catch (_) { } }
  // Demo
  stopDemoPlayback();
  // rAF
  cancelAnimationFrame(state.animFrame);
  setPlayingUI(false);
  state.currentLineIndex = -1;
  state.lyricsData = [];
}

// ─────────────────────────────────────────────
//  Source badge
// ─────────────────────────────────────────────
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80';

function setSourceBadge(text, type) {
  if (!sourceBadge) return;
  sourceBadge.textContent = text;
  sourceBadge.className = `source-badge source-${type}`;
}

// ─────────────────────────────────────────────
//  Player controls
// ─────────────────────────────────────────────
btnPlay.addEventListener('click', async () => {
  if (state.mode === 'audio' && audioPlayer.src) {
    if (state.isPlaying) {
      audioPlayer.pause();
    } else {
      try {
        // Verificar que el audio ha cargado antes de reproducir
        if (audioPlayer.readyState < 2) {
          showToast('Cargando audio...');
          // Esperar a que el audio se cargue
          await new Promise((resolve) => {
            audioPlayer.addEventListener('canplay', resolve, { once: true });
            audioPlayer.load();
          });
        }
        // Reproducir audio
        await audioPlayer.play();
        // Asegurar que el volumen esté configurado (no solo si es 0)
        const vol = (volumeSlider?.value ?? 80) / 100;
        if (audioPlayer.volume < vol) {
          audioPlayer.volume = vol;
        }
      } catch (error) {
        console.error('Error al reproducir:', error);
        if (error.name === 'NotAllowedError') {
          showToast('Autoplay bloqueado. Haz clic en el botón para reproducir.');
        } else if (error.name === 'NotSupportedError') {
          showToast('Formato de audio no compatible.');
        } else if (error.name === 'AbortError') {
          showToast('Reproducción abortada.');
        } else {
          showToast(`Error al reproducir: ${error.message || 'Verifica tu conexión.'}`);
        }
        // Asegurar que el UI se actualice correctamente
        setPlayingUI(false);
      }
    }
  } else if (state.mode === 'yt' && state.ytPlayer) {
    if (state.isPlaying) {
      try {
        console.log('Pausing YouTube video');
        state.ytPlayer.pauseVideo();
      } catch (error) {
        console.error('Error al pausar YouTube:', error);
        showToast('Error al pausar video');
      }
    } else {
      try {
        console.log('Playing YouTube video');
        // Asegurar que el volumen no esté en 0
        if (state.ytPlayer.getVolume() === 0) {
          state.ytPlayer.setVolume(100);
        }
        state.ytPlayer.playVideo();
      } catch (error) {
        console.error('Error al reproducir YouTube:', error);
        showToast('Error al reproducir video');
        setPlayingUI(false);
      }
    }
  } else if (state.mode === 'audio' && !audioPlayer.src) {
    // Demo mode toggle
    if (state.isPlaying) {
      stopDemoPlayback();
      setPlayingUI(false);
    } else {
      startDemoPlayback(state.song?.duration || 210);
    }
  } else if (state.song) {
    // Si hay una canción cargada pero no se puede reproducir, intentar modo demo
    console.log('No audio source available, using demo mode');
    if (state.isPlaying) {
      stopDemoPlayback();
      setPlayingUI(false);
    } else {
      startDemoPlayback(state.song?.duration || 210);
    }
  } else {
    // Si no hay modo de reproducción establecido
    showToast('Selecciona una canción primero.');
  }
});

btnPrev.addEventListener('click', () => seekTo(Math.max(0, getCurrentTime() - 10)));
btnNext.addEventListener('click', () => seekTo(Math.min(state.song?.duration || 999, getCurrentTime() + 10)));

function getCurrentTime() {
  if (state.mode === 'audio') return audioPlayer.currentTime || 0;
  if (state.mode === 'yt' && state.ytPlayer) { try { return state.ytPlayer.getCurrentTime(); } catch (_) { } }
  return _demoTime;
}

// Progress bar click / drag
let isDragging = false;
progressTrack.addEventListener('mousedown', e => { isDragging = true; scrubTo(e); });
document.addEventListener('mousemove', e => { if (isDragging) scrubTo(e); });
document.addEventListener('mouseup', () => { isDragging = false; });
progressTrack.addEventListener('touchstart', e => scrubTo(e.touches[0]), { passive: true });
progressTrack.addEventListener('touchmove', e => scrubTo(e.touches[0]), { passive: true });

function scrubTo(e) {
  const rect = progressTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
  seekTo(pct * (state.song?.duration || 30));
}

// Volume
if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    audioPlayer.volume = volumeSlider.value / 100;
  });
  audioPlayer.volume = 0.8;
}

// ─────────────────────────────────────────────
//  Search section show/hide
// ─────────────────────────────────────────────
function showPlayer() {
  searchSection.classList.add('hidden');
  playerSection.classList.remove('hidden');
}

function showSearch() {
  stopAll();
  if (state.ytPlayer) { try { state.ytPlayer.destroy(); } catch (_) { } state.ytPlayer = null; }
  $('ytPlayerContainer').classList.add('yt-hidden');
  playerSection.classList.add('hidden');
  searchSection.classList.remove('hidden');
  searchInput.value = '';
  searchInput.focus();
  state.song = null;
  state.mode = 'none';
}

btnSearchAgain.addEventListener('click', showSearch);

// Demo tags
document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const song = tag.dataset.song, artist = tag.dataset.artist;
    searchInput.value = `${song} — ${artist}`;
    hideSuggestions();
    handleSearch(searchInput.value);
  });
});

// ─────────────────────────────────────────────
//  Share modal
// ─────────────────────────────────────────────
btnShare.addEventListener('click', () => {
  shareUrlInput.value = window.location.href;
  modalOverlay.classList.remove('hidden');
});
modalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.add('hidden'); });

btnCopyUrl.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrlInput.value)
    .then(() => { showToast('¡Enlace copiado!', 'success'); modalOverlay.classList.add('hidden'); })
    .catch(() => { shareUrlInput.select(); document.execCommand('copy'); showToast('¡Copiado!', 'success'); });
});

function shareText() {
  const s = state.song;
  return s ? `🎵 Escuchando "${s.title}"${s.artist ? ` de ${s.artist}` : ''} con letras sincronizadas en LyricFlow` : 'LyricFlow — Letras en tiempo real';
}

btnTikTok.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrlInput.value).catch(() => { });
  showToast('¡Link copiado! Pégalo en tu TikTok 🎵', 'success');
  modalOverlay.classList.add('hidden');
});
btnTwitter.addEventListener('click', () => {
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(location.href)}`, '_blank');
  modalOverlay.classList.add('hidden');
});
btnWhatsApp.addEventListener('click', () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(shareText() + '\n' + location.href)}`, '_blank');
  modalOverlay.classList.add('hidden');
});

// ─────────────────────────────────────────────
//  Export modal
// ─────────────────────────────────────────────
btnExport.addEventListener('click', () => exportOverlay.classList.remove('hidden'));
exportClose.addEventListener('click', () => exportOverlay.classList.add('hidden'));
exportOverlay.addEventListener('click', e => { if (e.target === exportOverlay) exportOverlay.classList.add('hidden'); });

exportTxt.addEventListener('click', () => {
  if (!state.lyricsData.length) { showToast('No hay letras para exportar'); return; }
  const text = state.lyricsData.map(l => l.text).join('\n');
  downloadBlob(`${state.song?.title || 'letras'}.txt`, text, 'text/plain');
  exportOverlay.classList.add('hidden');
  showToast('Exportado como .txt ✓', 'success');
});

exportLRC.addEventListener('click', () => {
  if (!state.lyricsData.length) { showToast('No hay letras para exportar'); return; }
  const header = `[ti:${state.song?.title || ''}]\n[ar:${state.song?.artist || ''}]\n[by:LyricFlow]\n\n`;
  const lines = state.lyricsData.map(l => {
    const mm = String(Math.floor(l.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(l.time % 60)).padStart(2, '0');
    const cs = String(Math.floor((l.time % 1) * 100)).padStart(2, '0');
    return `[${mm}:${ss}.${cs}]${l.text}`;
  }).join('\n');
  downloadBlob(`${state.song?.title || 'letras'}.lrc`, header + lines, 'text/plain');
  exportOverlay.classList.add('hidden');
  showToast('Exportado como .lrc ♪', 'success');
});

exportPng.addEventListener('click', () => {
  captureTikTokPng();
  exportOverlay.classList.add('hidden');
});

function downloadBlob(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────
//  TikTok PNG export (canvas 1080×1920)
// ─────────────────────────────────────────────
function captureTikTokPng() {
  const cv = document.createElement('canvas');
  cv.width = 1080; cv.height = 1920;
  const ctx = cv.getContext('2d');

  // BG gradient
  const bg = ctx.createLinearGradient(0, 0, 0, cv.height);
  bg.addColorStop(0, '#18191c'); bg.addColorStop(1, '#1e2124');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);

  // Green glow top
  const gl = ctx.createRadialGradient(cv.width / 2, 0, 0, cv.width / 2, 0, 700);
  gl.addColorStop(0, 'rgba(126,200,160,0.18)'); gl.addColorStop(1, 'transparent');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, cv.width, cv.height);

  // Album art placeholder circle
  ctx.save();
  ctx.beginPath(); ctx.arc(cv.width / 2, 380, 220, 0, Math.PI * 2);
  const circGrad = ctx.createRadialGradient(cv.width / 2, 380, 0, cv.width / 2, 380, 220);
  circGrad.addColorStop(0, '#2c2f35'); circGrad.addColorStop(1, '#1e2124');
  ctx.fillStyle = circGrad; ctx.fill();
  // Outline
  ctx.strokeStyle = 'rgba(126,200,160,0.25)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  // Try to draw album art image
  try {
    const img = albumArt;
    if (img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cv.width / 2, 380, 218, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, cv.width / 2 - 218, 380 - 218, 436, 436);
      ctx.restore();
    }
  } catch (_) { }

  // Song title
  ctx.fillStyle = '#f0f2f4';
  ctx.font = 'bold 58px Inter, sans-serif';
  ctx.textAlign = 'center';
  wrapText(ctx, state.song?.title || 'LyricFlow', cv.width / 2, 668, cv.width - 120, 68);

  // Artist
  ctx.fillStyle = '#8b9099';
  ctx.font = '38px Inter, sans-serif';
  ctx.fillText(state.song?.artist || '', cv.width / 2, 740);

  // Divider
  ctx.strokeStyle = 'rgba(126,200,160,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(100, 780); ctx.lineTo(cv.width - 100, 780); ctx.stroke();

  // Lyrics
  const active = state.currentLineIndex;
  const start = Math.max(0, active - 2);
  const end = Math.min(state.lyricsData.length - 1, active + 8);
  let y = 840;

  for (let i = start; i <= end; i++) {
    const line = state.lyricsData[i]; if (!line || y > cv.height - 160) break;
    const isActive = i === active;
    const isPast = i < active;

    if (isActive) {
      ctx.fillStyle = '#7ec8a0'; ctx.font = 'bold 56px Inter, sans-serif';
      ctx.shadowColor = 'rgba(126,200,160,0.7)'; ctx.shadowBlur = 24;
    } else if (isPast) {
      ctx.fillStyle = '#4f545c'; ctx.font = '38px Inter, sans-serif'; ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#3a3e46'; ctx.font = '44px Inter, sans-serif'; ctx.shadowBlur = 0;
    }
    const lh = isActive ? 72 : 56;
    y += wrapText(ctx, line.text, cv.width / 2, y, cv.width - 160, lh) * lh + (isActive ? 16 : 8);
  }
  ctx.shadowBlur = 0;

  // Watermark
  ctx.fillStyle = 'rgba(126,200,160,0.4)'; ctx.font = '30px Inter, sans-serif';
  ctx.fillText('♪ LyricFlow', cv.width / 2, cv.height - 70);

  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lyricflow-${(state.song?.title || 'snapshot').replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click(); URL.revokeObjectURL(a.href);
    showToast('📸 Imagen exportada para TikTok!', 'success');
  }, 'image/png');
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '', linesDrawn = 0;
  for (const w of words) {
    const test = line + w + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y + linesDrawn * lineH);
      line = w + ' '; linesDrawn++;
    } else { line = test; }
  }
  if (line.trim()) { ctx.fillText(line.trim(), x, y + linesDrawn * lineH); linesDrawn++; }
  return linesDrawn;
}

// ─────────────────────────────────────────────
//  Keyboard shortcuts
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); btnPrev.click(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); btnNext.click(); }
});

// ─────────────────────────────────────────────
//  Backend health check
// ─────────────────────────────────────────────
async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      backendOnline = true;
      backendStatus.className = 'backend-status online';
      statusLabel.textContent = 'AI online';
    } else { throw new Error('not ok'); }
  } catch (_) {
    backendOnline = false;
    backendStatus.className = 'backend-status offline';
    statusLabel.textContent = 'Sin backend';
  }
}

// ─────────────────────────────────────────────
//  Processing modal UI helpers
// ─────────────────────────────────────────────
function showProcessingModal(subtitle = 'Iniciando…') {
  processingSubtitle.textContent = subtitle;
  // Reset all steps
  ['stepDownload', 'stepTranscribe', 'stepSync'].forEach(id => {
    const el = $(id);
    el.className = 'proc-step';
    el.querySelector('.step-check').classList.add('hidden');
  });
  setProcessingProgress(0);
  processingOverlay.classList.remove('hidden');
}

function hideProcessingModal() {
  processingOverlay.classList.add('hidden');
}

function setProcessingStep(step /* 'download' | 'transcribe' | 'sync' */, done = false) {
  const stepIds = { download: 'stepDownload', transcribe: 'stepTranscribe', sync: 'stepSync' };
  const subtitles = {
    download: '⬇️ Descargando audio con yt-dlp…',
    transcribe: '🎙️ Transcribiendo con Whisper AI…',
    sync: '🔗 Sincronizando letras con rapidfuzz…',
  };
  const progress = { download: 20, transcribe: 60, sync: 90 };

  const el = $(stepIds[step]);
  if (el) {
    el.className = done ? 'proc-step done' : 'proc-step active';
    const check = el.querySelector('.step-check');
    if (done) check.classList.remove('hidden');
    else check.classList.add('hidden');
  }
  if (!done) {
    processingSubtitle.textContent = subtitles[step] || '';
    setProcessingProgress(progress[step]);
  }
}

function setProcessingProgress(pct) {
  procProgressFill.style.width = `${pct}%`;
  procProgressPct.textContent = `${pct}%`;
}

// ─────────────────────────────────────────────
//  Backend process (full AI pipeline for YouTube)
// ─────────────────────────────────────────────
async function processWithBackend(ytUrl) {
  showProcessingModal('Conectando con el servidor AI…');

  // Step 1 — Download indicator (we simulate timing since backend is async)
  setProcessingStep('download');
  setProcessingProgress(10);

  let result;
  try {
    // The backend handles all 3 steps internally;
    // we animate the UI while waiting
    const animTimer = _simulateStepAnimation();

    const res = await fetch(`${BACKEND_URL}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: ytUrl }),
    });

    clearInterval(animTimer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Backend error ${res.status}`);
    }
    result = await res.json();
  } catch (e) {
    hideProcessingModal();
    showToast(`Backend error: ${e.message}. Usando modo frontend.`, 'error');
    return null;
  }

  // Mark all steps done
  setProcessingStep('download', true);
  setProcessingStep('transcribe', true);
  setProcessingStep('sync', true);
  setProcessingProgress(100);
  processingSubtitle.textContent = result.from_cache
    ? '⚡ Resultado desde caché — instantáneo!'
    : '✅ Procesamiento completado';

  await new Promise(r => setTimeout(r, 900));  // brief "done" moment
  hideProcessingModal();
  return result;
}

// Simulates animated step progression while waiting for the backend
function _simulateStepAnimation() {
  const steps = ['download', 'transcribe', 'sync'];
  const delays = [0, 8000, 18000];  // roughly when each step starts
  delays.forEach((delay, i) => {
    setTimeout(() => setProcessingStep(steps[i]), delay);
  });
  // Animate progress bar slowly
  let p = 10;
  return setInterval(() => {
    if (p < 85) {
      p += 0.5;
      setProcessingProgress(Math.round(p));
    }
  }, 300);
}

// ─────────────────────────────────────────────
//  Override YouTube handler to use backend
// ─────────────────────────────────────────────
// Handle YouTube with backend - already implemented in handleYouTube function above

async function handleYouTubeWithBackend(videoId) {
  console.log('handleYouTubeWithBackend called with videoId:', videoId);

  // Always use handleYouTube which handles download and fallback
  return handleYouTube(videoId);

  // ── If backend has no lyrics, fall back to original flow ────────────
  if (!result || !result.timed_lyrics || !result.timed_lyrics.length) {
    return _originalHandleYouTube(videoId);
  }

  // ── Backend returned lyrics — set up player ──────────────────────────
  stopAll();
  state.mode = 'yt';
  const info = result.song_info;
  state.song = {
    title: info.title || 'YouTube',
    artist: info.artist || 'YouTube',
    thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    duration: info.duration || 180,
  };

  albumArt.src = state.song.thumbnail;
  albumArt.onerror = () => { albumArt.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`; };
  songTitle.textContent = state.song.title;
  songArtist.textContent = state.song.artist;
  // Show duration immediately so bar never shows 0:00/0:00
  updateProgressBarDirect(0, state.song.duration);

  const srcLabel = result.from_cache ? 'YouTube · Caché ⚡' : 'YouTube · Whisper AI 🧠';
  setSourceBadge(srcLabel, 'yt');

  state.lyricsData = result.timed_lyrics.map(l => ({
    time: l.time,
    text: l.text,
    words: l.text.split(/\s+/).filter(w => w.length > 0),
    isBlank: false,
  }));
  renderLyrics(state.lyricsData);

  const hasWhisper = result.whisper_segments && result.whisper_segments.length > 0;
  const label = hasWhisper
    ? `🎙️ ${result.timed_lyrics.length} líneas · Whisper AI`
    : `🎵 ${result.timed_lyrics.length} líneas · distribución automática`;
  showToast(label, 'success');

  showPlayer();

  // Create YT player — playVideo() fires inside onReady for max reliability
  $('ytPlayerContainer').classList.remove('yt-hidden');
  if (state.ytPlayer) { try { state.ytPlayer.destroy(); } catch (_) { } state.ytPlayer = null; }
  console.log('Creating YouTube player with videoId:', videoId);
  const p = await createYTPlayer(videoId, true);  // autoplay=true → fires in onReady
  state.ytPlayer = p;
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
searchInput.focus();
checkBackendHealth();

// Patch handleYouTube to use backend version
// (declared with function keyword so hoisted — we reassign via the reference in handleSearch)
window._lyricFlowHandleYT = handleYouTubeWithBackend;
