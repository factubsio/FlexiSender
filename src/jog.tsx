// ═══════════════════════════════════════════════
// Jog engine — click, hold, keyboard
// ═══════════════════════════════════════════════

import { h } from './jsx';
import { state, KB_JOG_MAP, KEYBOARD_JOG_DIST } from './state';
import { isInputFocused } from './ui';
import { sendCmd, rtSend, setJogging } from './connection';
import { goToXY0 } from './streaming';
import { scene, toolGroup } from './viewport';

declare const THREE: any;

// ── Element refs (set during mount) ───────────────────────────────────────────
let _feedSlider: HTMLInputElement;
let _feedVal: HTMLElement;
let _clickLabel: HTMLElement;
let _holdLabel: HTMLElement;
let _xyStepContainer: HTMLElement;
let _zStepContainer: HTMLElement;

// ── Jog preview in 3D ────────────────────────────────────────────────────────
let _jogPreview: any = null;
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
  const color = v.z !== 0 ? 0x3399ff : v.x !== 0 && v.y !== 0 ? 0xffaa00 : v.x !== 0 ? 0xff3333 : 0x33ff66;

  if (state.jogHoldMode) {
    const len = 30;
    const arrowDir = new THREE.Vector3(v.x, v.z, -v.y).normalize();
    const arrow = new THREE.ArrowHelper(arrowDir, pos.clone(), len, color, len * 0.3, len * 0.15);
    scene.add(arrow);
    _jogPreview = arrow;
  } else {
    const stepX = v.x * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepY = v.y * (v.z !== 0 ? 0 : state.jogStepXY);
    const stepZ = v.z * state.jogStepZ;
    const tx = pos.x + stepX;
    const ty = pos.y + stepZ;
    const tz = pos.z - stepY;

    const pts = [pos.clone(), new THREE.Vector3(tx, ty, tz)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    _jogPreviewLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 }));
    _jogPreviewLine.computeLineDistances();
    scene.add(_jogPreviewLine);

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

// ── Step sizes ────────────────────────────────────────────────────────────────

export function setStepXY(v: number): void {
  state.jogStepXY = v;
  _xyStepContainer?.querySelectorAll('.xy-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function setStepZ(v: number): void {
  state.jogStepZ = v;
  _zStepContainer?.querySelectorAll('.z-step-btn').forEach(b => b.classList.toggle('active', parseFloat(b.textContent!) === v));
}

export function rebuildSteps(xySteps: number[], zSteps: number[]): void {
  if (_xyStepContainer) buildStepBtns(_xyStepContainer, xySteps, 'xy-step-btn', 10, setStepXY);
  if (_zStepContainer) buildStepBtns(_zStepContainer, zSteps, 'z-step-btn', 1, setStepZ);
}

function buildStepBtns(container: HTMLElement, steps: number[], cls: string, defaultStep: number, setter: (v: number) => void): void {
  container.innerHTML = '';
  for (const v of steps) {
    const btn = <button class={'step-btn ' + cls + (v === defaultStep ? ' active' : '')} onClick={() => setter(v)}>{v}</button>;
    container.appendChild(btn);
  }
}

// ── Jog commands ──────────────────────────────────────────────────────────────

function jogFeedValue(): string { return _feedSlider?.value || '1000'; }

export function startJog(dir: string): void {
  if (!state.connected) return;
  const f = jogFeedValue();
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
  if (_clickLabel) _clickLabel.style.color = on ? 'var(--text3)' : 'var(--accent)';
  if (_holdLabel) _holdLabel.style.color = on ? 'var(--accent)' : 'var(--text3)';
  if (!on && state._jogHoldActive) { state._jogHoldActive = false; stopJog(); }
}

function _jogBtnUp(e: Event): void {
  if (!state.jogHoldMode || !state._jogHoldActive) return;
  e.preventDefault();
  state._jogHoldActive = false;
  stopJog();
}

// ── Wire a single jog direction button ────────────────────────────────────────

function wireJogBtn(btn: HTMLElement, dir: string): void {
  const v = jogDirToVec(dir);
  if (v.z !== 0) { btn.style.color = '#5588ff'; btn.style.background = 'rgba(55,88,255,0.15)'; }
  else if (v.x !== 0 && v.y === 0) { btn.style.color = '#ff5555'; }
  else if (v.y !== 0 && v.x === 0) { btn.style.color = '#55ff77'; }
  else if (v.x !== 0 && v.y !== 0) { btn.style.color = '#ffaa44'; }

  btn.addEventListener('mouseenter', () => showJogPreview(dir));
  btn.addEventListener('mouseleave', () => clearJogPreview());

  btn.addEventListener('click', () => { if (!state.jogHoldMode) startJog(dir); });

  btn.addEventListener('mousedown', e => { if (!state.jogHoldMode) return; e.preventDefault(); state._jogHoldActive = true; startJog(dir); });
  btn.addEventListener('mouseup', e => _jogBtnUp(e));
  btn.addEventListener('mouseleave', e => _jogBtnUp(e));

  btn.addEventListener('touchstart', e => { if (!state.jogHoldMode) return; e.preventDefault(); state._jogHoldActive = true; startJog(dir); }, { passive: false });
  btn.addEventListener('touchend', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
  btn.addEventListener('touchcancel', e => { if (state.jogHoldMode) { e.preventDefault(); _jogBtnUp(e); } }, { passive: false });
}

// ── Jog button JSX helper ─────────────────────────────────────────────────────

function JogBtn({ dir, class: cls, style, children }: { dir: string; class?: string; style?: string; children?: any }): HTMLElement {
  const btn = <button class={'jog-btn ' + (cls || '')} style={style || ''} dataset={{ dir }}>{children}</button> as HTMLElement;
  wireJogBtn(btn, dir);
  return btn;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mount(parent: HTMLElement): void {
  const card = (
    <div class="module-card mod-hidden" id="mod-jogging" dataset={{ modSize: 'normal' }} style="top:10px;left:302px">
      <div class="module-drag-handle">
        <span class="module-drag-dots">⠿⠿</span>
        <span class="module-drag-title">Jogging</span>
        <div class="jog-mode-toggle">
          <span class="jog-mode-label" style="color:var(--accent)" ref={(el: HTMLElement) => { _clickLabel = el; }}>CLICK</span>
          <label class="jog-mode-switch-wrap" title="Toggle: Click (step) vs Hold (stop on release)">
            <input type="checkbox" onChange={(e: Event) => setJogHoldMode((e.target as HTMLInputElement).checked)} />
            <span class="jog-mode-slider"></span>
          </label>
          <span class="jog-mode-label" ref={(el: HTMLElement) => { _holdLabel = el; }}>HOLD</span>
        </div>
        <button class="module-drag-close" onClick={() => { card.classList.add('mod-hidden'); }}>✕</button>
      </div>
      <div class="module-body">
        <div class="jog-section" style="border:none;padding:4px 0;background:transparent">
          <div class="jog-row">
            <div class="jog-grid">
              <JogBtn dir="X-Y+" class="diag">↖</JogBtn>
              <JogBtn dir="Y+">↑</JogBtn>
              <JogBtn dir="X+Y+" class="diag">↗</JogBtn>
              <JogBtn dir="X-">←</JogBtn>
              <button class="jog-btn danger" style="font-size:11px;font-family:var(--cond);letter-spacing:1px" onClick={() => stopJog()}>■ STOP</button>
              <JogBtn dir="X+">→</JogBtn>
              <JogBtn dir="X-Y-" class="diag">↙</JogBtn>
              <JogBtn dir="Y-">↓</JogBtn>
              <JogBtn dir="X+Y-" class="diag">↘</JogBtn>
            </div>
            <div class="jog-z-col">
              <JogBtn dir="Z+" class="z-up" style="width:48px;height:48px">Z↑</JogBtn>
              <JogBtn dir="Z-" class="z-down" style="width:48px;height:48px">Z↓</JogBtn>
              <button class="jog-btn" style="width:48px;height:48px;font-size:10px;font-family:var(--cond);letter-spacing:0.5px" onClick={() => goToXY0()}>XY0</button>
            </div>
          </div>
        </div>
        <div class="feed-row" style="margin-top:2px">
          <span class="feed-label">JOG F</span>
          <input type="range" class="feed-slider" min="100" max="3000" value="1000"
            ref={(el: HTMLInputElement) => { _feedSlider = el; }}
            onInput={() => { _feedVal.textContent = _feedSlider.value; }} />
          <span class="feed-val" ref={(el: HTMLElement) => { _feedVal = el; }}>1000</span>
        </div>
        <div class="jog-step-axis-row">
          <span class="jog-step-axis-label">XY</span>
          <div class="jog-step-axis-btns" ref={(el: HTMLElement) => { _xyStepContainer = el; }}>
            {[0.01, 0.1, 1, 10, 50].map(v =>
              <button class={'step-btn xy-step-btn' + (v === 10 ? ' active' : '')} onClick={() => setStepXY(v)}>{v}</button>
            )}
          </div>
        </div>
        <div class="jog-step-axis-row">
          <span class="jog-step-axis-label">Z</span>
          <div class="jog-step-axis-btns" ref={(el: HTMLElement) => { _zStepContainer = el; }}>
            {[0.01, 0.1, 1, 5, 10].map(v =>
              <button class={'step-btn z-step-btn' + (v === 1 ? ' active' : '')} onClick={() => setStepZ(v)}>{v}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  ) as HTMLElement;

  parent.appendChild(card);
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

    const f = jogFeedValue();
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
