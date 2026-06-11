// level.js — Enkeltlevel: editor, Pyodide, tester, hint

const STORAGE_KEY = 'python100_progress';
let pyodide = null;
let editor = null;
let currentLevel = null;
let hintsShown = 0;
let pyodideReady = false;

// ─── Fremgang ─────────────────────────────────────────────────────────────────

function getProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultProgress();
  } catch { return defaultProgress(); }
}
function defaultProgress() {
  return { startDate: null, completedLevels: [], points: 0, streak: 0, lastCompletionDate: null };
}
function saveProgress(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

function markComplete(levelId) {
  const p = getProgress();
  if (!p.completedLevels.includes(levelId)) {
    p.completedLevels.push(levelId);
    p.points += pointsForLevel(levelId);

    const today = todayStr();
    if (p.lastCompletionDate === today) {
      // already counted today
    } else if (p.lastCompletionDate === yesterday()) {
      p.streak += 1;
    } else {
      p.streak = 1;
    }
    p.lastCompletionDate = today;
    saveProgress(p);
  }
}

function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function pointsForLevel(id) { return Math.floor(id * 1.5) + 10; }

function isCompleted(levelId) {
  return getProgress().completedLevels.includes(levelId);
}

// ─── Faner ────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.getElementById('panel-learn').classList.toggle('hidden', name !== 'learn');
  document.getElementById('panel-solve').classList.toggle('hidden', name !== 'solve');
  document.getElementById('tab-learn').classList.toggle('active', name === 'learn');
  document.getElementById('tab-solve').classList.toggle('active', name === 'solve');
  if (name === 'solve' && editor) { editor.refresh(); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(location.search);
  const levelId = parseInt(params.get('id'));
  if (!levelId || levelId < 1 || levelId > 100) { location.href = 'index.html'; return; }

  const res = await fetch('./levels.json');
  const levels = await res.json();
  currentLevel = levels.find(l => l.id === levelId);
  if (!currentLevel) { location.href = 'index.html'; return; }

  // DOM
  document.title = `Level ${levelId}: ${currentLevel.tittel} — Python100`;
  document.getElementById('level-badge').textContent = `Level ${levelId}`;
  document.getElementById('level-num').textContent = String(levelId).padStart(2, '0');
  document.getElementById('level-title').textContent = currentLevel.tittel;
  document.getElementById('level-konsept').textContent = currentLevel.konsept;

  // Learn
  document.getElementById('learn-content').innerHTML =
    marked.parse(currentLevel.forklaring || '');
  document.getElementById('example-code').textContent = currentLevel.eksempelkode || '';

  // Task
  document.getElementById('task-text').innerHTML =
    marked.parseInline(currentLevel.oppgavetekst || '');

  // Hint counter
  const hintCount = (currentLevel.hint || []).length;
  document.getElementById('hint-count').textContent = hintCount;
  if (hintCount === 0) document.getElementById('hint-btn').style.display = 'none';

  // CodeMirror editor
  editor = CodeMirror(document.getElementById('editor-container'), {
    value: currentLevel.startkode || '# Skriv koden din her\n',
    mode: 'python',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    extraKeys: { Tab: cm => cm.execCommand('indentMore') }
  });

  // Already completed?
  if (isCompleted(levelId)) {
    document.getElementById('run-btn').classList.remove('btn-primary');
    document.getElementById('run-btn').classList.add('btn-ghost');
    document.getElementById('run-btn-text').textContent = '✓ Fullført – kjør igjen';
  }

  // Load Pyodide in background
  loadPyodideEnv();
}

async function loadPyodideEnv() {
  showLoading('Laster Python-miljø (Pyodide)…');
  try {
    pyodide = await loadPyodide();

    if (currentLevel.requires && currentLevel.requires.length > 0) {
      showLoading(`Laster pakker: ${currentLevel.requires.join(', ')}…`);
      await pyodide.loadPackage(currentLevel.requires);
    }

    pyodideReady = true;
    hideLoading();
    const btn = document.getElementById('run-btn');
    btn.disabled = false;
    document.getElementById('run-btn-text').textContent = '▶ Kjør tester';
  } catch (e) {
    showLoading('Feil ved lasting av Python-miljø. Oppdater siden.');
    console.error(e);
  }
}

function showLoading(msg) {
  document.getElementById('loading-bar').classList.remove('hidden');
  document.getElementById('loading-text').textContent = msg;
}
function hideLoading() {
  document.getElementById('loading-bar').classList.add('hidden');
}

// ─── Test-runner ──────────────────────────────────────────────────────────────

async function runTests() {
  if (!pyodideReady) return;
  const userCode = editor.getValue();
  const testcases = currentLevel.testcases || [];

  document.getElementById('test-results').classList.remove('hidden');
  document.getElementById('test-list').innerHTML = '';
  document.getElementById('test-summary').textContent = '';
  document.getElementById('test-summary').className = '';

  const results = [];

  for (const tc of testcases) {
    const result = await runSingleTest(userCode, tc);
    results.push({ tc, ...result });
    renderTestItem(tc, result);
  }

  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const summaryEl = document.getElementById('test-summary');

  if (passed === total) {
    summaryEl.textContent = `✅ Alle ${total} tester bestått! +${pointsForLevel(currentLevel.id)} poeng`;
    summaryEl.className = 'all-pass';
    markComplete(currentLevel.id);
    launchConfetti();
  } else {
    summaryEl.textContent = `${passed} av ${total} tester bestått. Prøv igjen!`;
    summaryEl.className = 'has-fail';
  }
}

async function runSingleTest(userCode, tc) {
  try {
    pyodide.globals.set('_user_code', userCode);
    pyodide.globals.set('_assert_code', tc.assert_code || '');
    pyodide.globals.set('_expected_output_val',
      (tc.expected_output !== undefined && tc.expected_output !== null) ? tc.expected_output : null);
    pyodide.globals.set('_input_list', pyodide.toPy(tc.input_values || []));

    await pyodide.runPythonAsync(`
import sys, io, builtins, traceback

_orig_input = builtins.input
_orig_stdout = sys.stdout

_input_iter = iter(_input_list)
builtins.input = lambda prompt='': next(_input_iter, '')

_captured = io.StringIO()
sys.stdout = _captured

_ns = {'__builtins__': __builtins__}
_exec_err = None

try:
    exec(_user_code, _ns)
except Exception as _e:
    _exec_err = traceback.format_exc(limit=5)
finally:
    sys.stdout = _orig_stdout
    builtins.input = _orig_input

if _exec_err:
    raise RuntimeError(_exec_err)

_output = _captured.getvalue().strip()

if _expected_output_val is not None:
    if _output != str(_expected_output_val).strip():
        raise AssertionError(f"Din kode ga feil utskrift.\\nDu skrev ut: {repr(_output)}")

if _assert_code:
    exec(_assert_code, _ns)
`);
    return { pass: true };
  } catch (e) {
    return { pass: false, error: cleanError(e.message) };
  }
}

function cleanError(msg) {
  if (!msg) return 'Ukjent feil';
  // Pyodide wraps Python exceptions — extract the useful part
  const lines = msg.split('\n').filter(l => l.trim());
  // Find the last meaningful line
  const last = lines[lines.length - 1] || msg;
  // Limit length
  return last.length > 300 ? last.substring(0, 300) + '…' : last;
}

function renderTestItem(tc, result) {
  const list = document.getElementById('test-list');
  const div = document.createElement('div');
  div.className = `test-item ${result.pass ? 'pass' : 'fail'}`;
  div.innerHTML = `
    <span class="test-icon">${result.pass ? '✅' : '❌'}</span>
    <div class="test-desc">
      <div class="test-name">${tc.beskrivelse}</div>
      ${!result.pass && result.error ? `<div class="test-error">${escHtml(result.error)}</div>` : ''}
    </div>`;
  list.appendChild(div);
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Hint ─────────────────────────────────────────────────────────────────────

function showNextHint() {
  const hints = currentLevel.hint || [];
  if (hintsShown >= hints.length) return;
  const panel = document.getElementById('hints-panel');
  const div = document.createElement('div');
  div.className = 'hint-item';
  div.innerHTML = `<span class="hint-icon">💡</span><span>Hint ${hintsShown + 1}: ${escHtml(hints[hintsShown])}</span>`;
  panel.appendChild(div);
  hintsShown++;
  const remaining = hints.length - hintsShown;
  document.getElementById('hint-count').textContent = remaining;
  if (remaining === 0) document.getElementById('hint-btn').disabled = true;
}

// ─── Reset kode ───────────────────────────────────────────────────────────────

function resetCode() {
  if (editor && currentLevel) {
    editor.setValue(currentLevel.startkode || '# Skriv koden din her\n');
  }
}

// ─── Kopier eksempel ──────────────────────────────────────────────────────────

function copyExample() {
  const code = document.getElementById('example-code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});
}

// ─── Konfetti ─────────────────────────────────────────────────────────────────

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#58a6ff','#3fb950','#d29922','#ff6b6b','#c9d1d9','#a371f7'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 200,
    w: 6 + Math.random() * 8,
    h: 6 + Math.random() * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.2,
    circle: Math.random() > 0.5
  }));

  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    });
    if (alive) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  cancelAnimationFrame(frame);
  draw();
}

// ─── Start ────────────────────────────────────────────────────────────────────

window.switchTab = switchTab;
window.runTests = runTests;
window.showNextHint = showNextHint;
window.resetCode = resetCode;
window.copyExample = copyExample;

init();
