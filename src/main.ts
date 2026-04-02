// ═══════════════════════════════════════════════
// Main entry point — wires modules, exposes globals
// ═══════════════════════════════════════════════

import { state } from './state';
import { log, clearConsole } from './console';
import { toggleConnect, sendCmd } from './connection';
import { initViewport, setView, fitView, toggleToolhead, vpApply, setProjection } from './viewport';
import { loadFile, uploadAndOpenFile, frameProgram } from './gcode';
import { startJob, pauseJob, stopJob, updateRunButtons, sendReset, unlockAlarm, sendHome, goToXY0, setWCS, sendManual, handleConInput } from './streaming';
import { setStepXY, setStepZ, setJogHoldMode, initJogButtons, initKeyboardJog } from './jog';
import { resetOverride, applyOverride, setSpindle, toggleCoolant } from './overrides';
import { loadSettings, filterSettings, writeAllDirty } from './settings';
import { loadToolTable } from './tooltable';
import { toggleSdPanel, closeSdPanel, sdRefreshFiles, sdRunSelected, initSdClickOutside } from './sd';
import { initCameraTab, selectCamera, startCamera, stopCamera, measureOffset, goToCamera, goToSpindle, zeroAtCrosshair, camMouseDown, camMouseMove, camMouseUp, setCrosshairStyle, setCrosshairColor, loadCamSettings, saveCamSettings, drawOverlay, initCameraListeners } from './camera';
import { kbdPress, kbdBackspace, kbdClear, kbdSend, toggleTouchKeyboard } from './keyboard';
import { toggleModule, setModSize, setConsoleLines, modInitPositions, toggleModLock, modDragStart, modTouchStart, initModDragListeners } from './modules';
import { initDock, dockModule, undockModule } from './dock';
import { optSetConnMode, optSaveConnSettings, optLoadConnSettings, optLoadColors, optLoadTabLocks, optBuildTabLockList, initToolbarOptions, saveTbOpt, optApplyColor, optHexChange, optResetColor, optResetAllColors } from './options';

// ── Tab switching ─────────────────────────────────────────────────────────────
export function switchTab(tab: string): void {
  if (tab !== 'options' && state._lockedTabs.has(tab)) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab)!.classList.add('active');
  document.getElementById('tabpanel-' + tab)!.classList.add('active');
  if (tab === 'settings' && !state.settingsLoaded && state.connected) loadSettings();
  if (tab === 'camera' && !state._camTabInited) { state._camTabInited = true; initCameraTab(); }
  if (tab === 'tooltable') loadToolTable();
}

// ── Expose to window for HTML onclick handlers ────────────────────────────────
const w = window as any;

// Connection
w.toggleConnect = toggleConnect;
w.sendCmd = sendCmd;
w.sendReset = sendReset;
w.unlockAlarm = unlockAlarm;
w.sendHome = sendHome;

// Job
w.startJob = startJob;
w.pauseJob = pauseJob;
w.stopJob = stopJob;

// File
w.loadFile = loadFile;
w.uploadAndOpenFile = uploadAndOpenFile;

// Viewport
w.setView = (v: string) => { setView(v); /* highlight button from event */ };
w.fitView = fitView;
w.toggleToolhead = toggleToolhead;
w.vpApply = vpApply;
w.setProjection = setProjection;

// Jog
w.setStepXY = setStepXY;
w.setStepZ = setStepZ;
w.setJogHoldMode = setJogHoldMode;
w.goToXY0 = goToXY0;

// Overrides
w.resetOverride = resetOverride;
w.applyOverride = applyOverride;
w.setSpindle = setSpindle;
w.toggleCoolant = toggleCoolant;

// Settings
w.loadSettings = loadSettings;
w.filterSettings = filterSettings;
w.writeAllDirty = writeAllDirty;

// Tool table
w.loadToolTable = loadToolTable;

// SD
w.toggleSdPanel = toggleSdPanel;
w.closeSdPanel = closeSdPanel;
w.sdRefreshFiles = sdRefreshFiles;
w.sdRunSelected = sdRunSelected;

// Camera
w.selectCamera = selectCamera;
w.startCamera = startCamera;
w.stopCamera = stopCamera;
w.measureOffset = measureOffset;
w.goToCamera = goToCamera;
w.goToSpindle = goToSpindle;
w.zeroAtCrosshair = zeroAtCrosshair;
w.camMouseDown = camMouseDown;
w.camMouseMove = camMouseMove;
w.camMouseUp = camMouseUp;
w.setCrosshairStyle = setCrosshairStyle;
w.setCrosshairColor = setCrosshairColor;
w.drawOverlay = drawOverlay;

// Keyboard
w.kbdPress = kbdPress;
w.kbdBackspace = kbdBackspace;
w.kbdClear = kbdClear;
w.kbdSend = kbdSend;
w.toggleTouchKeyboard = toggleTouchKeyboard;

// Modules
w.toggleModule = toggleModule;
w.setModSize = setModSize;
w.setConsoleLines = setConsoleLines;
w.toggleModLock = toggleModLock;
w.modDragStart = modDragStart;
w.modTouchStart = modTouchStart;
w.dockModule = dockModule;
w.undockModule = undockModule;

// Tabs
w.switchTab = switchTab;

// Console
w.clearConsole = clearConsole;
w.sendManual = sendManual;
w.handleConInput = handleConInput;

// WCS
w.setWCS = setWCS;

// Options
w.optSetConnMode = optSetConnMode;
w.optSaveConnSettings = optSaveConnSettings;
w.saveTbOpt = saveTbOpt;
w.optApplyColor = optApplyColor;
w.optHexChange = optHexChange;
w.optResetColor = optResetColor;
w.optResetAllColors = optResetAllColors;

// Frame
w.frameProgram = frameProgram;

// ── Init ──────────────────────────────────────────────────────────────────────
initViewport();
initJogButtons();
initKeyboardJog();
initModDragListeners();
initSdClickOutside();
initCameraListeners();
loadCamSettings();

log('info', 'FlexiSender ready — IOSender-compatible character-counting stream.');
log('info', 'Open a G-code file to preview the toolpath, then connect and run.');
updateRunButtons();

window.addEventListener('load', () => {
  modInitPositions();
  const mainEl = document.querySelector('.viewport-wrap') as HTMLElement;
  if (mainEl) initDock(mainEl);
  try { if (localStorage.getItem('fs-mod-locked') === '1') toggleModLock(); } catch (_) {}
  const fields: Record<string, number> = { vpXMin: state.vpXMin, vpXMax: state.vpXMax, vpYMin: state.vpYMin, vpYMax: state.vpYMax };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(val);
  }
  optLoadConnSettings();
  optLoadColors();
  optLoadTabLocks();
  optBuildTabLockList();
  initToolbarOptions();
  // Sync projection toggle
  const projPersp = document.getElementById('projBtnPersp');
  const projOrtho = document.getElementById('projBtnOrtho');
  if (projPersp && projOrtho) {
    projPersp.classList.toggle('selected', !state.vpOrtho);
    projOrtho.classList.toggle('selected', state.vpOrtho);
  }
});
