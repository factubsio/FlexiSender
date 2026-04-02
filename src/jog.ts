// ═══════════════════════════════════════════════
// Jog engine — click, hold, keyboard
// ═══════════════════════════════════════════════

import { state, KB_JOG_MAP, KEYBOARD_JOG_DIST } from './state';
import { isInputFocused } from './ui';
import { sendCmd, rtSend, setJogging } from './connection';

export function setStepXY(v: number): void {
  state.jogStepXY = v;
  document.querySelectorAll('.xy-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function setStepZ(v: number): void {
  state.jogStepZ = v;
  document.querySelectorAll('.z-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function startJog(dir: string): void {
  if (!state.connected) return;
  const f = (document.getElementById('jogFeed') as HTMLInputElement).value;
  const step = state.jogStepXY;

  const diagMatch = dir.match(/^(X[+-])(Y[+-])$/);
  if (diagMatch) {
    const xSign = diagMatch[1][1] === '+' ? '' : '-';
    const ySign = diagMatch[2][1] === '+' ? '' : '-';
    setJogging(true);
    sendCmd('$J=G91 X' + xSign + step + ' Y' + ySign + step + ' F' + f);
    return;
  }

  const axis = dir[0], sign = dir[1] === '+' ? '' : '-';
  const axisStep = axis === 'Z' ? state.jogStepZ : state.jogStepXY;
  setJogging(true);
  sendCmd('$J=G91 ' + axis + sign + axisStep + ' F' + f);
}

export function stopJog(): void {
  if (!state._isJogging) return;
  rtSend('\x85');
  setJogging(false);
}

// ── Hold mode ─────────────────────────────────────────────────────────────────
export function setJogHoldMode(on: boolean): void {
  state.jogHoldMode = on;
  document.getElementById('jogModeClickLabel')!.style.color = on ? 'var(--text3)' : 'var(--accent)';
  document.getElementById('jogModeHoldLabel')!.style.color = on ? 'var(--accent)' : 'var(--text3)';
  if (!on && state._jogHoldActive) { state._jogHoldActive = false; stopJog(); }
}

function _jogBtnUp(e: Event): void {
  if (!state.jogHoldMode || !state._jogHoldActive) return;
  e.preventDefault();
  state._jogHoldActive = false;
  stopJog();
}

export function initJogButtons(): void {
  document.querySelectorAll<HTMLElement>('.jog-btn[data-dir]').forEach(btn => {
    const dir = btn.dataset.dir!;

    btn.addEventListener('click', () => {
      if (state.jogHoldMode) return;
      startJog(dir);
    });

    btn.addEventListener('mousedown', e => {
      if (!state.jogHoldMode) return;
      e.preventDefault();
      state._jogHoldActive = true;
      startJog(dir);
    });
    btn.addEventListener('mouseup', e => { _jogBtnUp(e); });
    btn.addEventListener('mouseleave', e => { _jogBtnUp(e); });

    btn.addEventListener('touchstart', e => {
      if (!state.jogHoldMode) return;
      e.preventDefault();
      state._jogHoldActive = true;
      startJog(dir);
    }, { passive: false });
    btn.addEventListener('touchend', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
    btn.addEventListener('touchcancel', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
  });
}

// ── Keyboard jog ──────────────────────────────────────────────────────────────
export function initKeyboardJog(): void {
  document.addEventListener('keydown', e => {
    if (!state.connected || state.running) return;
    if (isInputFocused()) return;
    const dir = KB_JOG_MAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (state.kbJogActive && state.kbJogKey === e.key) return;
    if (state.kbJogActive) cancelKbJog();

    state.kbJogActive = true;
    state.kbJogKey = e.key;
    setJogging(true);

    const f = (document.getElementById('jogFeed') as HTMLInputElement).value;
    const axis = dir[0], sign = dir[1] === '+' ? '' : '-';
    highlightJogBtn(dir, true);
    sendCmd('$J=G91 ' + axis + sign + KEYBOARD_JOG_DIST + ' F' + f);
  });

  document.addEventListener('keyup', e => {
    if (!state.kbJogActive) return;
    const dir = KB_JOG_MAP[e.key];
    if (!dir || e.key !== state.kbJogKey) return;
    e.preventDefault();
    cancelKbJog();
  });
}

function cancelKbJog(): void {
  if (!state.kbJogActive) return;
  highlightJogBtn(KB_JOG_MAP[state.kbJogKey!], false);
  state.kbJogActive = false;
  state.kbJogKey = null;
  stopJog();
}

function highlightJogBtn(dir: string, on: boolean): void {
  const textMap: Record<string, string> = { 'X-': '←', 'X+': '→', 'Y-': '↓', 'Y+': '↑', 'Z-': 'Z↓', 'Z+': 'Z↑' };
  const txt = textMap[dir];
  if (!txt) return;
  document.querySelectorAll<HTMLElement>('.jog-btn').forEach(btn => {
    if (btn.textContent!.trim() === txt) {
      btn.style.background = on ? 'var(--accent2)' : '';
      btn.style.color = on ? '#000' : '';
    }
  });
}
