// ═══════════════════════════════════════════════
// Jog engine — click, hold, keyboard
// ═══════════════════════════════════════════════

import { state, KB_JOG_MAP, KEYBOARD_JOG_DIST } from './state';
import { isInputFocused } from './ui';
import { sendCmd, rtSend, setJogging } from './connection';
import { scene, toolGroup } from './viewport';

declare const THREE: any;

// ── Jog preview in 3D ────────────────────────────────────────────────────────
let _jogPreview: any = null;  // marker or arrow
let _jogPreviewLine: any = null;

function clearJogPreview(): void {
  if (_jogPreview) {
    scene.remove(_jogPreview);
    _jogPreview.traverse?.((c: any) => { c.geometry?.dispose(); c.material?.dispose(); });
    _jogPreview = null;
  }
  if (_jogPreviewLine) { scene.remove(_jogPreviewLine); _jogPreviewLine.geometry?.dispose(); _jogPreviewLine.material?.dispose(); _jogPreviewLine = null; }
}

function jogDirToVec(dir: string): { x: number; y: number; z: number } {
  let x = 0, y = 0, z = 0;
  if (dir.includes('X+')) x = 1; if (dir.includes('X-')) x = -1;
  if (dir.includes('Y+')) y = 1; if (dir.includes('Y-')) y = -1;
  if (dir.includes('Z+')) z = 1; if (dir.includes('Z-')) z = -1;
  return { x, y, z };
}

function showJogPreview(dir: string): void {
  clearJogPreview();
  const v = jogDirToVec(dir);
  const pos = toolGroup.position;
  // Color based on dominant axis
  const color = v.z !== 0 ? 0x3399ff : v.x !== 0 && v.y !== 0 ? 0xffaa00 : v.x !== 0 ? 0xff3333 : 0x33ff66;

  if (state.jogHoldMode) {
    // Arrow showing direction
    const len = 30;
    const arrowDir = new THREE.Vector3(v.x, v.z, -v.y).normalize();
    const arrow = new THREE.ArrowHelper(arrowDir, pos.clone(), len, color, len * 0.3, len * 0.15);
    scene.add(arrow);
    _jogPreview = arrow;
  } else {
    // Ghost toolhead at target position
    const stepX = v.x * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepY = v.y * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepZ = v.z * state.jogStepZ;
    const tx = pos.x + stepX;
    const ty = pos.y + stepZ;
    const tz = pos.z - stepY;

    // Dashed line from current to target
    const pts = [pos.clone(), new THREE.Vector3(tx, ty, tz)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    _jogPreviewLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 }));
    _jogPreviewLine.computeLineDistances();
    scene.add(_jogPreviewLine);

    // Ghost head — same shape as toolhead but translucent
    const ghostMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
    const ghost = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.5, 4, 8), ghostMat);
    cone.rotation.x = Math.PI;
    cone.position.y = 2;
    ghost.add(cone);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 8), ghostMat);
    body.position.y = 7;
    ghost.add(body);
    ghost.position.set(tx, ty, tz);
    scene.add(ghost);
    _jogPreview = ghost;
  }
}

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

    // Color by axis
    const v = jogDirToVec(dir);
    if (v.z !== 0) { btn.style.color = '#5588ff'; btn.style.background = 'rgba(55,88,255,0.15)'; }
    else if (v.x !== 0 && v.y === 0) { btn.style.color = '#ff5555'; }
    else if (v.y !== 0 && v.x === 0) { btn.style.color = '#55ff77'; }
    else if (v.x !== 0 && v.y !== 0) { btn.style.color = '#ffaa44'; }

    // Hover → show 3D preview
    btn.addEventListener('mouseenter', () => { showJogPreview(dir); });
    btn.addEventListener('mouseleave', () => { clearJogPreview(); });

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
