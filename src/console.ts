// ═══════════════════════════════════════════════
// Console logging
// ═══════════════════════════════════════════════

import { state } from './state';
import { esc } from './ui';

export function log(type: string, msg: string): void {
  const out = document.getElementById('consoleOut')!;
  const cls: Record<string, string> = { tx: 'con-tx', rx: 'con-rx', ok: 'con-ok', err: 'con-err', info: 'con-info', alarm: 'con-alarm' };
  const pre: Record<string, string> = { tx: '→', rx: '←', ok: '✓', err: '✗', info: 'ℹ', alarm: '⚠' };
  const div = document.createElement('div');
  div.className = 'con-line';
  div.innerHTML = '<span class="' + (cls[type] || 'con-rx') + '">' + (pre[type] || '·') + ' ' + esc(msg) + '</span>';
  out.appendChild(div);
  if (++state.conLines > state.consoleMaxLines) { out.removeChild(out.firstChild!); state.conLines--; }
  requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
}

export function clearConsole(): void {
  document.getElementById('consoleOut')!.innerHTML = '';
  state.conLines = 0;
}
