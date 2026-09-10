import { DurableObject } from "cloudflare:workers";
import { MESSAGE_TYPES } from "./protocol/messageTypes.js";

/**
 * RoomDO — Durable Object representing a single SyncWave room.
 *
 * Each room gets its own Durable Object instance, identified by the room ID.
 * This DO uses the WebSocket Hibernation API so it can release memory while
 * keeping WebSocket connections alive at Cloudflare's edge.
 *
 * Responsibilities:
 *   - Room identity and user membership
 *   - Host assignment and reassignment (persisted to storage to survive hibernation)
 *   - Authoritative playback state (play/pause/seek with revisions)
 *   - WebRTC signaling relay (SDP offers/answers, ICE candidates)
 *   - Clock synchronization responses
 *   - Track metadata and peer readiness coordination
 *
 * BUG FIX: hostId and track are now persisted to Durable Object KV storage.
 * Previously, these were in-memory only — when Cloudflare hibernated the DO,
 * they were wiped, causing the first reconnector to be incorrectly promoted to host.
 */
export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    // In-memory room state (rebuilt from WebSocket attachments on wake)
    this.roomId = null;
    this.users = new Map(); // userId -> { userId, displayName, ws }
    this.hostId = null;

    // Track metadata (set when host uploads audio) — also persisted to storage
    this.track = null;

    // Authoritative playback state
    this.playback = {
      status: "paused", // "playing" | "paused"
      position: 0, // seconds
      startedAtServerTime: null, // ms timestamp or null
      revision: 0,
    };

    // Track which users have the track ready locally
    this.readyUsers = new Set();

    // Load persisted state from storage once, before handling any requests.
    // blockConcurrencyWhile ensures no requests are handled until this resolves.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get(["hostId", "track"]);
      this.hostId = stored.get("hostId") ?? null;
      this.track = stored.get("track") ?? null;
    });
  }

  /**
   * Handle incoming HTTP requests to this Durable Object.
   * The only expected request type is a WebSocket upgrade.
   */
  async fetch(request) {
    const url = new URL(request.url);

    // Extract roomId from the URL path: /api/room/:roomId/ws
    const pathParts = url.pathname.split("/");
    const roomIdx = pathParts.indexOf("room");
    if (roomIdx !== -1 && pathParts[roomIdx + 1]) {
      this.roomId = pathParts[roomIdx + 1];
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept the WebSocket using the Hibernation API.
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  /**
   * Called when a WebSocket message is received.
   */
  webSocketMessage(ws, message) {
    try {
      if (typeof message !== "string") return;

      const data = JSON.parse(message);

      switch (data.type) {
        case MESSAGE_TYPES.JOIN_ROOM:
          this.handleJoinRoom(ws, data);
          break;

        case MESSAGE_TYPES.CLOCK_SYNC_REQUEST:
          this.handleClockSyncRequest(ws, data);
          break;

        case MESSAGE_TYPES.OFFER:
          this.handleOffer(ws, data);
          break;

        case MESSAGE_TYPES.ANSWER:
          this.handleAnswer(ws, data);
          break;

        case MESSAGE_TYPES.ICE_CANDIDATE:
          this.handleIceCandidate(ws, data);
          break;

        case MESSAGE_TYPES.TRACK_METADATA:
          this.handleTrackMetadata(ws, data);
          break;

        case MESSAGE_TYPES.TRACK_READY:
          this.handleTrackReady(ws, data);
          break;

        case MESSAGE_TYPES.PLAY_REQUEST:
          this.handlePlayRequest(ws, data);
          break;

        case MESSAGE_TYPES.PAUSE_REQUEST:
          this.handlePauseRequest(ws, data);
          break;

        case MESSAGE_TYPES.SEEK_REQUEST:
          this.handleSeekRequest(ws, data);
          break;

        default:
          this.sendTo(ws, {
            type: MESSAGE_TYPES.ERROR,
            message: `Unknown message type: ${data.type}`,
          });
      }
    } catch (err) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Invalid message format",
      });
    }
  }

  /**
   * Called when a WebSocket connection closes.
   */
  webSocketClose(ws, code, reason, wasClean) {
    this.handleDisconnect(ws);
  }

  /**
   * Called when a WebSocket error occurs.
   */
  webSocketError(ws, error) {
    this.handleDisconnect(ws);
  }

  // ─── Room & User Handlers ─────────────────────────────────────

  handleJoinRoom(ws, data) {
    const { userId, displayName } = data;

    if (!userId || !displayName) {
      this.sendTo(ws, { type: MESSAGE_TYPES.ERROR, message: "Missing userId or displayName" });
      return;
    }

    // Check room capacity (max 10 for MVP)
    if (this.users.size >= 10 && !this.users.has(userId)) {
      this.sendTo(ws, { type: MESSAGE_TYPES.ERROR, message: "Room is full (max 10 users)" });
      return;
    }

    // If this userId is already connected (reconnection), clean up old WS
    if (this.users.has(userId)) {
      const existing = this.users.get(userId);
      if (existing.ws !== ws) {
        try { existing.ws.close(1000, "Replaced by new connection"); } catch {}
      }
    }

    // Store user info in the WebSocket attachment so it survives hibernation
    ws.serializeAttachment({ userId, displayName });

    // Register the user
    this.users.set(userId, { userId, displayName, ws });

    // Assign host if no host exists OR if the stored host is no longer connected.
    // NOTE: We use the persisted this.hostId here (loaded from storage in constructor).
    // We only reassign if the host slot is genuinely empty.
    if (!this.hostId) {
      this.hostId = userId;
      // Persist the new host assignment
      this.ctx.storage.put("hostId", this.hostId);
    }

    // Send current room state to the joining user
    this.sendTo(ws, {
      type: MESSAGE_TYPES.ROOM_STATE,
      roomId: this.roomId,
      hostId: this.hostId,
      users: this.getUserList(),
      track: this.track,
      playback: this.getAuthoritativePlayback(),
      readyUsers: Array.from(this.readyUsers),
    });

    // Notify all other users that someone joined
    this.broadcast({
      type: MESSAGE_TYPES.USER_JOINED,
      user: { userId, displayName },
    }, userId);
  }

  handleDisconnect(ws) {
    const disconnectedUserId = this.getUserId(ws);
    if (!disconnectedUserId) return;

    this.users.delete(disconnectedUserId);
    this.readyUsers.delete(disconnectedUserId);

    // Notify remaining users
    this.broadcast({
      type: MESSAGE_TYPES.USER_LEFT,
      userId: disconnectedUserId,
    });

    // Host reassignment: only if host disconnected AND there are remaining users.
    // We check this.users (connected users) — not all known users.
    if (this.hostId === disconnectedUserId && this.users.size > 0) {
      const newHost = this.users.values().next().value;
      this.hostId = newHost.userId;
      // Persist the host change
      this.ctx.storage.put("hostId", this.hostId);
      this.broadcast({
        type: MESSAGE_TYPES.HOST_CHANGED,
        hostId: this.hostId,
      });
    }

    if (this.users.size === 0) {
      // Room is now empty — reset everything including persisted state
      this.hostId = null;
      this.track = null;
      this.readyUsers.clear();
      this.playback = {
        status: "paused",
        position: 0,
        startedAtServerTime: null,
        revision: 0,
      };
      // Clear persisted state so the next room session starts fresh
      this.ctx.storage.delete("hostId");
      this.ctx.storage.delete("track");
    }
  }

  // ─── WebRTC Signaling Relay (Milestone 3) ──────────────────────

  handleOffer(ws, data) {
    const senderId = this.getUserId(ws);
    const { targetUserId, sdp } = data;
    if (!senderId || !targetUserId || !sdp) return;

    const targetUser = this.users.get(targetUserId);
    if (targetUser) {
      this.sendTo(targetUser.ws, {
        type: MESSAGE_TYPES.OFFER,
        fromUserId: senderId,
        sdp,
      });
    }
  }

  handleAnswer(ws, data) {
    const senderId = this.getUserId(ws);
    const { targetUserId, sdp } = data;
    if (!senderId || !targetUserId || !sdp) return;

    const targetUser = this.users.get(targetUserId);
    if (targetUser) {
      this.sendTo(targetUser.ws, {
        type: MESSAGE_TYPES.ANSWER,
        fromUserId: senderId,
        sdp,
      });
    }
  }

  handleIceCandidate(ws, data) {
    const senderId = this.getUserId(ws);
    const { targetUserId, candidate } = data;
    if (!senderId || !targetUserId || !candidate) return;

    const targetUser = this.users.get(targetUserId);
    if (targetUser) {
      this.sendTo(targetUser.ws, {
        type: MESSAGE_TYPES.ICE_CANDIDATE,
        fromUserId: senderId,
        candidate,
      });
    }
  }

  // ─── Track State (Milestone 5) ────────────────────────────────

  handleTrackMetadata(ws, data) {
    const senderId = this.getUserId(ws);
    if (senderId !== this.hostId) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Only the host can set track metadata",
      });
      return;
    }

    const { track } = data;
    if (!track || !track.fileName || !track.sha256) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Invalid track metadata",
      });
      return;
    }

    this.track = track;
    this.readyUsers.clear();
    // The host uploading the track has it ready locally
    this.readyUsers.add(senderId);

    // Persist track metadata to storage
    this.ctx.storage.put("track", this.track);

    // Reset playback position and status
    this.playback = {
      status: "paused",
      position: 0,
      startedAtServerTime: null,
      revision: this.playback.revision + 1,
    };

    this.broadcast({
      type: MESSAGE_TYPES.TRACK_METADATA,
      track: this.track,
      readyUsers: Array.from(this.readyUsers),
    });
  }

  handleTrackReady(ws, data) {
    const senderId = this.getUserId(ws);
    if (!senderId) return;

    this.readyUsers.add(senderId);
    this.broadcast({
      type: MESSAGE_TYPES.TRACK_READY,
      userId: senderId,
      readyUsers: Array.from(this.readyUsers),
    });
  }

  // ─── Authoritative Playback (Milestone 7 & 8) ──────────────────

  handlePlayRequest(ws, data) {
    const senderId = this.getUserId(ws);
    if (senderId !== this.hostId) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Only the host can control playback",
      });
      return;
    }

    if (!this.track) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "No track loaded",
      });
      return;
    }

    const serverNow = Date.now();
    // Future execution timestamp: 2000ms in future per spec Section 19
    const executeAt = serverNow + 2000;
    const currentPosition = this.computeCurrentPosition(serverNow);

    this.playback.status = "playing";
    this.playback.position = currentPosition;
    this.playback.startedAtServerTime = executeAt;
    this.playback.revision += 1;

    this.broadcast({
      type: MESSAGE_TYPES.PLAY,
      position: currentPosition,
      executeAt,
      revision: this.playback.revision,
    });
  }

  handlePauseRequest(ws, data) {
    const senderId = this.getUserId(ws);
    if (senderId !== this.hostId) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Only the host can control playback",
      });
      return;
    }

    const serverNow = Date.now();
    const currentPosition = this.computeCurrentPosition(serverNow);

    this.playback.status = "paused";
    this.playback.position = currentPosition;
    this.playback.startedAtServerTime = null;
    this.playback.revision += 1;

    this.broadcast({
      type: MESSAGE_TYPES.PAUSE,
      position: currentPosition,
      revision: this.playback.revision,
    });
  }

  handleSeekRequest(ws, data) {
    const senderId = this.getUserId(ws);
    if (senderId !== this.hostId) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Only the host can control playback",
      });
      return;
    }

    const { position } = data;
    if (typeof position !== "number" || isNaN(position) || position < 0) {
      this.sendTo(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: "Invalid seek position",
      });
      return;
    }

    const serverNow = Date.now();
    this.playback.position = position;
    this.playback.revision += 1;

    if (this.playback.status === "playing") {
      this.playback.startedAtServerTime = serverNow;
    } else {
      this.playback.startedAtServerTime = null;
    }

    this.broadcast({
      type: MESSAGE_TYPES.SEEK,
      position,
      revision: this.playback.revision,
      status: this.playback.status,
    });
  }

  // ─── Clock Synchronization (Milestone 9) ──────────────────────

  handleClockSyncRequest(ws, data) {
    const now = Date.now();
    this.sendTo(ws, {
      type: MESSAGE_TYPES.CLOCK_SYNC_RESPONSE,
      clientSendTime: data.clientSendTime,
      serverReceiveTime: now,
      serverSendTime: now,
    });
  }

  // ─── Utilities ────────────────────────────────────────────────

  getUserId(ws) {
    try {
      const attachment = ws.deserializeAttachment();
      if (attachment?.userId) return attachment.userId;
    } catch {}

    for (const [uid, user] of this.users) {
      if (user.ws === ws) return uid;
    }
    return null;
  }

  computeCurrentPosition(serverNow = Date.now()) {
    if (this.playback.status !== "playing" || !this.playback.startedAtServerTime) {
      return this.playback.position;
    }
    // If startedAtServerTime is in the future (scheduled play), position hasn't advanced yet
    if (serverNow < this.playback.startedAtServerTime) {
      return this.playback.position;
    }
    const elapsedSec = (serverNow - this.playback.startedAtServerTime) / 1000;
    const computed = this.playback.position + elapsedSec;
    if (this.track?.duration && computed > this.track.duration) {
      return this.track.duration;
    }
    return computed;
  }

  getAuthoritativePlayback() {
    return {
      status: this.playback.status,
      position: this.computeCurrentPosition(),
      startedAtServerTime: this.playback.startedAtServerTime,
      revision: this.playback.revision,
    };
  }

  sendTo(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    for (const [uid, user] of this.users) {
      if (uid === excludeUserId) continue;
      try {
        user.ws.send(message);
      } catch {}
    }
  }

  getUserList() {
    return Array.from(this.users.values()).map(({ userId, displayName }) => ({
      userId,
      displayName,
    }));
  }
}
