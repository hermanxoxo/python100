// app.js — Level-kart og fremgangsstyring

const STORAGE_KEY = 'python100_progress';

function getProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultProgress();
  } catch { return defaultProgress(); }
}

function defaultProgress() {
  return { startDate: null, completedLevels: [], points: 0, streak: 0, lastCompletionDate: null };
}

function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function getAvailableLevels(startDate) {
  if (!startDate) return 1;
  const diffMs = Date.now() - new Date(startDate).getTime();
  const days = Math.floor(diffMs / 86400000);
  return Math.min(days + 1, 100);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function renderGrid(levels, progress) {
  const grid = document.getElementById('level-grid');
  grid.innerHTML = '';
  const available = getAvailableLevels(progress.startDate);
  const completed = new Set(progress.completedLevels);

  levels.forEach(lvl => {
    const a = document.createElement('a');
    a.className = 'level-cell';
    a.dataset.id = lvl.id;
    a.title = lvl.tittel;

    const isDone = completed.has(lvl.id);
    const isOpen = lvl.id <= available && !isDone;
    const isLocked = lvl.id > available;

    if (isDone) {
      a.classList.add('done');
      a.href = `level.html?id=${lvl.id}`;
    } else if (isOpen) {
      a.classList.add('open');
      a.href = `level.html?id=${lvl.id}`;
    } else {
      a.classList.add('locked');
      a.setAttribute('aria-disabled', 'true');
      a.addEventListener('click', e => e.preventDefault());
    }

    a.innerHTML = `<span class="cell-num">${lvl.id}</span>`;
    grid.appendChild(a);
  });
}

function updateStats(progress) {
  const completed = progress.completedLevels.length;
  document.getElementById('score').textContent = progress.points;
  document.getElementById('streak').textContent = progress.streak;
  document.getElementById('completed-count').textContent = completed;

  const pct = (completed / 100) * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${completed} av 100`;
}

async function init() {
  let progress = getProgress();

  // First visit: set start date
  if (!progress.startDate) {
    progress.startDate = todayStr();
    saveProgress(progress);
  }

  const res = await fetch('./levels.json');
  const levels = await res.json();

  renderGrid(levels, progress);
  updateStats(progress);

  // Reset button
  document.getElementById('reset-btn').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.remove('hidden');
  });
  document.getElementById('cancel-reset').addEventListener('click', () => {
    document.getElementById('modal-overlay').classList.add('hidden');
  });
  document.getElementById('confirm-reset').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

init();
