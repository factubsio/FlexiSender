// ═══════════════════════════════════════════════
// Response parser & status reports
// ═══════════════════════════════════════════════

import { state, SIG_PIN_MAP } from './state';
import { fmtPos } from './ui';
import { log } from './console';
import { updateBufDisplay, _updateHomeBtnHomed } from './connection';
import { pumpQueue, updateRunButtons } from './streaming';
import { updateExecutedPath, toolGroup } from './viewport';
import { settingsIntercept, tryInterceptValue, onSettingWriteOk, onSettingWriteErr, tryParseSettingLine } from './settings';
import { toolTableIntercept, renderToolTable, renderModTT } from './tooltable';
import { updateOvrDisplay } from './overrides';
import { jogSyncPredicted } from './jog';
import { bearCheckPlugin, bearIntercept, bearParseStatus } from './bear';

export function parseResponse(raw: string): void {
  if (raw.startsWith('<') && raw.endsWith('>')) { parseStatus(raw.slice(1, -1)); return; }

  if (state.esPhase !== 'idle' && settingsIntercept(raw)) return;

  if (state.ttPhase === 'loading' && toolTableIntercept(raw)) return;

  if (bearIntercept(raw)) return;

  if (raw === 'ok' || raw.startsWith('error:')) {
    const sent = state.sentQueue.shift();
    if (sent) {
      state.rxInFlight = Math.max(0, state.rxInFlight - sent.bytes);
    }
    if (raw.startsWith('error:')) {
      log('err', raw + (sent ? '  ← "' + sent.line + '"' : ''));
      onSettingWriteErr(raw);
      if (state.running) { state.running = false; updateRunButtons(); log('alarm', 'Stream halted on error. Fix G-code and restart.'); }
    } else {
      if (state.pendingSettingWrite) { onSettingWriteOk(); }
    }
    pumpQueue();
    updateBufDisplay();
    return;
  }

  if (tryInterceptValue(raw)) { log('rx', raw); return; }

  if (raw.startsWith('[AXS:')) {
    const m = raw.match(/\[AXS:\d+:([A-Z]+)\]/);
    if (m) { state.controllerAxes = m[1].split(''); log('info', 'Axes: ' + state.controllerAxes.join(',')); }
    log('info', raw); return;
  }

  if (raw.startsWith('ALARM:')) {
    log('alarm', raw);
    setMachineState('ALARM');
    state.running = false; updateRunButtons();
    return;
  }

  if (raw.startsWith('[OPT:')) {
    const m = raw.match(/\[OPT:[^,]*,(\d+),(\d+)/);
    if (m) {
      const reportedRx = parseInt(m[2]);
      if (reportedRx > 0) {
        state.RX_BUFFER_SIZE = reportedRx;
        log('info', 'RX buffer: ' + state.RX_BUFFER_SIZE + ' bytes  planner blocks: ' + m[1]);
      }
    }
    log('info', raw); return;
  }

  if (raw.startsWith('[SETTING:')) { tryParseSettingLine(raw); return; }

  if (raw.match(/^\$\d+=/)) { tryParseSettingLine(raw); log('rx', raw); return; }

  if (raw.startsWith('[') || raw.startsWith('Grbl') || raw.startsWith('GrblHAL') || raw.startsWith('>')) {
    bearCheckPlugin(raw);
    log('info', raw); return;
  }
  log('rx', raw);
}

function parseStatus(s: string): void {
  const parts = s.split('|');
  setMachineState(parts[0]);
  let hasPn = false;
  for (let i = 1; i < parts.length; i++) {
    const colon = parts[i].indexOf(':');
    if (colon === -1) continue;
    const key = parts[i].slice(0, colon);
    const vals = parts[i].slice(colon + 1).split(',');
    if (key === 'MPos' || key === 'WPos') {
      state.machineX = parseFloat(vals[0]) || 0;
      state.machineY = parseFloat(vals[1]) || 0;
      state.machineZ = parseFloat(vals[2]) || 0;
      document.getElementById('droX')!.textContent = fmtPos(vals[0]);
      document.getElementById('droY')!.textContent = fmtPos(vals[1]);
      document.getElementById('droZ')!.textContent = fmtPos(vals[2]);
      const mxEl = document.getElementById('droMX'); if (mxEl) mxEl.textContent = 'M: ' + fmtPos(vals[0]);
      const myEl = document.getElementById('droMY'); if (myEl) myEl.textContent = 'M: ' + fmtPos(vals[1]);
      const mzEl = document.getElementById('droMZ'); if (mzEl) mzEl.textContent = 'M: ' + fmtPos(vals[2]);
      toolGroup.position.set(state.machineX, state.machineZ, -state.machineY);
      jogSyncPredicted();
    }
    if (key === 'FS' || key === 'F') {
      document.getElementById('feedVal')!.textContent = (vals[0] || '0') + ' mm/m';
      document.getElementById('spindleVal')!.textContent = (vals[1] || '0') + ' RPM';
    }
    if (key === 'T') {
      const tn = parseInt(vals[0]);
      if (!isNaN(tn) && tn !== state.currentToolNumber) {
        state.currentToolNumber = tn;
        if (state.ttEntries.length) renderToolTable();
      }
    }
    if (key === 'Ln') {
      const ln = parseInt(vals[0]);
      document.getElementById('lineVal')!.textContent = String(ln);
      state.segmentIndex = ln;
      updateExecutedPath(state.segmentIndex);
    }
    if (key === 'Bf') {
      document.getElementById('bufVal')!.textContent = vals[0] + ' blk / ' + vals[1] + ' B';
    }
    if (key === 'Ov') {
      const feed = parseInt(vals[0]), rapid = parseInt(vals[1]), spin = parseInt(vals[2]);
      if (!isNaN(feed)) updateOvrDisplay('feed', feed);
      if (!isNaN(rapid)) updateOvrDisplay('rapid', rapid);
      if (!isNaN(spin)) updateOvrDisplay('spindle', spin);
    }
    if (key === 'Ct') {
      const ct = parseInt(vals[0]);
      if (!isNaN(ct) && ct !== state.currentToolNumber) {
        state.currentToolNumber = ct;
        if (document.getElementById('tabpanel-tooltable')!.classList.contains('active')) {
          renderToolTable();
        }
        renderModTT();
      }
    }
    if (key === 'WCS') {
      const wcs = vals[0] && vals[0].toUpperCase();
      const sel = document.getElementById('wcsSelect') as HTMLSelectElement;
      if (sel && ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].includes(wcs)) sel.value = wcs;
    }
    if (key === 'Pn') {
      hasPn = true;
      updateSignals(vals[0] || '');
    }
    if (key === 'BEAR') {
      bearParseStatus(vals[0] || '');
    }
  }
  if (!hasPn) updateSignals('');
  document.getElementById('vpStats')!.innerHTML =
    `X: ${state.machineX.toFixed(3)}&nbsp;&nbsp;Y: ${state.machineY.toFixed(3)}&nbsp;&nbsp;Z: ${state.machineZ.toFixed(3)}<br>` +
    `RX: ${state.rxInFlight}/${state.RX_BUFFER_SIZE}B&nbsp;&nbsp;QUEUE: ${state.sentQueue.length}`;
}

function updateSignals(pinStr: string): void {
  const mod = document.getElementById('mod-signals');
  if (!mod || mod.classList.contains('mod-hidden')) return;
  const active = new Set(pinStr.toUpperCase().split(''));
  Object.entries(SIG_PIN_MAP).forEach(([ch, elId]) => {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle('active', active.has(ch));
  });
}

export function setMachineState(s: string): void {
  const badge = document.getElementById('stateBadge')!;
  badge.className = 'state-badge';
  const sl = s.toLowerCase().split(':')[0];
  if (['idle', 'run', 'hold', 'alarm', 'jog', 'home', 'door', 'check', 'sleep'].includes(sl)) badge.classList.add(sl);
  document.getElementById('stateText')!.textContent = s.toUpperCase();

  if (sl === 'alarm') { state.machineHomed = false; _updateHomeBtnHomed(); }
  if (sl === 'idle' && state._prevMachineStateSl === 'home') { state.machineHomed = true; _updateHomeBtnHomed(); }
  state._prevMachineStateSl = sl;
}
