# SyncWave ◉

> Real-time synchronized audio playback powered by Cloudflare Workers, SQLite-backed Durable Objects, and WebRTC DataChannels.

SyncWave allows users to create or join a room via a shareable URL, select an audio file, transfer it peer-to-peer directly between browsers, and listen together in near-perfect synchronization across different devices and networks.

---

## 1. Core Architectural Overview

```
       Browser A (Host)                           Browser B (Guest)
      /                \                         /                 \
     /                  \                       /                   \
HTTPS/WebSocket     WebRTC DataChannel     HTTPS/WebSocket     WebRTC DataChannel
   (Signaling &          (P2P Binary          (Signaling &          (P2P Binary
    Control)            Audio Chunks)          Control)            Audio Chunks)
     |                        \                 /                        |
     v                         \               /                         v
Cloudflare Worker               \             /                  Cloudflare Worker
     |                           \           /                           |
     v                            \         /                            v
Durable Object (RoomDO) <----------+-------+-----------------> Durable Object (RoomDO)
 (Authoritative State, NTP, Signaling Relay)
```

### Key Components & Responsibilities:
* **Cloudflare Worker**: Backend entry point. Handles static asset delivery, room generation (`POST /api/room/create`), and HTTP-to-WebSocket upgrades.
* **Durable Object (`RoomDO`)**: Stateful, single-instance room coordinator identified deterministically by the room ID. Uses the **WebSocket Hibernation API** to keep connections open with zero CPU utilization when idle.
* **WebSocket**: Real-time control plane for user presence, WebRTC SDP/ICE signaling, clock synchronization, and authoritative playback commands.
* **WebRTC DataChannel**: Direct browser-to-browser peer connection (`RTCDataChannel`, ordered and reliable) for high-speed audio file transfer. **Audio files never pass through or touch Cloudflare servers.**

---

## 2. Synchronization Algorithm

SyncWave implements a **server-authoritative distributed timeline**:

1. **NTP-Style 4-Timestamp Clock Synchronization**:
   - The client periodically exchanges timestamps with the Durable Object:
     $$\text{RTT} \approx (T_4 - T_1) - (T_3 - T_2)$$
     $$\text{Offset} \approx \frac{(T_2 - T_1) + (T_3 - T_4)}{2}$$
   - Outliers are filtered using a low-latency sample selection algorithm.
   - Every client translates between server timestamps and local clock time.

2. **Scheduled Playback with Future Timestamps (`executeAt`)**:
   - When the host clicks Play, the client does not start playback immediately.
   - The host sends a `PLAY_REQUEST` to the Durable Object.
   - The Durable Object calculates `executeAt = serverNow + 2000ms`, increments the revision number, and broadcasts the authoritative `PLAY` event:
     ```json
     {
       "type": "PLAY",
       "position": 14.25,
       "executeAt": 1760000002000,
       "revision": 12
     }
     ```
   - Both host and guest convert `executeAt` to their respective local clocks and schedule execution to trigger at the exact same physical moment.

3. **Revision Tracking & Stale Message Rejection**:
   - Every state change (Play, Pause, Seek) increments the room's `revision` counter.
   - Clients discard any incoming message where `incoming.revision <= currentRevision`, preventing out-of-order execution during network fluctuations.

4. **Multi-Tier Drift Detection & Correction**:
   - Every 1.5 seconds during playback, clients compare their local audio `currentTime` with the server's expected timeline position:
     $$\text{Drift} = \text{expectedPosition} - \text{actualPosition}$$
   - **$< 50\text{ ms}$**: Ignored (within perceptual threshold).
   - **$50\text{ ms} - 150\text{ ms}$**: Gentle rate adjustment ($\text{playbackRate} = 1.02$ if behind, $0.98$ if ahead) without audio glitching.
   - **$\ge 150\text{ ms}$**: Hard seek directly to authoritative expected position.

---

## 3. Peer-to-Peer File Transfer Algorithm

Audio files are streamed directly between peers over WebRTC:

1. **Validation**: Host validates file MIME type and verifies file size $\le 100\text{ MB}$.
2. **Metadata & Hashing**: Web Crypto calculates the SHA-256 checksum of the audio file and sends `TRACK_METADATA` to the room.
3. **Chunked Streaming**:
   - File is sliced into $64\text{ KB}$ binary chunks.
   - Backpressure is enforced via `dataChannel.bufferedAmount` and `bufferedamountlow` events (pausing when buffer exceeds $1\text{ MB}$, resuming at $256\text{ KB}$).
4. **Blob Reassembly & Verification**:
   - The receiving browser accumulates chunks in memory.
   - Upon receiving `FILE_COMPLETE`, a `Blob` is reconstructed and its SHA-256 hash is verified against the metadata.
   - Once verified, `URL.createObjectURL(blob)` is passed to the audio element and `TRACK_READY` is signaled to the server.

---

## 4. Local Development

### Prerequisites
* Node.js v18+
* npm

### Setup & Run
```bash
# 1. Install dependencies
npm install

# 2. Run local development server (Vite + Cloudflare workerd)
npm run dev
```

Visit `http://localhost:5173/` in your browser. Open multiple tabs or windows to simulate host and guest peers.

### Run Automated Milestone Tests
```bash
# Verify room lifecycle, signaling relay, playback commands, late joining, and host migration
node test-milestones.js

# Verify chunked DataChannel file transfer and SHA-256 integrity
node test-file-transfer.js
```

---

## 5. Cloudflare Deployment ($0 Free Tier)

SyncWave is designed for 100% compatibility with the **Cloudflare Workers Free Plan**:

* **Cloudflare Workers**: Up to 100,000 requests/day (Free).
* **Durable Objects**: Uses the modern SQLite storage engine and WebSocket Hibernation API.
* **Bandwidth & Storage**: $0 audio storage and egress because audio is transferred peer-to-peer via WebRTC.

### Deploying to Cloudflare
```bash
# 1. Authenticate with your free Cloudflare account
npx wrangler login

# 2. Build the production assets
npm run build

# 3. Deploy Worker and assets
npx wrangler deploy
```

---

## 6. Security & Privacy Boundaries

* **Audio Media**: Transferred strictly peer-to-peer between browsers using encrypted WebRTC DTLS/SCTP channels. Cloudflare never stores, reads, or streams the audio file.
* **Control Signaling**: Room metadata (file name, duration, SHA-256 checksum, playback state) is processed by the Durable Object to coordinate room participants.
