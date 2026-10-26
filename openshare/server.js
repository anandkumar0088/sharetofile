/**
 * OpenShare – server.js
 * Express + WebSocket signaling + chunk relay + mDNS advertisement
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_FILES_PER_TRANSFER = 100;

// ── Express ──────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── Friendly-name generator ──────────────────────────────
const ADJ = [
  'Swift','Bold','Bright','Calm','Cool','Crimson','Daring','Electric',
  'Fierce','Golden','Jade','Keen','Lucky','Mystic','Noble','Quick',
  'Rapid','Silent','Stellar','Vivid','Warm','Wild','Wise','Zesty'
];
const ANIMAL = [
  'Falcon','Wolf','Panda','Tiger','Eagle','Fox','Bear','Hawk',
  'Lion','Otter','Raven','Shark','Lynx','Cobra','Crane','Dolphin',
  'Jaguar','Phoenix','Panther','Owl'
];
const usedNames = new Set();

function pickName() {
  // Try random combos; fall back to adding a digit
  for (let i = 0; i < 50; i++) {
    const n = ADJ[Math.random() * ADJ.length | 0] + ' ' + ANIMAL[Math.random() * ANIMAL.length | 0];
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  const n = ADJ[Math.random() * ADJ.length | 0] + ' ' + ANIMAL[Math.random() * ANIMAL.length | 0] + ' ' + (Math.random() * 90 + 10 | 0);
  usedNames.add(n);
  return n;
}

function detectDevice(ua) {
  if (!ua) return 'laptop';
  const u = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook/.test(u)) return 'tablet';
  if (/android/.test(u) && !/mobile/.test(u)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|phone/.test(u)) return 'phone';
  return 'laptop';
}

// ── LAN address ──────────────────────────────────────────
function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

const LAN_IP = getLanIP();
const LAN_URL = `http://${LAN_IP}:${PORT}`;

// ── QR endpoint ──────────────────────────────────────────
app.get('/api/info', async (_req, res) => {
  try {
    const qr = await QRCode.toDataURL(LAN_URL, { width: 280, margin: 2, color: { dark: '#ffffffdd', light: '#00000000' } });
    res.json({ url: LAN_URL, qr });
  } catch {
    res.json({ url: LAN_URL, qr: null });
  }
});

// ── Client registry ─────────────────────────────────────
const clients = new Map();  // ws → { id, name, deviceType }

function peerList() {
  return [...clients.values()].map(c => ({ id: c.id, name: c.name, deviceType: c.deviceType }));
}

function broadcast() {
  const all = peerList();
  for (const [ws, c] of clients) {
    if (ws.readyState !== 1) continue;
    ws.send(JSON.stringify({ type: 'peers', peers: all.filter(p => p.id !== c.id) }));
  }
}

function wsById(id) {
  for (const [ws, c] of clients) if (c.id === id) return ws;
  return null;
}

// ── WebSocket handling ───────────────────────────────────
wss.on('connection', (ws, req) => {
  const ua = req.headers['user-agent'] || '';
  const id = crypto.randomUUID();
  const name = pickName();
  const deviceType = detectDevice(ua);

  clients.set(ws, { id, name, deviceType });
  ws.send(JSON.stringify({ type: 'welcome', id, name, deviceType }));
  broadcast();

  // For binary relay: after a chunk-meta, the next binary frame goes to same target
  let pendingTarget = null;

  ws.on('message', (data, isBinary) => {
    // Binary frame → relay to pending target
    if (isBinary) {
      if (pendingTarget) {
        const tw = wsById(pendingTarget);
        if (tw && tw.readyState === 1) tw.send(data, { binary: true });
        pendingTarget = null;
      }
      return;
    }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    const sender = clients.get(ws);
    if (!sender) return;

    // Rename device
    if (msg.type === 'rename' && typeof msg.name === 'string') {
      const clean = msg.name.trim().slice(0, 32);
      if (clean) {
        usedNames.delete(sender.name);
        sender.name = clean;
        usedNames.add(clean);
        ws.send(JSON.stringify({ type: 'welcome', id: sender.id, name: sender.name, deviceType: sender.deviceType }));
        broadcast();
      }
      return;
    }

    // Validate offer-transfer file count
    if (msg.type === 'offer-transfer' && Array.isArray(msg.files) && msg.files.length > MAX_FILES_PER_TRANSFER) {
      ws.send(JSON.stringify({ type: 'error', message: `Max ${MAX_FILES_PER_TRANSFER} files per transfer` }));
      return;
    }

    // Messages with "to" are relayed
    if (msg.to) {
      const tw = wsById(msg.to);
      if (!tw || tw.readyState !== 1) return;

      msg.from = sender.id;
      msg.fromName = sender.name;
      msg.fromDeviceType = sender.deviceType;

      if (msg.type === 'chunk-meta') pendingTarget = msg.to;

      tw.send(JSON.stringify(msg));
    }
  });

  ws.on('close', () => {
    const c = clients.get(ws);
    if (c) usedNames.delete(c.name);
    clients.delete(ws);
    broadcast();
  });

  ws.on('error', () => {
    const c = clients.get(ws);
    if (c) usedNames.delete(c.name);
    clients.delete(ws);
    broadcast();
  });
});

// ── mDNS advertisement ──────────────────────────────────
try {
  const mdns = require('multicast-dns')();
  mdns.on('query', (query) => {
    if (query.questions.some(q => q.name === 'openshare.local')) {
      mdns.respond({
        answers: [
          { name: 'openshare.local', type: 'A', ttl: 120, data: LAN_IP },
          { name: '_openshare._tcp.local', type: 'SRV', ttl: 120, data: { port: PORT, target: LAN_IP, priority: 0, weight: 0 } }
        ]
      });
    }
  });
} catch (e) {
  console.log('  ⚠  mDNS unavailable:', e.message);
}

// ── Start ────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  console.log('\n  ⚡ OpenShare is running!\n');
  console.log(`     Local:   http://localhost:${PORT}`);
  console.log(`     Network: ${LAN_URL}\n`);
  try {
    console.log('     Scan to connect:\n');
    console.log(await QRCode.toString(LAN_URL, { type: 'terminal', small: true }));
  } catch { /* ignore */ }
  console.log('     Press Ctrl+C to stop.\n');
});
