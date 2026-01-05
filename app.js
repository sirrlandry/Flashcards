/* CAS Flashcards - single-file app (no build step)
   Features:
   - flip cards (tap)
   - thumbs up/down scheduling (SM-2 inspired, simplified)
   - shuffle
   - tag filter and per-card tags
   - per-card notes
   - browse/search
   - export/import progress
*/

const DATA_URL = 'cards.json';
const LS_KEY = 'cas_flashcards_progress_v1';
const LS_SETTINGS = 'cas_flashcards_settings_v1';

function todayISO() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

const defaultSettings = {
  newLimit: 20,
  againMinutes: 10,
  firstGoodMinutes: 10
};

function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null');
    return {...defaultSettings, ...(s || {})};
  }catch(e){
    return {...defaultSettings};
  }
}
function saveSettings(s){ localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

function loadProgress(){
  try{
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
  }catch(e){ return {}; }
}
function saveProgress(p){ localStorage.setItem(LS_KEY, JSON.stringify(p)); }

function getCardState(progress, cardId){
  // state fields:
  // - due: ms timestamp
  // - ef: ease factor (>=1.3)
  // - intervalDays
  // - reps
  // - lapses
  // - lastReviewed: ms
  // - correct: count
  // - incorrect: count
  // - tags: []
  // - notes: string
  return progress[cardId] || {
    due: 0,
    ef: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    lastReviewed: 0,
    correct: 0,
    incorrect: 0,
    tags: [],
    notes: ''
  };
}

function scheduleCard(state, grade, settings){
  // grade: 1 correct, 0 incorrect
  const now = Date.now();
  state.lastReviewed = now;

  if (grade === 0){
    state.incorrect += 1;
    state.lapses += 1;
    state.reps = 0;
    state.intervalDays = 0;
    // show again soon (minutes)
    state.due = now + settings.againMinutes * 60 * 1000;
    // slight ease penalty
    state.ef = clamp(state.ef - 0.2, 1.3, 3.0);
    return state;
  }

  state.correct += 1;

  // SM-2-ish update
  state.reps += 1;
  if (state.reps === 1){
    state.due = now + settings.firstGoodMinutes * 60 * 1000;
    state.intervalDays = 0;
    return state;
  }
  if (state.reps === 2){
    state.intervalDays = 1;
  } else {
    // interval = previous interval * EF (minimum 1 day)
    state.intervalDays = Math.max(1, Math.round((state.intervalDays || 1) * state.ef));
  }
  state.due = now + state.intervalDays * 24 * 60 * 60 * 1000;

  // ease factor reward
  state.ef = clamp(state.ef + 0.05, 1.3, 3.0);
  return state;
}

function shuffleArray(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let DATA = null;
let PROGRESS = loadProgress();
let SETTINGS = loadSettings();

let queue = [];
let queueIndex = 0;
let currentCard = null;
let isFlipped = false;

const el = (id) => document.getElementById(id);

function renderStats(deckId){
  const cards = DATA.cards.filter(c => c.deck === deckId);
  const now = Date.now();
  let due=0, newCount=0, learned=0, missed=0;

  for (const c of cards){
    const s = getCardState(PROGRESS, c.id);
    if (!s.lastReviewed) newCount += 1;
    if (s.due && s.due <= now) due += 1;
    if (s.correct > 0) learned += 1;
    if (s.incorrect > 0) missed += 1;
  }

  el('stats').textContent = `Cards: ${cards.length} | Due now: ${due} | New: ${newCount} | Learned: ${learned} | Missed at least once: ${missed}`;
}

function buildQueue(){
  const deckId = el('deckSelect').value;
  const mode = el('modeSelect').value;
  const tagFilterRaw = (el('tagFilter').value || '').trim().toLowerCase();
  const shuffle = el('shuffleToggle').checked;

  const now = Date.now();
  const cards = DATA.cards.filter(c => c.deck === deckId);

  const matchesTag = (card) => {
    if (!tagFilterRaw) return true;
    const wanted = tagFilterRaw.split(',').map(t => t.trim()).filter(Boolean);
    const s = getCardState(PROGRESS, card.id);
    const tags = new Set([...(card.tags || []), ...(s.tags || [])].map(t => (t||'').toLowerCase()));
    return wanted.every(t => tags.has(t));
  };

  let filtered = cards.filter(matchesTag);

  if (mode === 'due'){
    // due + a limited number of new cards
    const dueCards = filtered.filter(c => {
      const s = getCardState(PROGRESS, c.id);
      return (s.due && s.due <= now);
    });
    const newCards = filtered.filter(c => {
      const s = getCardState(PROGRESS, c.id);
      return !s.lastReviewed;
    }).slice(0, SETTINGS.newLimit);

    filtered = [...dueCards, ...newCards];
  } else if (mode === 'new'){
    filtered = filtered.filter(c => !getCardState(PROGRESS, c.id).lastReviewed);
  } else if (mode === 'incorrect'){
    filtered = filtered.filter(c => getCardState(PROGRESS, c.id).incorrect > 0);
  } // 'all' keeps filtered

  if (shuffle) shuffleArray(filtered);
  queue = filtered;
  queueIndex = 0;

  renderStats(deckId);
  showCardArea(queue.length > 0);

  if (queue.length === 0){
    el('queueInfo').textContent = 'No cards in queue for current selection.';
    return;
  }
  loadCurrentCard();
}

function showCardArea(show){
  el('cardArea').hidden = !show;
  el('actions').hidden = !show;
  el('cardTools').hidden = !show;
  el('browse').hidden = true;
}

function setFlip(flipped){
  isFlipped = flipped;
  const card = el('card');
  if (flipped) card.classList.add('flipped');
  else card.classList.remove('flipped');
  el('actions').hidden = !flipped;
}

function loadCurrentCard(){
  currentCard = queue[queueIndex];
  setFlip(false);

  el('cardFront').textContent = currentCard.front || '';
  el('cardBack').textContent = currentCard.back || '';

  const s = getCardState(PROGRESS, currentCard.id);

  const mergedTags = [...new Set([...(currentCard.tags||[]), ...(s.tags||[])])];
  el('cardTags').value = mergedTags.join(', ');
  el('cardNotes').value = s.notes || '';

  const meta = `${currentCard.deck} • #${currentCard.card_number}${currentCard.section ? ' • ' + currentCard.section : ''}`;
  el('cardMeta').textContent = meta;
  el('cardMetaBack').textContent = meta;

  el('queueInfo').textContent = `Card ${queueIndex+1} of ${queue.length}`;
}

function nextCard(){
  if (queueIndex < queue.length - 1){
    queueIndex += 1;
    loadCurrentCard();
  } else {
    el('queueInfo').textContent = 'Queue complete. Start/Refresh to rebuild a new queue.';
    // keep last card visible
  }
}

function answerCurrent(isCorrect){
  if (!currentCard) return;
  const s = getCardState(PROGRESS, currentCard.id);
  scheduleCard(s, isCorrect ? 1 : 0, SETTINGS);
  // persist merged tags/notes (in case user typed but didn't click save)
  const tags = (el('cardTags').value || '').split(',').map(t => t.trim()).filter(Boolean);
  s.tags = Array.from(new Set(tags));
  s.notes = (el('cardNotes').value || '');
  PROGRESS[currentCard.id] = s;
  saveProgress(PROGRESS);
  nextCard();
}

function resetCurrentCard(){
  if (!currentCard) return;
  if (!confirm('Reset progress for this card (schedule, stats, tags/notes)?')) return;
  delete PROGRESS[currentCard.id];
  saveProgress(PROGRESS);
  loadCurrentCard();
  renderStats(el('deckSelect').value);
}

function setupBrowse(){
  el('browse').hidden = false;
  el('cardArea').hidden = true;
  const deckId = el('deckSelect').value;
  const cards = DATA.cards.filter(c => c.deck === deckId);

  function renderList(q){
    const container = el('cardList');
    container.innerHTML = '';
    const query = (q || '').trim().toLowerCase();

    const subset = cards.filter(c => {
      if (!query) return true;
      return (c.front || '').toLowerCase().includes(query) || (c.back || '').toLowerCase().includes(query) || (c.section || '').toLowerCase().includes(query);
    }).slice(0, 250); // keep UI fast on mobile

    for (const c of subset){
      const s = getCardState(PROGRESS, c.id);
      const div = document.createElement('div');
      div.className = 'item';
      const mergedTags = [...new Set([...(c.tags||[]), ...(s.tags||[])])];
      div.innerHTML = `
        <div class="q">${escapeHTML(c.front || '')}</div>
        <div class="a">${escapeHTML((c.back || '').slice(0, 500))}${(c.back || '').length>500 ? '…' : ''}</div>
        <div class="meta">${escapeHTML(c.section || '')} • Tags: ${escapeHTML(mergedTags.join(', '))}</div>
      `;
      div.addEventListener('click', () => {
        // jump to single-card view
        queue = [c];
        queueIndex = 0;
        showCardArea(true);
        loadCurrentCard();
      });
      container.appendChild(div);
    }
  }

  el('searchBox').value = '';
  renderList('');
  el('searchBox').oninput = (e) => renderList(e.target.value);
}

function exportProgress(){
  const payload = {
    exported_at: new Date().toISOString(),
    progress: PROGRESS,
    settings: SETTINGS
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cas-flashcards-progress-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importProgress(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const payload = JSON.parse(reader.result);
      if (payload && payload.progress){
        PROGRESS = payload.progress;
        saveProgress(PROGRESS);
      }
      if (payload && payload.settings){
        SETTINGS = {...defaultSettings, ...payload.settings};
        saveSettings(SETTINGS);
        syncSettingsUI();
      }
      alert('Import complete.');
      renderStats(el('deckSelect').value);
    }catch(e){
      alert('Import failed: invalid JSON.');
    }
  };
  reader.readAsText(file);
}

function syncSettingsUI(){
  el('newLimit').value = SETTINGS.newLimit;
  el('againMinutes').value = SETTINGS.againMinutes;
  el('firstGoodMinutes').value = SETTINGS.firstGoodMinutes;
}

function escapeHTML(str){
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

async function init(){
  // Support running from file:// without a local web server by inlining cards.json into index.html
  // (Mobile/desktop browsers often block fetch() from file:// due to CORS restrictions.)
  let embedded = null;
  try{
    const node = document.getElementById('cards-data');
    if (node && node.textContent) embedded = node.textContent.trim();
  }catch(e){ /* ignore */ }

  if (embedded){
    try{
      DATA = JSON.parse(embedded);
    }catch(e){
      console.error('Failed to parse embedded cards-data JSON', e);
      DATA = null;
    }
  }

  if (!DATA){
    const res = await fetch(DATA_URL);
    DATA = await res.json();
  }

  // populate deck select
  const deckSelect = el('deckSelect');
  deckSelect.innerHTML = '';
  for (const d of DATA.decks){
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.card_count})`;
    deckSelect.appendChild(opt);
  }

  // default deck
  deckSelect.value = DATA.decks[0].id;

  renderStats(deckSelect.value);
  syncSettingsUI();

  // wire actions
  el('btnStart').onclick = buildQueue;
  el('btnBrowse').onclick = setupBrowse;
  el('btnCloseBrowse').onclick = () => {
    el('browse').hidden = true;
    el('cardArea').hidden = true;
  };

  el('btnExport').onclick = exportProgress;
  el('importFile').onchange = (e) => {
    if (e.target.files && e.target.files[0]) importProgress(e.target.files[0]);
    e.target.value = '';
  };

  el('card').addEventListener('click', () => setFlip(!isFlipped));
  el('card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlip(!isFlipped); }
  });

  el('btnRight').onclick = () => answerCurrent(true);
  el('btnWrong').onclick = () => answerCurrent(false);
  el('btnSkip').onclick = () => nextCard();
  el('btnResetCard').onclick = resetCurrentCard;

  el('btnSaveNotes').onclick = () => {
    if (!currentCard) return;
    const s = getCardState(PROGRESS, currentCard.id);
    const tags = (el('cardTags').value || '').split(',').map(t => t.trim()).filter(Boolean);
    s.tags = Array.from(new Set(tags));
    s.notes = (el('cardNotes').value || '');
    PROGRESS[currentCard.id] = s;
    saveProgress(PROGRESS);
    alert('Saved.');
  };

  // keyboard shortcuts (desktop)
  window.addEventListener('keydown', (e) => {
    if (el('settingsDialog').open) return;
    if (el('browse').hidden === false) return;
    if (!currentCard) return;

    if (e.key === 'ArrowRight') { if (isFlipped) answerCurrent(true); }
    if (e.key === 'ArrowLeft') { if (isFlipped) answerCurrent(false); }
    if (e.key.toLowerCase() === 'f') { setFlip(!isFlipped); }
  });

  // settings dialog
  const dlg = el('settingsDialog');
  el('btnSettings').onclick = () => { syncSettingsUI(); dlg.showModal(); };
  el('btnSaveSettings').onclick = () => {
    SETTINGS = {
      newLimit: clamp(parseInt(el('newLimit').value || '0', 10), 0, 500),
      againMinutes: clamp(parseInt(el('againMinutes').value || '10', 10), 1, 1440),
      firstGoodMinutes: clamp(parseInt(el('firstGoodMinutes').value || '10', 10), 1, 1440)
    };
    saveSettings(SETTINGS);
  };

  // optional: auto-build a queue on load (Due mode)
  buildQueue();

  // service worker (optional offline)
  if ('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('sw.js'); }catch(e){}
  }
}

init();
