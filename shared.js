/* ============================================================
   shared.js — Общие утилиты, формат уровня, storage, SW-регистрация
   ============================================================ */
(function (global) {
'use strict';

const PC = global.PC = global.PC || {};

PC.constants = Object.freeze({
  PINCH_START_DELAY_MS: 80,
  SAVE_DEBOUNCE_MS:     500,
  MIN_ZOOM:             1,
  EXPORT_SIZE:          1024,
  IMPORT_MAX_BYTES:     5 * 1024 * 1024,
  MAX_COLORS:           255,
  INITIAL_COLORS:       50,
});

PC.$ = function (id) { return document.getElementById(id); };

PC.escapeHtml = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

let _vibrateOK = null;
PC.haptic = function (pattern) {
  if (_vibrateOK === null) {
    try { _vibrateOK = typeof navigator.vibrate === 'function'; } catch (_) { _vibrateOK = false; }
  }
  if (!_vibrateOK) return;
  try { navigator.vibrate(pattern); } catch (_) {}
};

let _toastEl = null, _toastTimer = null;
PC.toast = function (msg, durationMs) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'toast';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  void _toastEl.offsetWidth;
  _toastEl.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () {
    _toastEl.classList.remove('show');
    _toastTimer = null;
  }, durationMs || 2000);
};

PC.HEX_RE = /^#[0-9a-fA-F]{6}$/;

PC.contrastColor = function (hex) {
  if (!PC.HEX_RE.test(hex || '')) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#101018' : '#FFFFFF';
};

PC.grayscaleHex = function (hex) {
  if (!PC.HEX_RE.test(hex || '')) return '#888888';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const h = Math.round(0.299 * r + 0.587 * g + 0.114 * b).toString(16).padStart(2, '0');
  return '#' + h + h + h;
};

/* ---------- Формат уровня ---------- */
const LF = PC.levelFormat = {};

LF.isHexRows = function (rows, size) {
  return Array.isArray(rows) && rows.length === size &&
         String(rows[0]).length === size * 2;
};

LF.parseLevel = function (raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ожидался объект');
  if (typeof raw.name !== 'string' || !raw.name) throw new Error('отсутствует name');
  if (!Number.isInteger(raw.size) || raw.size < 4 || raw.size > 256) {
    throw new Error('size должен быть целым 4..256');
  }
  if (!Array.isArray(raw.palette) || raw.palette.length < 2 || raw.palette[0] !== null) {
    throw new Error('palette[0] должен быть null');
  }
  if (!Array.isArray(raw.rows) || raw.rows.length !== raw.size) {
    throw new Error('rows.length должен быть ' + raw.size);
  }

  const size = raw.size, cellCount = size * size;
  const cells = new Uint8Array(cellCount);
  const isHex = LF.isHexRows(raw.rows, size);
  const palLen = raw.palette.length;

  for (let y = 0; y < size; y++) {
    const row = String(raw.rows[y]);
    if (isHex) {
      if (row.length !== size * 2) throw new Error('строка ' + y + ' длиной ' + row.length + ', ожидалось ' + size * 2);
      for (let x = 0; x < size; x++) {
        const code = parseInt(row.substr(x * 2, 2), 16);
        if (!Number.isFinite(code) || code < 1 || code >= palLen) throw new Error('неверный код в строке ' + y + ', колонка ' + x);
        cells[y * size + x] = code;
      }
    } else {
      if (row.length !== size) throw new Error('строка ' + y + ' длиной ' + row.length + ', ожидалось ' + size);
      for (let x = 0; x < size; x++) {
        const ch = row.charCodeAt(x);
        let code;
        if (ch >= 49 && ch <= 57) code = ch - 48;
        else if (ch >= 97 && ch <= 102) code = ch - 87;
        else throw new Error('неверный символ в строке ' + y + ', колонка ' + x);
        if (code < 1 || code >= palLen) throw new Error('цвет ' + code + ' вне палитры');
        cells[y * size + x] = code;
      }
    }
  }

  const previewBg = (Number.isInteger(raw.previewBg) && raw.previewBg >= 1 && raw.previewBg < palLen)
    ? raw.previewBg : 1;

  return Object.freeze({
    name: raw.name,
    size: size,
    cellCount: cellCount,
    previewBg: previewBg,
    palette: Object.freeze(raw.palette.slice()),
    cells: cells,
  });
};

LF.encodeRowsHex = function (cells, size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const c = cells[y * size + x];
      if (c === 0) throw new Error('Есть незаполненные клетки. Заполните всё поле.');
      row += c.toString(16).padStart(2, '0');
    }
    rows.push(row);
  }
  return rows;
};

PC.buildLevels = function (rawList) {
  if (!Array.isArray(rawList)) throw new Error('LEVELS_DATA: ожидался массив');
  return rawList.map(function (raw, i) {
    try { return LF.parseLevel(raw); }
    catch (e) { throw new Error('LEVELS_DATA[' + i + ']: ' + (e && e.message || e)); }
  });
};

/* ---------- Storage ---------- */
const Storage = PC.storage = {};
const STORAGE_KEY = 'pixelcolor.v2';
let _cache = null;

function _read() {
  if (_cache) return _cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    _cache = (parsed && parsed.v === 2 && typeof parsed.levels === 'object')
      ? parsed : { v: 2, levels: {} };
  } catch (_) {
    console.warn('[storage] не удалось распарсить сохранение');
    _cache = { v: 2, levels: {} };
  }
  return _cache;
}

function _write() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
    return true;
  } catch (e) {
    console.warn('[storage] ошибка записи:', e && e.name);
    PC.toast('Не удалось сохранить прогресс');
    return false;
  }
}

Storage.encodeBits = function (arr) {
  const bytes = new Uint8Array(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

Storage.decodeBits = function (str, len) {
  try {
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) if (bytes[i >> 3] & (1 << (i & 7))) out[i] = 1;
    return out;
  } catch (_) { return null; }
};

Storage.load = function (index) {
  const s = _read().levels[index];
  return (s && typeof s.filled === 'string' && typeof s.cells === 'number') ? s : null;
};

Storage.save = function (index, filled) {
  _read().levels[index] = { filled: Storage.encodeBits(filled), cells: filled.length };
  _write();
};

Storage.clear = function (index) {
  delete _read().levels[index];
  _write();
};

Storage.isComplete = function (index, cellCount) {
  const s = Storage.load(index);
  if (!s || s.cells !== cellCount) return false;
  const bits = Storage.decodeBits(s.filled, cellCount);
  if (!bits) return false;
  for (let j = 0; j < cellCount; j++) if (!bits[j]) return false;
  return true;
};

Storage.decodeForLevel = function (index, cellCount) {
  const s = Storage.load(index);
  if (!s || s.cells !== cellCount) return null;
  return Storage.decodeBits(s.filled, cellCount);
};

/* ---------- Service Worker ---------- */
PC.initServiceWorker = function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  let updateBar = document.getElementById('pc-update-bar');
  if (!updateBar) {
    updateBar = document.createElement('div');
    updateBar.id = 'pc-update-bar';
    updateBar.className = 'update-bar';
    updateBar.hidden = true;
    updateBar.setAttribute('role', 'status');
    updateBar.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.className = 'update-bar__text';
    text.textContent = 'Доступна новая версия';

    const btn = document.createElement('button');
    btn.className = 'update-bar__btn';
    btn.type = 'button';
    btn.textContent = 'Обновить';

    updateBar.appendChild(text);
    updateBar.appendChild(btn);
    document.body.appendChild(updateBar);
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showUpdateBar(reg) {
    if (!reg || !reg.waiting) return;
    updateBar.hidden = false;
    updateBar.querySelector('.update-bar__btn').onclick = function () {
      updateBar.hidden = true;
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    };
  }

  navigator.serviceWorker.register('./sw.js', { scope: './' })
    .then(function (reg) {
      if (reg.waiting) showUpdateBar(reg);
      reg.addEventListener('updatefound', function () {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar(reg);
          }
        });
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    })
    .catch(function (e) { console.warn('[SW] регистрация не удалась:', e); });
};

})(window);