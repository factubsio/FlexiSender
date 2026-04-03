// ═══════════════════════════════════════════════
// JOB CONTROL — character-counting pump
// ═══════════════════════════════════════════════

import { state } from './state';
import { byteLen } from './ui';
import { log } from './console';
import { cmdSend, rtSend } from './connection';
import { updateProgress } from './gcode';

export function startJob(): void {
  if (!state.connected) { log('err', 'Not connected'); return; }
  if (state.gcodeLines.length === 0) { log('err', 'No file loaded'); return; }
  if (state.running && !state.paused) return;
  if (state.paused) {
    state.paused = false;
    rtSend('~');
    log('info', 'Resumed');
    updateRunButtons();
    return;
  }
  state.running = true; state.paused = false;
  state.lineHead = 0; state.rxInFlight = 0; state.sentQueue.length = 0; state.segmentIndex = 0;
  state.esPhase = 'idle';
  updateRunButtons();
  log('info', 'Starting job: ' + state.gcodeLines.length + ' lines  (RX buffer: ' + state.RX_BUFFER_SIZE + ' bytes)');
  pumpQueue();
}

function stripComment(line: string): string {
  return line.replace(/\(.*?\)/g, '').replace(/;.*/, '').trim();
}

export function pumpQueue(): void {
  if (!state.running || state.paused) return;
  try { _pumpQueue(); } catch (e: any) { log('err', 'pumpQueue: ' + e.message); state.running = false; updateRunButtons(); }
}

function _pumpQueue(): void {
  const hwm = state.RX_BUFFER_SIZE - 1;

  while (state.lineHead < state.gcodeLines.length) {
    const raw = state.gcodeLines[state.lineHead];
    const stripped = stripComment(raw).trim().toUpperCase();

    if (!stripped) { state.lineHead++; continue; }

    const wouldCost = byteLen(stripped + '\n');

    if (state.rxInFlight + wouldCost > hwm) break;

    cmdSend(stripped);
    log('tx', stripped);
    state.lineHead++;
    updateProgress(state.lineHead, state.gcodeLines.length);
  }

  if (state.lineHead >= state.gcodeLines.length && state.sentQueue.length === 0 && state.running) {
    state.running = false;
    log('info', '✓ Job complete');
    updateRunButtons();
  }
}

export function pauseJob(): void {
  if (!state.running) return;
  state.paused = !state.paused;
  rtSend(state.paused ? '!' : '~');
  log('info', state.paused ? 'Feed hold sent' : 'Cycle resume sent');
  updateRunButtons();
}

export function stopJob(): void {
  if (!state.running && !state.paused) return;
  state.running = false; state.paused = false;
  rtSend('!');
  setTimeout(() => rtSend('\x18'), 150);
  state.rxInFlight = 0; state.sentQueue.length = 0; state.lineHead = 0;
  log('info', 'Job stopped — soft reset sent');
  updateRunButtons();
}

export function updateRunButtons(): void {
  ['btnStart'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = state.running && !state.paused; });
  ['btnPause'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = !state.running; });
  ['btnStop'].forEach(id => { (document.getElementById(id) as HTMLButtonElement).disabled = !state.running && !state.paused; });
}

export function sendReset(): void {
  if (!state.connected) return;
  rtSend('\x18');
  state.running = false; state.paused = false;
  state.rxInFlight = 0; state.sentQueue.length = 0; state.lineHead = 0;
  log('info', 'Soft reset');
  updateRunButtons();
}

export function unlockAlarm(): void { import('./connection').then(c => c.sendCmd('$X')); }
export function sendHome(): void { import('./connection').then(c => c.sendCmd('$H')); }
export function goToXY0(): void { import('./connection').then(c => c.sendCmd('G0 X0 Y0')); }

export function setWCS(code: string): void {
  import('./connection').then(c => {
    c.sendCmd(code);
    log('info', 'WCS set to ' + code);
  });
}

export function sendManual(): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  const raw = inp.value.trim();
  if (!raw) return;
  state.cmdHistory.unshift(raw); state.histIdx = -1; inp.value = '';
  _hintHide();
  const cmds = raw.split(';').map(s => s.trim()).filter(Boolean);
  import('./connection').then(c => { for (const cmd of cmds) c.sendCmd(cmd); });
}

export function handleConInput(e: KeyboardEvent): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  // Autocomplete navigation
  if (_acVisible) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _acSelect((_acIdx + 1) % _acItems.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _acSelect(_acIdx <= 0 ? _acItems.length - 1 : _acIdx - 1); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && _acIdx >= 0)) { e.preventDefault(); _acAccept(inp); return; }
    if (e.key === 'Escape') { _acHide(); return; }
  }
  if (e.key === 'Enter') { _acHide(); sendManual(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); state.histIdx = Math.min(state.histIdx + 1, state.cmdHistory.length - 1); inp.value = state.cmdHistory[state.histIdx] || ''; _acHide(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); state.histIdx = Math.max(state.histIdx - 1, -1); inp.value = state.histIdx >= 0 ? state.cmdHistory[state.histIdx] : ''; _acHide(); }
  // Readline
  if (e.ctrlKey && e.key === 'u') { e.preventDefault(); inp.value = inp.value.slice(inp.selectionStart!); inp.selectionStart = inp.selectionEnd = 0; }
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); inp.value = inp.value.slice(0, inp.selectionStart!); }
  if (e.ctrlKey && e.key === 'c') { e.preventDefault(); inp.value = ''; state.histIdx = -1; _acHide(); }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); const pos = inp.selectionStart!; const before = inp.value.slice(0, pos); const trimmed = before.replace(/\s*\S+\s*$/, ''); inp.value = trimmed + inp.value.slice(pos); inp.selectionStart = inp.selectionEnd = trimmed.length; }
}

// ── Console autocomplete ──────────────────────────────────────────────────────
let _acVisible = false;
let _acIdx = -1;
let _acItems: { id: number; name: string }[] = [];

function _settingName(id: number): string {
  const def = state.settingsDefs[id];
  return def?.name || `Setting ${id}`;
}

export function conAutoUpdate(): void {
  const inp = document.getElementById('conInput') as HTMLInputElement;
  const val = inp.value;

  // Find the last command segment (after last ;)
  const lastSemi = val.lastIndexOf(';');
  const segment = val.slice(lastSemi + 1).trimStart();

  // Param hint: show setting name when $ID= is typed
  _updateParamHint(segment, inp);

  if (!segment.startsWith('$') || segment.includes('=') || !state.settingsLoaded) { _acHide(); return; }

  const query = segment.slice(1).toLowerCase().replace(/\s+/g, '_');
  if (query.length === 0) { _acHide(); return; }

  // Filter settings by name
  _acItems = [];
  for (const [idStr, def] of Object.entries(state.settingsDefs)) {
    const name = (def.name || '').toLowerCase().replace(/\s+/g, '_');
    if (name.includes(query)) {
      _acItems.push({ id: parseInt(idStr), name: def.name });
    }
    if (_acItems.length >= 12) break;
  }

  if (_acItems.length === 0) { _acHide(); return; }

  const container = document.getElementById('conAutocomplete');
  if (!container) return;
  container.innerHTML = '';
  _acItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'con-ac-item';
    div.innerHTML = `<span>${item.name.replace(/\s+/g, '_')}</span><span class="con-ac-id">$${item.id}</span>`;
    div.onmousedown = (e) => { e.preventDefault(); _acIdx = i; _acAccept(inp); };
    container.appendChild(div);
  });
  _acIdx = 0;
  _acSelect(0);
  container.classList.add('visible');
  _acVisible = true;
}

function _acSelect(idx: number): void {
  _acIdx = idx;
  const container = document.getElementById('conAutocomplete');
  if (!container) return;
  container.querySelectorAll('.con-ac-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
    if (i === idx) el.scrollIntoView({ block: 'nearest' });
  });
}

function _acAccept(inp: HTMLInputElement): void {
  if (_acIdx < 0 || _acIdx >= _acItems.length) return;
  const item = _acItems[_acIdx];
  const val = inp.value;
  const lastSemi = val.lastIndexOf(';');
  const prefix = lastSemi >= 0 ? val.slice(0, lastSemi + 1) + ' ' : '';
  inp.value = prefix + '$' + item.id + '=';
  _acHide();
  inp.focus();
}

function _ensureHintEl(): HTMLElement {
  let hint = document.getElementById('conParamHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'conParamHint';
    hint.className = 'con-param-hint';
    document.body.appendChild(hint);
  }
  return hint;
}

function _updateParamHint(segment: string, inp: HTMLInputElement): void {
  const hint = _ensureHintEl();
  const m = segment.match(/^\$(\d+)=/);
  if (!m || !state.settingsLoaded) { hint.classList.remove('visible'); return; }
  const id = parseInt(m[1]);
  const def = state.settingsDefs[id];
  if (def) {
    const curVal = state.settingsValues[id];
    hint.textContent = def.name + (curVal !== undefined ? ` (current: ${curVal})` : '');
    hint.style.color = '';
  } else {
    hint.textContent = '⚠ Unknown setting $' + id;
    hint.style.color = 'var(--yellow)';
  }
  // Position next to the module card
  const card = inp.closest('.module-card') || inp.closest('.right-console-wrap') || inp;
  const rect = card.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  hint.style.top = (rect.bottom - 30) + 'px';
  if (midX > window.innerWidth / 2) {
    hint.style.left = '';
    hint.style.right = (window.innerWidth - rect.left + 8) + 'px';
  } else {
    hint.style.right = '';
    hint.style.left = (rect.right + 8) + 'px';
  }
  hint.classList.add('visible');
}

function _acHide(): void {
  _acVisible = false;
  _acIdx = -1;
  const container = document.getElementById('conAutocomplete');
  if (container) { container.classList.remove('visible'); container.innerHTML = ''; }
}

function _hintHide(): void {
  const hint = document.getElementById('conParamHint');
  if (hint) hint.classList.remove('visible');
}
