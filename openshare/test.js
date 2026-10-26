/**
 * Integration test: Simulates two WebSocket clients (Alice & Bob)
 * Alice sends a file to Bob. Validates the full handshake + transfer.
 */
const WebSocket = require('ws');
const crypto = require('crypto');

const URL = 'ws://localhost:3000';
let passed = 0, failed = 0;

function ok(name, cond) { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test() {
  console.log('\n=== OpenShare Integration Test ===\n');

  // Connect Alice
  const alice = new WebSocket(URL);
  alice.binaryType = 'nodebuffer';
  const aliceMsgs = [];
  let aliceId, aliceName;

  alice.on('message', (data, isBinary) => {
    if (isBinary) { aliceMsgs.push({ binary: true, data }); return; }
    aliceMsgs.push(JSON.parse(data.toString()));
  });

  await new Promise(r => alice.on('open', r));
  alice.send(JSON.stringify({ type: 'hello', userAgent: 'TestAlice/1.0' }));
  await sleep(300);

  // Alice should have welcome + peers
  const aliceWelcome = aliceMsgs.find(m => m.type === 'welcome');
  ok('Alice gets welcome', !!aliceWelcome);
  if (aliceWelcome) { aliceId = aliceWelcome.id; aliceName = aliceWelcome.name; }
  ok('Alice has ID', !!aliceId);
  ok('Alice has friendly name', !!aliceName && aliceName.includes(' '));
  console.log(`  → Alice: "${aliceName}" (${aliceId})`);

  // Connect Bob
  const bob = new WebSocket(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' } });
  bob.binaryType = 'nodebuffer';
  const bobMsgs = [];
  let bobId, bobName;

  bob.on('message', (data, isBinary) => {
    if (isBinary) { bobMsgs.push({ binary: true, data }); return; }
    bobMsgs.push(JSON.parse(data.toString()));
  });

  await new Promise(r => bob.on('open', r));
  bob.send(JSON.stringify({ type: 'hello', userAgent: 'Mozilla/5.0 Android Mobile' }));
  await sleep(300);

  const bobWelcome = bobMsgs.find(m => m.type === 'welcome');
  ok('Bob gets welcome', !!bobWelcome);
  if (bobWelcome) { bobId = bobWelcome.id; bobName = bobWelcome.name; }
  ok('Bob detected as phone', bobWelcome && bobWelcome.deviceType === 'phone');
  console.log(`  → Bob: "${bobName}" (${bobId})`);

  // Both should see each other as peers
  const alicePeers = aliceMsgs.filter(m => m.type === 'peers').pop();
  const bobPeers = bobMsgs.filter(m => m.type === 'peers').pop();
  ok('Alice sees Bob as peer', alicePeers && alicePeers.peers.some(p => p.id === bobId));
  ok('Bob sees Alice as peer', bobPeers && bobPeers.peers.some(p => p.id === aliceId));

  // === File transfer: Alice → Bob ===
  console.log('\n--- File Transfer Test ---\n');

  // Create a test "file" (256 KB of random data)
  const fileData = crypto.randomBytes(256 * 1024);
  const transferId = crypto.randomUUID();
  const fileName = 'test-photo.jpg';

  // Alice sends offer
  alice.send(JSON.stringify({
    type: 'offer-transfer', to: bobId, transferId,
    files: [{ name: fileName, size: fileData.length, type: 'image/jpeg' }],
    totalSize: fileData.length
  }));
  await sleep(200);

  // Bob should receive the offer
  const bobOffer = bobMsgs.find(m => m.type === 'offer-transfer' && m.transferId === transferId);
  ok('Bob receives offer', !!bobOffer);
  ok('Offer has sender info', bobOffer && bobOffer.from === aliceId && bobOffer.fromName === aliceName);
  ok('Offer has correct file info', bobOffer && bobOffer.files[0].name === fileName);
  ok('Offer has correct total size', bobOffer && bobOffer.totalSize === fileData.length);

  // Bob accepts
  bob.send(JSON.stringify({ type: 'accept', to: aliceId, transferId }));
  await sleep(200);

  // Alice should receive accept
  const aliceAccept = aliceMsgs.find(m => m.type === 'accept' && m.transferId === transferId);
  ok('Alice receives accept', !!aliceAccept);

  // Alice sends chunks (128 KB each → 2 chunks for 256 KB)
  const CHUNK_SIZE = 128 * 1024;
  let offset = 0, chunkIndex = 0;
  while (offset < fileData.length) {
    const end = Math.min(offset + CHUNK_SIZE, fileData.length);
    const chunk = fileData.slice(offset, end);

    alice.send(JSON.stringify({
      type: 'chunk-meta', to: bobId, transferId,
      fileIndex: 0, chunkIndex, offset, size: chunk.length
    }));
    alice.send(chunk);

    offset = end;
    chunkIndex++;
  }
  ok('Alice sent 2 chunks', chunkIndex === 2);

  // Alice sends file-done and transfer-done
  alice.send(JSON.stringify({ type: 'file-done', to: bobId, transferId, fileIndex: 0 }));
  alice.send(JSON.stringify({ type: 'transfer-done', to: bobId, transferId }));
  await sleep(500);

  // Bob should have received chunk-metas, binary chunks, file-done, transfer-done
  const bobChunkMetas = bobMsgs.filter(m => m.type === 'chunk-meta' && m.transferId === transferId);
  const bobBinaries = bobMsgs.filter(m => m.binary);
  const bobFileDone = bobMsgs.find(m => m.type === 'file-done' && m.transferId === transferId);
  const bobTransferDone = bobMsgs.find(m => m.type === 'transfer-done' && m.transferId === transferId);

  ok('Bob received 2 chunk-metas', bobChunkMetas.length === 2);
  ok('Bob received 2 binary chunks', bobBinaries.length === 2);
  ok('Bob received file-done', !!bobFileDone);
  ok('Bob received transfer-done', !!bobTransferDone);

  // Verify data integrity
  const receivedData = Buffer.concat(bobBinaries.map(b => b.data));
  ok('Received data size matches', receivedData.length === fileData.length);
  ok('Received data content matches', receivedData.equals(fileData));

  // === Text sharing test ===
  console.log('\n--- Text Sharing Test ---\n');

  alice.send(JSON.stringify({ type: 'text', to: bobId, content: 'Hello from Alice! 🎉' }));
  await sleep(200);
  const bobText = bobMsgs.find(m => m.type === 'text');
  ok('Bob receives text', !!bobText);
  ok('Text content correct', bobText && bobText.content === 'Hello from Alice! 🎉');
  ok('Text has sender info', bobText && bobText.fromName === aliceName);

  // === Cancel test ===
  console.log('\n--- Cancel Test ---\n');

  const tid2 = crypto.randomUUID();
  alice.send(JSON.stringify({ type: 'offer-transfer', to: bobId, transferId: tid2, files: [{ name: 'big.zip', size: 999999999, type: '' }], totalSize: 999999999 }));
  await sleep(100);
  alice.send(JSON.stringify({ type: 'cancel', to: bobId, transferId: tid2 }));
  await sleep(200);
  const bobCancel = bobMsgs.find(m => m.type === 'cancel' && m.transferId === tid2);
  ok('Bob receives cancel', !!bobCancel);

  // === Disconnect test ===
  console.log('\n--- Disconnect Test ---\n');
  bobMsgs.length = 0;  // clear
  alice.close();
  await sleep(500);
  const bobPeersAfter = bobMsgs.filter(m => m.type === 'peers').pop();
  ok('Bob gets updated peers after Alice leaves', bobPeersAfter && bobPeersAfter.peers.length === 0);

  // Cleanup
  bob.close();
  await sleep(200);

  // Results
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error('Test error:', e); process.exit(1); });
