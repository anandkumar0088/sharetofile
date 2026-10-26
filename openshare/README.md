# ⚡ OpenShare

**Local-first file sharing — like AirDrop, for any device on your LAN.**

No cloud. No accounts. No installs. Just open a browser.

---

## Quick Start

```bash
cd openshare
npm install
npm start
```

The server prints a **LAN URL** and a **QR code** in the terminal.  
Open that URL on any device on the same Wi-Fi network.

---

## How It Works

1. **Open the URL** on two or more devices (laptop, phone, tablet — anything with a browser).
2. Each device gets a random friendly name (e.g. "Swift Falcon") and appears on the radar.
3. **Click a device** to select it, then **drop files** onto the drop zone or click **Browse**.
4. The receiver gets an **Accept / Decline** popup. Transfer starts only after approval.
5. Files are sent in **128 KB chunks** over WebSocket — large files (1 GB+) are supported without loading the whole file into memory on the sender side.
6. Received files auto-download via the browser. A **Recent Transfers** list keeps track.

### Text / Clipboard Sharing

Select a device, click **💬 Send Text**, type or paste, and hit Send. The receiver sees it in a popup with a Copy button.

### QR Pairing

Click the **📱** button (or scan the terminal QR) to show a QR code of the LAN URL — perfect for quickly connecting a phone.

---

## Firewall Notes

The server listens on **port 3000** (TCP). You may need to allow it through your firewall:

### Windows
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="OpenShare" dir=in action=allow protocol=TCP localport=3000
```

### macOS
Node usually gets a firewall prompt automatically. If not:
```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which node)
```

### Linux (UFW)
```bash
sudo ufw allow 3000/tcp
```

### Important: Client Isolation

Some Wi-Fi routers have **AP/client isolation** enabled (common on public networks). This prevents devices from talking to each other. If devices can't see each other:

- Check your router settings and disable client isolation
- Make sure all devices are on the **same subnet**
- Try connecting via the **IP address** shown in the terminal, not `localhost`

---

## Opening on a Phone

1. Make sure the phone is on the **same Wi-Fi network** as the computer running OpenShare.
2. Either:
   - Scan the **QR code** shown in the terminal or in the app UI
   - Or type the **LAN URL** (e.g. `http://192.168.1.42:3000`) into the phone's browser
3. The phone appears on the radar. Tap it to select, then send/receive files.

---

## Bluetooth (Experimental)

OpenShare includes a best-effort Bluetooth toggle:

- **Supported browsers**: Chrome & Edge on desktop (requires HTTPS or localhost).
- **What it does**: Uses the Web Bluetooth API (`navigator.bluetooth.requestDevice`) to show a browser device picker. This is only a discovery hint — **all actual file transfer always goes over Wi-Fi/WebSocket**.
- **Limitations**:
  - Web Bluetooth can only act as a *client* (Central), not a *server* (Peripheral). This means one device can scan for BLE devices, but the other OpenShare instance can't advertise itself as a BLE peripheral from the browser.
  - The toggle is **hidden** in unsupported browsers (Firefox, Safari, most mobile browsers).
  - A Bluetooth failure never breaks the app — it's purely additive.

---

## Project Structure

```
openshare/
  package.json          # Dependencies: express, ws, multicast-dns, qrcode
  server.js             # Express + WebSocket relay + mDNS + QR
  public/
    index.html          # Single-page app shell
    style.css           # Glassmorphism UI, animations, responsive
    app.js              # Client logic: WebSocket, chunked transfer, UI
  README.md             # This file
```

---

## Known Limitations

- **Memory on receiver**: Received files are assembled as Blobs in browser memory before downloading. Very large files (>1–2 GB) may hit browser memory limits on some devices. A future version could use the File System Access API or Service Worker streams.
- **No encryption**: Traffic is plain HTTP/WebSocket on the LAN. Use on trusted networks only.
- **Single subnet**: Devices must be on the same LAN subnet. mDNS helps with discovery but doesn't bridge subnets.
- **Mobile downloads**: Some mobile browsers may not support auto-downloading multiple files. Files are triggered one at a time as they complete.
- **No persistence**: The server keeps no state on disk. Refreshing the page gives you a new identity.

---

## License

MIT — do whatever you want with it.
