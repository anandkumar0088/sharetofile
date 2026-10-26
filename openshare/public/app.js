/**
 * OpenShare – app.js
 * Modern Glassmorphism UI Logic: WebSocket, chunked transfer, live radar
 */

/* ── Constants ────────────────────────────────────────── */
const CHUNK = 128 * 1024;              // 128 KB chunks
const MAX_BUFFER = 1024 * 1024;        // 1 MB flow-control threshold
const STORAGE_KEY_RECENT = 'openshare_recent_transfers_v2';
const STORAGE_KEY_THEME = 'openshare_theme_v2';
const STORAGE_KEY_CUSTOM_NAME = 'openshare_custom_name';

/* ── SVG Icons ────────────────────────────────────────── */
const ICONS = {
  laptop: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
  </svg>`,
  phone: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" />
  </svg>`,
  tablet: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="3" />
    <circle cx="12" cy="18" r="1" fill="currentColor" />
  </svg>`,
  check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>`,
  sun: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>`,
  moon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>`
};

/* ── State ────────────────────────────────────────────── */
let ws = null;
let me = { id: null, name: 'Zesty Fox', deviceType: 'laptop' };
let peers = [];
let selectedPeer = null;              // peer id
let transfers = new Map();            // transferId → transfer obj
let recentTransfers = [];             // finished and demo items
let pendingOffer = null;              // incoming offer
let pendingChunkMeta = null;          // chunk-meta preceding a binary frame
let lanUrl = '';
let qrDataUrl = '';

/* ── DOM refs ─────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const el = {
  myName: $('myName'), mySubName: $('mySubName'), myIcon: $('myIcon'),
  statusDot: $('statusDot'), btnUserMenu: $('btnUserMenu'),
  radar: $('radar'), peerNodes: $('peerNodes'), emptyHint: $('emptyHint'),
  lanUrlText: $('lanUrlText'),
  dropZone: $('dropZone'), dropHint: $('dropHint'), fileInput: $('fileInput'),
  btnBrowse: $('btnBrowse'), btnSendText: $('btnSendText'),
  btnQR: $('btnQR'), btnTheme: $('btnTheme'), themeIcon: $('themeIcon'), btnBT: $('btnBT'),
  modalQR: $('modalQR'), qrImg: $('qrImg'), qrUrlDisplay: $('qrUrlDisplay'), btnCopyUrl: $('btnCopyUrl'),
  modalOffer: $('modalOffer'), offerInfo: $('offerInfo'),
  btnAccept: $('btnAccept'), btnDecline: $('btnDecline'),
  modalTextRx: $('modalTextRx'), rxTextContent: $('rxTextContent'), btnCopyRx: $('btnCopyRx'), rxTextSenderHint: $('rxTextSenderHint'),
  modalTextTx: $('modalTextTx'), txTextArea: $('txTextArea'), btnTxConfirm: $('btnTxConfirm'), sendTextTargetHint: $('sendTextTargetHint'),
  modalRename: $('modalRename'), renameInput: $('renameInput'), btnSaveRename: $('btnSaveRename'),
  toasts: $('toasts'), dragOverlay: $('dragOverlay'), dragTargetHint: $('dragTargetHint'),
  transfersSection: $('transfersSection'), transferList: $('transferList'),
  btnClearTransfers: $('btnClearTransfers'), btnFilterTransfers: $('btnFilterTransfers'), btnTransfersMenu: $('btnTransfersMenu')
};

/* ── Helpers ──────────────────────────────────────────── */
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmtSize(b) {
  if (typeof b !== 'number' || isNaN(b) || b <= 0) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

function fmtSpeed(bps) {
  return fmtSize(bps) + '/s';
}

function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return Math.ceil(sec) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.ceil(sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

/* ── Modal helpers ────────────────────────────────────── */
function showModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('show');
}

function hideModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('show');
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => hideModal(btn.dataset.close));
});

document.querySelectorAll('.modal-backdrop').forEach(wrap => {
  wrap.addEventListener('click', e => {
    if (e.target === wrap) hideModal(wrap.id);
  });
});

/* ── Theme Management ─────────────────────────────────── */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (el.themeIcon) {
    el.themeIcon.outerHTML = theme === 'dark' ? ICONS.moon : ICONS.sun;
    el.themeIcon = $('themeIcon');
  }
  try { localStorage.setItem(STORAGE_KEY_THEME, theme); } catch {}
}

el.btnTheme.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

try {
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
  if (savedTheme) setTheme(savedTheme);
} catch {}

/* ── Device Icon Renderer ─────────────────────────────── */
function getDeviceIcon(type) {
  if (type === 'phone') return ICONS.phone;
  if (type === 'tablet') return ICONS.tablet;
  return ICONS.laptop;
}

/* ── File Badge & Category Generator ──────────────────── */
function getFileBadgeInfo(filename, type) {
  const name = (filename || '').toLowerCase();
  
  // Image / Photo
  if (/\.(jpg|jpeg|png|webp|gif|svg|avif|heic)$/.test(name) || (type && type.startsWith('image/'))) {
    return {
      category: 'photo',
      badgeClass: 'badge-photo',
      html: `<svg viewBox="0 0 48 48" width="48" height="48" style="border-radius:14px;display:block">
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="50%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
        </defs>
        <rect width="48" height="48" fill="url(#skyGrad)"/>
        <circle cx="34" cy="14" r="5" fill="#fef08a" opacity="0.9"/>
        <polygon points="4,48 20,24 34,48" fill="#475569"/>
        <polygon points="16,48 30,28 46,48" fill="#334155"/>
        <polygon points="20,24 24,30 18,31" fill="#f8fafc" opacity="0.9"/>
        <polygon points="30,28 34,34 28,35" fill="#f8fafc" opacity="0.9"/>
      </svg>`
    };
  }

  // PDF
  if (/\.pdf$/.test(name) || (type && type.includes('pdf'))) {
    return {
      category: 'pdf',
      badgeClass: 'badge-pdf',
      html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
      </svg>`
    };
  }

  // Text / Note / Code
  if (name === 'hello' || /\.(txt|md|json|js|ts|html|css|py|log)$/.test(name) || (type && type.startsWith('text/'))) {
    return {
      category: 'text',
      badgeClass: 'badge-text',
      html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9" x2="8" y2="9"/>
      </svg>`
    };
  }

  // Video
  if (/\.(mp4|mov|mkv|webm|avi|m4v)$/.test(name) || (type && type.startsWith('video/'))) {
    return {
      category: 'video',
      badgeClass: 'badge-video',
      html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <polygon points="6 4 20 12 6 20 6 4"/>
      </svg>`
    };
  }

  // Zip / Archive
  if (/\.(zip|tar|gz|7z|rar|bz2|iso)$/.test(name) || (type && type.includes('zip') || (type && type.includes('compressed')))) {
    return {
      category: 'zip',
      badgeClass: 'badge-zip',
      html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="10" y1="12" x2="14" y2="12"/>
        <line x1="10" y1="15" x2="14" y2="15"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
      </svg>`
    };
  }

  // Generic file
  return {
    category: 'generic',
    badgeClass: 'badge-generic',
    html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>`
  };
}

/* ── WebSocket Connection ─────────────────────────────── */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    el.statusDot.classList.remove('offline');
    ws.send(JSON.stringify({ type: 'hello', userAgent: navigator.userAgent }));
    
    // Check if custom name was saved locally
    try {
      const custom = localStorage.getItem(STORAGE_KEY_CUSTOM_NAME);
      if (custom && custom.trim()) {
        setTimeout(() => {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'rename', name: custom.trim() }));
          }
        }, 300);
      }
    } catch {}
  };

  ws.onclose = () => {
    el.statusDot.classList.add('offline');
    el.myName.textContent = 'Reconnecting…';
    setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (evt) => {
    if (evt.data instanceof ArrayBuffer) {
      handleBinary(evt.data);
      return;
    }
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMsg(msg);
  };
}

function handleMsg(msg) {
  switch (msg.type) {
    case 'welcome':
      me = { id: msg.id, name: msg.name, deviceType: msg.deviceType || 'laptop' };
      el.myName.textContent = me.name;
      el.mySubName.textContent = me.name;
      el.myIcon.innerHTML = getDeviceIcon(me.deviceType);
      break;

    case 'peers':
      peers = msg.peers || [];
      // If selected peer left, deselect
      if (selectedPeer && !peers.find(p => p.id === selectedPeer)) {
        selectedPeer = null;
      }
      renderPeers();
      updateDropZone();
      break;

    case 'offer-transfer':
      handleOfferTransfer(msg);
      break;

    case 'accept':
      handleAccepted(msg);
      break;

    case 'decline':
      handleDeclined(msg);
      break;

    case 'chunk-meta':
      pendingChunkMeta = msg;
      break;

    case 'file-done':
      handleFileDone(msg);
      break;

    case 'transfer-done':
      handleTransferDone(msg);
      break;

    case 'cancel':
      handleCancel(msg);
      break;

    case 'text':
      handleTextReceive(msg);
      break;

    case 'error':
      console.warn('Server error:', msg.message);
      break;
  }
}

/* ── Radar & Peer Rendering ───────────────────────────── */
function renderPeers() {
  el.peerNodes.innerHTML = '';
  
  if (peers.length === 0) {
    el.emptyHint.hidden = false;
    return;
  }
  el.emptyHint.hidden = true;

  const radarW = el.radar.offsetWidth || 340;
  const radarH = el.radar.offsetHeight || 340;
  const cx = radarW / 2;
  const cy = radarH / 2;
  
  // Radial placement matching the mockup's orbiting look
  const radius = Math.min(cx, cy) * 0.72;

  peers.forEach((p, i) => {
    const angle = (2 * Math.PI * i / peers.length) - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);

    const isSelected = selectedPeer === p.id;
    const node = document.createElement('div');
    node.className = 'peer-node' + (isSelected ? ' selected' : '');
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    node.style.transform = 'translate(-50%, -50%)';
    node.dataset.peerId = p.id;

    node.innerHTML = `
      <div class="peer-disc">
        ${getDeviceIcon(p.deviceType)}
        <div class="peer-check-badge">
          ${ICONS.check}
        </div>
      </div>
      <div class="peer-labels">
        <span class="peer-name">${esc(p.name)}</span>
        <span class="peer-type">${esc(p.deviceType || 'Device')}</span>
      </div>
    `;

    // Click to select / deselect
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedPeer = selectedPeer === p.id ? null : p.id;
      renderPeers();
      updateDropZone();
    });

    // Drag files directly onto peer node
    node.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      node.classList.add('drag-hover');
    });

    node.addEventListener('dragleave', () => {
      node.classList.remove('drag-hover');
    });

    node.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('drag-hover');
      selectedPeer = p.id;
      renderPeers();
      updateDropZone();
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        sendFiles(Array.from(e.dataTransfer.files));
      }
    });

    el.peerNodes.appendChild(node);
  });
}

function updateDropZone() {
  const p = peers.find(p => p.id === selectedPeer);
  if (p) {
    el.dropZone.classList.add('has-target');
    el.dropHint.textContent = `Sending to ${p.name}`;
    el.btnSendText.disabled = false;
    el.btnSendText.style.opacity = '1';
  } else {
    el.dropZone.classList.remove('has-target');
    el.dropHint.textContent = 'Select a device above';
    el.btnSendText.disabled = false;
  }
}

/* ── Rename Device Feature ────────────────────────────── */
el.btnUserMenu.addEventListener('click', () => {
  el.renameInput.value = me.name || '';
  showModal('modalRename');
  setTimeout(() => el.renameInput.focus(), 100);
});

el.btnSaveRename.addEventListener('click', () => {
  const newName = el.renameInput.value.trim();
  if (newName && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'rename', name: newName }));
    try { localStorage.setItem(STORAGE_KEY_CUSTOM_NAME, newName); } catch {}
  }
  hideModal('modalRename');
});

el.renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.btnSaveRename.click();
});

/* ── File Selection & Drag-and-Drop ───────────────────── */
el.btnBrowse.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files.length) {
    sendFiles(Array.from(el.fileInput.files));
  }
  el.fileInput.value = '';
});

// Drop zone interactions
el.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  el.dropZone.classList.add('drag-active');
});

el.dropZone.addEventListener('dragleave', () => {
  el.dropZone.classList.remove('drag-active');
});

el.dropZone.addEventListener('drop', e => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-active');
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    sendFiles(Array.from(e.dataTransfer.files));
  }
});

// Full-window drag overlay
let dragCounter = 0;
document.addEventListener('dragenter', e => {
  e.preventDefault();
  dragCounter++;
  const p = peers.find(p => p.id === selectedPeer);
  el.dragTargetHint.textContent = p ? `Ready to send to ${p.name}` : `Select a device or drop onto one directly`;
  el.dragOverlay.classList.add('show');
});

document.addEventListener('dragleave', e => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    el.dragOverlay.classList.remove('show');
  }
});

document.addEventListener('dragover', e => e.preventDefault());

document.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  el.dragOverlay.classList.remove('show');
});

/* ── Send Files Flow ──────────────────────────────────── */
function sendFiles(files) {
  if (!selectedPeer) {
    if (peers.length === 1) {
      selectedPeer = peers[0].id;
      renderPeers();
      updateDropZone();
    } else {
      alert('Please click on a nearby device to select it first!');
      return;
    }
  }

  if (!files.length) return;
  if (files.length > 100) {
    alert('Maximum 100 files per transfer');
    return;
  }

  const tid = uuid();
  const fileMeta = files.map(f => ({ name: f.name, size: f.size, type: f.type }));
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const targetPeer = peers.find(p => p.id === selectedPeer);

  const transfer = {
    id: tid,
    direction: 'send',
    peerId: selectedPeer,
    peerName: targetPeer ? targetPeer.name : 'Unknown Device',
    files,
    fileMeta,
    totalSize,
    bytesSent: 0,
    status: 'pending',
    startTime: null
  };
  transfers.set(tid, transfer);

  ws.send(JSON.stringify({
    type: 'offer-transfer',
    to: selectedPeer,
    transferId: tid,
    files: fileMeta,
    totalSize
  }));

  renderToast(transfer);
  addOrUpdateRecent(transfer);
}

/* ── Chunked File Streaming ───────────────────────────── */
async function startSending(transfer) {
  transfer.status = 'transferring';
  transfer.startTime = Date.now();
  renderToast(transfer);
  addOrUpdateRecent(transfer);

  for (let fi = 0; fi < transfer.files.length; fi++) {
    const file = transfer.files[fi];
    let offset = 0, ci = 0;

    while (offset < file.size) {
      if (transfer.status === 'cancelled') return;

      const end = Math.min(offset + CHUNK, file.size);
      const slice = file.slice(offset, end);
      const buf = await slice.arrayBuffer();

      ws.send(JSON.stringify({
        type: 'chunk-meta',
        to: transfer.peerId,
        transferId: transfer.id,
        fileIndex: fi,
        chunkIndex: ci,
        offset,
        size: buf.byteLength
      }));
      ws.send(buf);

      transfer.bytesSent += buf.byteLength;
      offset = end;
      ci++;

      renderToast(transfer);
      addOrUpdateRecent(transfer);

      // Flow control to prevent backpressure
      while (ws.bufferedAmount > MAX_BUFFER) {
        await new Promise(r => setTimeout(r, 6));
      }
    }

    ws.send(JSON.stringify({
      type: 'file-done',
      to: transfer.peerId,
      transferId: transfer.id,
      fileIndex: fi
    }));
  }

  ws.send(JSON.stringify({
    type: 'transfer-done',
    to: transfer.peerId,
    transferId: transfer.id
  }));

  transfer.status = 'done';
  finishTransfer(transfer);
}

/* ── Receive Transfer Flow ────────────────────────────── */
function handleOfferTransfer(msg) {
  const transfer = {
    id: msg.transferId,
    direction: 'receive',
    peerId: msg.from,
    peerName: msg.fromName || 'Nearby Device',
    fileMeta: msg.files,
    totalSize: msg.totalSize,
    bytesReceived: 0,
    chunks: new Map(),
    status: 'pending',
    startTime: null
  };
  transfers.set(msg.transferId, transfer);
  pendingOffer = transfer;

  el.offerInfo.innerHTML = `
    <p>From <span class="offer-sender">${esc(msg.fromName)}</span></p>
    <ul class="offer-file-list">
      ${msg.files.map(f => `<li>${esc(sanitize(f.name))} &mdash; <strong>${fmtSize(f.size)}</strong></li>`).join('')}
    </ul>
    <p style="margin-top:6px;color:var(--text-secondary)">
      Total: <strong>${fmtSize(msg.totalSize)}</strong> &bull; ${msg.files.length} file${msg.files.length > 1 ? 's' : ''}
    </p>
  `;
  showModal('modalOffer');
}

el.btnAccept.addEventListener('click', () => {
  if (!pendingOffer) return;
  ws.send(JSON.stringify({ type: 'accept', to: pendingOffer.peerId, transferId: pendingOffer.id }));
  pendingOffer.status = 'transferring';
  pendingOffer.startTime = Date.now();
  renderToast(pendingOffer);
  addOrUpdateRecent(pendingOffer);
  pendingOffer = null;
  hideModal('modalOffer');
});

el.btnDecline.addEventListener('click', () => {
  if (!pendingOffer) return;
  ws.send(JSON.stringify({ type: 'decline', to: pendingOffer.peerId, transferId: pendingOffer.id }));
  transfers.delete(pendingOffer.id);
  pendingOffer = null;
  hideModal('modalOffer');
});

function handleAccepted(msg) {
  const t = transfers.get(msg.transferId);
  if (t && t.direction === 'send') startSending(t);
}

function handleDeclined(msg) {
  const t = transfers.get(msg.transferId);
  if (t) {
    t.status = 'declined';
    renderToast(t);
    addOrUpdateRecent(t);
    setTimeout(() => removeToast(t.id), 3000);
    transfers.delete(msg.transferId);
  }
}

/* ── Binary Chunk & File Completion ───────────────────── */
function handleBinary(buf) {
  if (!pendingChunkMeta) return;
  const meta = pendingChunkMeta;
  pendingChunkMeta = null;

  const t = transfers.get(meta.transferId);
  if (!t || t.status === 'cancelled') return;

  if (!t.chunks.has(meta.fileIndex)) t.chunks.set(meta.fileIndex, []);
  t.chunks.get(meta.fileIndex).push(buf);
  t.bytesReceived += buf.byteLength;

  renderToast(t);
  addOrUpdateRecent(t);
}

function handleFileDone(msg) {
  const t = transfers.get(msg.transferId);
  if (!t) return;

  const chunks = t.chunks.get(msg.fileIndex);
  if (!chunks) return;

  const info = t.fileMeta[msg.fileIndex];
  const blob = new Blob(chunks, { type: info.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitize(info.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  t.chunks.delete(msg.fileIndex);
}

function handleTransferDone(msg) {
  const t = transfers.get(msg.transferId);
  if (!t) return;
  t.status = 'done';
  finishTransfer(t);
}

/* ── Cancellation ─────────────────────────────────────── */
function cancelTransfer(tid) {
  const t = transfers.get(tid);
  if (!t) return;
  t.status = 'cancelled';
  ws.send(JSON.stringify({ type: 'cancel', to: t.peerId, transferId: tid }));
  if (t.chunks) t.chunks.clear();
  renderToast(t);
  addOrUpdateRecent(t);
  setTimeout(() => removeToast(tid), 2500);
  transfers.delete(tid);
}

function handleCancel(msg) {
  const t = transfers.get(msg.transferId);
  if (!t) return;
  t.status = 'cancelled';
  if (t.chunks) t.chunks.clear();
  renderToast(t);
  addOrUpdateRecent(t);
  setTimeout(() => removeToast(t.id), 2500);
  transfers.delete(msg.transferId);
}

function finishTransfer(t) {
  renderToast(t);
  addOrUpdateRecent(t, true);
  setTimeout(() => removeToast(t.id), 3500);
  transfers.delete(t.id);
}

/* ── Toast Notifications ──────────────────────────────── */
function renderToast(t) {
  let toast = document.getElementById('toast-' + t.id);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.id = 'toast-' + t.id;
    el.toasts.appendChild(toast);
  }

  const total = t.totalSize || 1;
  const current = t.direction === 'send' ? t.bytesSent : t.bytesReceived;
  const pct = Math.min(Math.round((current / total) * 100), 100);

  const elapsed = t.startTime ? (Date.now() - t.startTime) / 1000 : 0;
  const speed = elapsed > 0 ? current / elapsed : 0;
  const remaining = speed > 0 ? (total - current) / speed : 0;

  const dir = t.direction === 'send' ? '📤 Sending' : '📥 Receiving';
  const statusText = t.status === 'pending' ? 'Waiting approval…'
    : t.status === 'done' ? '✓ Completed'
    : t.status === 'cancelled' ? '✕ Cancelled'
    : t.status === 'declined' ? '✕ Declined'
    : `${pct}%`;

  const fileNames = (t.fileMeta || []).map(f => sanitize(f.name)).join(', ');

  toast.innerHTML = `
    <div class="toast-head">
      <span class="toast-title">${dir} to ${esc(t.peerName || 'Device')}</span>
      ${t.status === 'transferring' || t.status === 'pending'
        ? `<button class="toast-cancel" onclick="cancelTransfer('${t.id}')">Cancel</button>`
        : ''}
    </div>
    <div class="toast-bar-wrap">
      <div class="toast-bar" style="width:${pct}%"></div>
    </div>
    <div class="toast-stats">
      <span>${esc(fileNames.slice(0, 45))}${fileNames.length > 45 ? '…' : ''}</span>
      <span>${statusText}${t.status === 'transferring' ? ` &bull; ${fmtSpeed(speed)} &bull; ${fmtEta(remaining)}` : ''}</span>
    </div>
  `;
}

function removeToast(tid) {
  const toast = document.getElementById('toast-' + tid);
  if (toast) toast.remove();
}

/* ── Recent Transfers Data & Mockup Initialization ────── */
function initRecentTransfers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT);
    if (raw) {
      recentTransfers = JSON.parse(raw);
    }
  } catch {}

  // If no saved transfers, populate with exact items from the mockup screenshot!
  if (!recentTransfers || recentTransfers.length === 0) {
    recentTransfers = [
      {
        id: 'mock-1',
        name: 'IMG_20261026_1432.jpg',
        size: 27.7 * 1024 * 1024,
        peerName: 'Quick Tiger',
        direction: 'send',
        status: 'completed',
        timeStr: '2 min ago',
        type: 'image/jpeg'
      },
      {
        id: 'mock-2',
        name: 'Notes.pdf',
        size: 3.2 * 1024 * 1024,
        peerName: 'Quick Tiger',
        direction: 'send',
        status: 'completed',
        timeStr: '12 min ago',
        type: 'application/pdf'
      },
      {
        id: 'mock-3',
        name: 'hello',
        size: 5,
        peerName: 'Quick Tiger',
        direction: 'send',
        status: 'completed',
        isText: true,
        charCount: 5,
        timeStr: '18 min ago',
        type: 'text/plain'
      },
      {
        id: 'mock-4',
        name: 'Travel_Vlog.mp4',
        size: 812 * 1024 * 1024,
        peerName: 'Quick Tiger',
        direction: 'send',
        status: 'transferring',
        progress: 68,
        timeStr: '1 min ago',
        type: 'video/mp4'
      },
      {
        id: 'mock-5',
        name: 'Project_Files.zip',
        size: 1.4 * 1024 * 1024 * 1024,
        peerName: 'realme 11',
        direction: 'receive',
        status: 'completed',
        timeStr: '1 hour ago',
        type: 'application/zip'
      }
    ];
    saveRecent();
  }

  renderRecentTransfers();
}

function saveRecent() {
  try {
    localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(recentTransfers.slice(0, 30)));
  } catch {}
}

function addOrUpdateRecent(transfer, isFinished = false) {
  const existingIdx = recentTransfers.findIndex(r => r.id === transfer.id);
  const currentBytes = transfer.direction === 'send' ? transfer.bytesSent : transfer.bytesReceived;
  const pct = Math.min(Math.round((currentBytes / (transfer.totalSize || 1)) * 100), 100);

  const item = {
    id: transfer.id,
    name: transfer.fileMeta ? transfer.fileMeta.map(f => f.name).join(', ') : 'File',
    size: transfer.totalSize,
    peerName: transfer.peerName || 'Device',
    direction: transfer.direction,
    status: isFinished || transfer.status === 'done' ? 'completed' : transfer.status,
    progress: pct,
    timeStr: 'Just now',
    type: transfer.fileMeta && transfer.fileMeta[0] ? transfer.fileMeta[0].type : ''
  };

  if (existingIdx >= 0) {
    recentTransfers[existingIdx] = { ...recentTransfers[existingIdx], ...item };
  } else {
    recentTransfers.unshift(item);
  }

  saveRecent();
  renderRecentTransfers();
}

function renderRecentTransfers() {
  el.transferList.innerHTML = '';

  recentTransfers.forEach(r => {
    const li = document.createElement('li');
    li.className = 'transfer-card';

    const badge = getFileBadgeInfo(r.name, r.type);
    const arrow = r.direction === 'send' ? '&uarr;' : '&darr;';
    
    // Subdetail line (e.g. "27.7 MB • Sent to Quick Tiger" or "Text • 5 characters")
    let subDetail = '';
    if (r.isText) {
      subDetail = `Text &bull; ${r.charCount || r.size} characters`;
    } else {
      const dirText = r.status === 'transferring'
        ? (r.direction === 'send' ? 'Sending to' : 'Receiving from')
        : (r.direction === 'send' ? 'Sent to' : 'Received from');
      subDetail = `${fmtSize(r.size)} &bull; ${dirText} ${esc(r.peerName || 'Device')}`;
    }

    // Right status badge or progress
    let statusBadgeHtml = '';
    if (r.status === 'transferring' || (r.progress > 0 && r.progress < 100 && r.status !== 'completed')) {
      const pct = r.progress || 0;
      statusBadgeHtml = `
        <div class="progress-mini-wrap">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="progress-pct-text">${pct}%</span>
        </div>
      `;
    } else {
      statusBadgeHtml = `
        <div class="completed-pill">
          <svg class="completed-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Completed</span>
        </div>
      `;
    }

    li.innerHTML = `
      <div class="file-badge ${badge.badgeClass}">
        ${badge.html}
      </div>
      <div class="t-main-info">
        <span class="t-filename">${esc(r.name)}</span>
        <span class="t-subdetail">${subDetail}</span>
      </div>
      <div class="t-status-col">
        <span class="t-time-str">${esc(r.timeStr || 'Recent')}</span>
        <div class="t-badge-row">
          <span class="t-direction-icon">${arrow}</span>
          ${statusBadgeHtml}
        </div>
      </div>
    `;

    el.transferList.appendChild(li);
  });
}

// Clear all button
el.btnClearTransfers.addEventListener('click', () => {
  recentTransfers = [];
  saveRecent();
  renderRecentTransfers();
});

// Filter button toggle (cycles filter: all, files, text)
let filterMode = 'all';
el.btnFilterTransfers.addEventListener('click', () => {
  filterMode = filterMode === 'all' ? 'files' : filterMode === 'files' ? 'text' : 'all';
  const original = JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '[]');
  if (filterMode === 'files') {
    recentTransfers = original.filter(r => !r.isText);
  } else if (filterMode === 'text') {
    recentTransfers = original.filter(r => r.isText);
  } else {
    recentTransfers = original;
  }
  renderRecentTransfers();
});

el.btnTransfersMenu.addEventListener('click', () => {
  alert(`OpenShare Transfers: ${recentTransfers.length} total entries.`);
});

/* ── Send & Receive Text ──────────────────────────────── */
el.btnSendText.addEventListener('click', () => {
  const p = peers.find(p => p.id === selectedPeer);
  el.sendTextTargetHint.textContent = p ? `Sending text to ${p.name}` : `Select a device or send to all`;
  el.txTextArea.value = '';
  showModal('modalTextTx');
  setTimeout(() => el.txTextArea.focus(), 100);
});

el.btnTxConfirm.addEventListener('click', () => {
  const text = el.txTextArea.value.trim();
  if (!text) return;

  if (!selectedPeer && peers.length > 0) {
    selectedPeer = peers[0].id;
  }

  if (selectedPeer && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'text', to: selectedPeer, content: text }));
    const p = peers.find(p => p.id === selectedPeer);

    recentTransfers.unshift({
      id: uuid(),
      name: text.length > 25 ? text.slice(0, 25) + '…' : text,
      size: text.length,
      peerName: p ? p.name : 'Device',
      direction: 'send',
      status: 'completed',
      isText: true,
      charCount: text.length,
      timeStr: 'Just now',
      type: 'text/plain'
    });
    saveRecent();
    renderRecentTransfers();
  }

  hideModal('modalTextTx');
});

function handleTextReceive(msg) {
  el.rxTextContent.textContent = msg.content || '';
  el.rxTextSenderHint.textContent = `Message from ${msg.fromName || 'Nearby Device'}`;
  showModal('modalTextRx');

  recentTransfers.unshift({
    id: uuid(),
    name: (msg.content || '').length > 25 ? (msg.content || '').slice(0, 25) + '…' : (msg.content || 'Text message'),
    size: (msg.content || '').length,
    peerName: msg.fromName || 'Device',
    direction: 'receive',
    status: 'completed',
    isText: true,
    charCount: (msg.content || '').length,
    timeStr: 'Just now',
    type: 'text/plain'
  });
  saveRecent();
  renderRecentTransfers();
}

el.btnCopyRx.addEventListener('click', () => {
  navigator.clipboard.writeText(el.rxTextContent.textContent).then(() => {
    el.btnCopyRx.textContent = '✓ Copied!';
    setTimeout(() => el.btnCopyRx.textContent = '📋 Copy to Clipboard', 1500);
  }).catch(() => {});
});

/* ── QR Code Pairing ──────────────────────────────────── */
el.btnQR.addEventListener('click', () => showModal('modalQR'));

async function fetchInfo() {
  try {
    const r = await fetch('/api/info');
    const d = await r.json();
    lanUrl = d.url || '';
    qrDataUrl = d.qr || '';
    el.lanUrlText.textContent = lanUrl;
    el.qrUrlDisplay.textContent = lanUrl;
    if (d.qr) el.qrImg.src = d.qr;
  } catch {}
}

el.btnCopyUrl.addEventListener('click', () => {
  if (lanUrl) {
    navigator.clipboard.writeText(lanUrl).then(() => {
      el.btnCopyUrl.textContent = '✓ Copied';
      setTimeout(() => el.btnCopyUrl.textContent = 'Copy', 1500);
    }).catch(() => {});
  }
});

/* ── Bluetooth Discovery (Best Effort) ────────────────── */
function initBluetooth() {
  if (!navigator.bluetooth) {
    el.btnBT.title = 'Bluetooth discovery not supported in this browser';
    return;
  }

  el.btnBT.addEventListener('click', async () => {
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: []
      });
      alert(`Bluetooth handshake hint: Found ${device.name || 'Device'}. Wi-Fi URL: ${lanUrl}`);
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        console.log('Bluetooth:', e.message);
      }
    }
  });
}

/* ── Window Resize Radar Recalculation ────────────────── */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderPeers, 150);
});

/* ── Bootstrap ────────────────────────────────────────── */
el.myIcon.innerHTML = getDeviceIcon(me.deviceType);
initRecentTransfers();
connect();
fetchInfo();
initBluetooth();
