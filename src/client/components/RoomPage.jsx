import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { MESSAGE_TYPES } from "../../protocol/messageTypes.js";
import { useWebRTC } from "../../hooks/useWebRTC.js";
import { useClockSync } from "../../hooks/useClockSync.js";
import { usePlaybackSync } from "../../hooks/usePlaybackSync.js";
import { FileSender, FileReceiver } from "../../services/fileTransfer.js";
import UserList from "./UserList.jsx";
import AudioPlayer from "./AudioPlayer.jsx";
import FileUploader from "./FileUploader.jsx";
import TransferProgress from "./TransferProgress.jsx";
import ConnectionStatus from "./ConnectionStatus.jsx";
import DebugPanel from "./DebugPanel.jsx";

/**
 * RoomPage — the complete real-time synchronized playback experience.
 */
export default function RoomPage() {
  const { roomId } = useParams();

  // ── 1. User identity ──────────────────────────────────────────
  const [userId] = useState(() => {
    let id = sessionStorage.getItem("syncwave-userId");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("syncwave-userId", id);
    }
    return id;
  });

  const [displayName, setDisplayName] = useState(() => {
    let name = sessionStorage.getItem("syncwave-displayName");
    if (!name) {
      name = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
      sessionStorage.setItem("syncwave-displayName", name);
    }
    return name;
  });

  // ── 2. Room State ─────────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | connected | disconnected
  const [users, setUsers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [track, setTrack] = useState(null);
  const [readyUsers, setReadyUsers] = useState([]);
  const [error, setError] = useState(null);

  // Audio source & file transfer state
  const [audioUrl, setAudioUrl] = useState(null);
  const [transferState, setTransferState] = useState(null); // { progress, bytesTransferred, totalBytes, fileName, status }
  // Received blob for guest download
  const [receivedBlob, setReceivedBlob] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const uploadedFileRef = useRef(null); // Host's local File object
  const handleMessageRef = useRef(null);

  const isHost = userId === hostId;
  const isTrackReady = Boolean(audioUrl);

  // ── 3. WebSocket send helper ──────────────────────────────────
  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(msg));
      } catch (err) {
        console.error("[WS] Send failed:", err);
      }
    }
  }, []);

  // ── 4. Clock Synchronization Hook ─────────────────────────────
  // BUG FIX: useClockSync now returns clockSyncRef (the stable ref object)
  // instead of clockSyncRef.current (which was null on first render).
  const { offset, rtt, sampleCount, clockSyncRef, handleClockSyncResponse } =
    useClockSync({ sendMessage });

  // ── 5. Playback Synchronization Hook ──────────────────────────
  // BUG FIX: Now passes clockSyncRef (ref object) instead of clockSync (null on first render).
  // audioRef is created inside the hook and passed to PlaybackSyncManager as a ref object.
  const {
    audioRef,
    status: playbackStatus,
    revision,
    driftMs,
    autoplayBlocked,
    requestPlay,
    requestPause,
    requestSeek,
    enableAudio,
    handlePlaybackMessage,
  } = usePlaybackSync({ clockSyncRef, sendMessage });

  // ── 6. File Receiver ──────────────────────────────────────────
  const fileReceiverRef = useRef(null);
  if (!fileReceiverRef.current) {
    fileReceiverRef.current = new FileReceiver({
      onProgress: ({ progress, bytesReceived, totalBytes, fileName }) => {
        setTransferState({
          progress,
          bytesTransferred: bytesReceived,
          totalBytes,
          fileName,
          status: progress >= 100 ? "verifying" : "transferring",
        });
      },
      onVerified: ({ blob, audioUrl: verifiedUrl, trackInfo }) => {
        setAudioUrl(verifiedUrl);
        setTrack(trackInfo);
        setReceivedBlob(blob); // Store blob so guest can download
        setTransferState((prev) => ({
          ...prev,
          progress: 100,
          status: "ready",
        }));
        // Notify server that local peer is ready
        sendMessage({
          type: MESSAGE_TYPES.TRACK_READY,
        });
      },
      onError: (err) => {
        console.error("[FileReceiver] Verification error:", err);
        setTransferState((prev) => ({
          ...prev,
          status: "error",
        }));
        setError("Audio file verification failed. Please ask the host to re-upload.");
      },
    });
  }

  // ── 7. WebRTC Hook ─────────────────────────────────────────────
  // BUG FIX: useWebRTC now returns webrtcRef (stable ref object) instead of
  // webrtcRef.current. The file transfer handler uses webrtcRef.current to
  // always access the live WebRTCManager.
  const {
    peerStates,
    overallPeerStatus,
    handleSignalingMessage,
    webrtcRef,
  } = useWebRTC({
    localUserId: userId,
    isHost,
    users,
    sendMessage,
    onDataMessage: (fromUserId, data) => {
      fileReceiverRef.current.handleDataMessage(data);
    },
  });

  // When a guest's DataChannel opens and the host has a file loaded, transfer it
  useEffect(() => {
    if (!isHost || !uploadedFileRef.current || !track || !webrtcRef.current) return;

    for (const [peerId, peer] of webrtcRef.current.peers) {
      if (peer.dcState === "open" && !readyUsers.includes(peerId)) {
        FileSender.sendFile(
          peer.dc,
          uploadedFileRef.current,
          track,
          ({ progress, bytesSent, totalBytes }) => {
            setTransferState({
              progress,
              bytesTransferred: bytesSent,
              totalBytes,
              fileName: track.fileName,
              status: progress >= 100 ? "ready" : "transferring",
            });
          }
        ).catch((err) => {
          console.error(`[Host] Failed to transfer file to ${peerId}:`, err);
        });
      }
    }
  }, [isHost, track, peerStates, readyUsers, webrtcRef]);

  // ── 8. WebSocket Connection Lifecycle ─────────────────────────
  const connectWebSocket = useCallback(() => {
    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close any previous socket cleanly
    if (wsRef.current) {
      const oldWs = wsRef.current;
      wsRef.current = null;
      try {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onclose = null;
        oldWs.onerror = null;
        oldWs.close(1000, "Replaced");
      } catch {}
    }

    setConnectionStatus("connecting");
    setError(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/room/${roomId}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) {
        try { ws.close(); } catch {}
        return;
      }

      setConnectionStatus("connected");
      reconnectAttemptsRef.current = 0;

      // Join room
      ws.send(
        JSON.stringify({
          type: MESSAGE_TYPES.JOIN_ROOM,
          roomId,
          userId,
          displayName,
        })
      );
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = JSON.parse(event.data);
        handleMessageRef.current?.(data);
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onclose = (event) => {
      // Ignore close events from superseded sockets
      if (wsRef.current !== ws) return;

      console.log(`[WS] Closed: code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean}`);
      setConnectionStatus("disconnected");
      wsRef.current = null;

      // Do not auto-reconnect if clean departure
      if (event.code === 1000 && event.reason === "Leaving room") {
        return;
      }

      // Auto-reconnect with exponential backoff (Milestone 12)
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempt + 1})`);
      reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.error("[WS] Error:", err);
    };
  }, [roomId, userId, displayName]);

  // ── 9. Main WebSocket Message Handler ─────────────────────────
  const handleMessage = useCallback(
    (data) => {
      switch (data.type) {
        case MESSAGE_TYPES.ROOM_STATE:
          setUsers(data.users || []);
          setHostId(data.hostId);
          if (data.track) setTrack(data.track);
          if (data.readyUsers) setReadyUsers(data.readyUsers);
          handlePlaybackMessage(data);
          break;

        case MESSAGE_TYPES.USER_JOINED:
          setUsers((prev) => {
            if (prev.some((u) => u.userId === data.user.userId)) return prev;
            return [...prev, data.user];
          });
          break;

        case MESSAGE_TYPES.USER_LEFT:
          setUsers((prev) => prev.filter((u) => u.userId !== data.userId));
          setReadyUsers((prev) => prev.filter((id) => id !== data.userId));
          break;

        case MESSAGE_TYPES.HOST_CHANGED:
          setHostId(data.hostId);
          break;

        case MESSAGE_TYPES.TRACK_METADATA:
          setTrack(data.track);
          if (data.readyUsers) setReadyUsers(data.readyUsers);
          // If not host and new track uploaded, reset local readiness
          if (!isHost) {
            setAudioUrl(null);
            setReceivedBlob(null);
            fileReceiverRef.current.reset();
            setTransferState(null);
          }
          break;

        case MESSAGE_TYPES.TRACK_READY:
          setReadyUsers(data.readyUsers || []);
          break;

        case MESSAGE_TYPES.OFFER:
        case MESSAGE_TYPES.ANSWER:
        case MESSAGE_TYPES.ICE_CANDIDATE:
          handleSignalingMessage(data);
          break;

        case MESSAGE_TYPES.CLOCK_SYNC_RESPONSE:
          handleClockSyncResponse(data);
          break;

        case MESSAGE_TYPES.PLAY:
        case MESSAGE_TYPES.PAUSE:
        case MESSAGE_TYPES.SEEK:
          handlePlaybackMessage(data);
          break;

        case MESSAGE_TYPES.ERROR:
          setError(data.message);
          break;

        default:
          break;
      }
    },
    [isHost, handlePlaybackMessage, handleSignalingMessage, handleClockSyncResponse]
  );
  handleMessageRef.current = handleMessage;

  useEffect(() => {
    connectWebSocket();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, "Leaving room");
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  // ── 10. Host File Upload Handler ──────────────────────────────
  // BUG FIX: Uses webrtcRef.current instead of stale webrtcManager value.
  // Previously webrtcManager was captured from hook return as null on first
  // render, so no peers were ever found to send the file to.
  const handleHostFileReady = useCallback(
    async ({ file, track: trackMeta, localAudioUrl }) => {
      uploadedFileRef.current = file;
      setTrack(trackMeta);
      setAudioUrl(localAudioUrl);
      setTransferState({
        progress: 100,
        bytesTransferred: file.size,
        totalBytes: file.size,
        fileName: file.name,
        status: "ready",
      });

      // 1. Broadcast TRACK_METADATA to room
      sendMessage({
        type: MESSAGE_TYPES.TRACK_METADATA,
        track: trackMeta,
      });

      // 2. Transfer file to all open DataChannels
      // BUG FIX: Access webrtcRef.current (live manager) not a stale closure value
      const manager = webrtcRef.current;
      if (manager) {
        for (const [peerId, peer] of manager.peers) {
          if (peer.dcState === "open") {
            FileSender.sendFile(
              peer.dc,
              file,
              trackMeta,
              ({ progress, bytesSent, totalBytes }) => {
                setTransferState({
                  progress,
                  bytesTransferred: bytesSent,
                  totalBytes,
                  fileName: file.name,
                  status: progress >= 100 ? "ready" : "transferring",
                });
              }
            ).catch((err) => {
              console.error(`[Host] Failed to send file to ${peerId}:`, err);
            });
          }
        }
      }
    },
    [sendMessage, webrtcRef]
  );

  // ── 11. Copy Invite Link ──────────────────────────────────────
  const [copied, setCopied] = useState(false);
  function handleCopyLink() {
    const link = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── 12. Display Name Change ───────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);

  function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== displayName) {
      setDisplayName(trimmed);
      sessionStorage.setItem("syncwave-displayName", trimmed);
      // Re-join with new display name
      sendMessage({
        type: MESSAGE_TYPES.JOIN_ROOM,
        roomId,
        userId,
        displayName: trimmed,
      });
    }
    setEditingName(false);
  }

  return (
    <div className="room-page">
      <div className="container">
        {/* Header */}
        <header className="room-header animate-fade-in">
          <Link to="/" className="room-logo">
            <span className="room-logo-icon">◉</span>
            <span className="room-logo-text">SyncWave</span>
          </Link>

          {/* User profile / rename */}
          <div className="user-profile">
            {editingName ? (
              <div className="rename-box">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                  className="input input-sm"
                  maxLength={24}
                  autoFocus
                />
                <button className="btn btn-sm btn-primary" onClick={handleSaveName}>
                  Save
                </button>
              </div>
            ) : (
              <button
                className="user-badge-btn"
                onClick={() => {
                  setNameInput(displayName);
                  setEditingName(true);
                }}
                title="Click to edit your display name"
              >
                👤 {displayName} ✎
              </button>
            )}
          </div>
        </header>

        {/* Room Info Card */}
        <div className="card room-info-card animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <div className="room-info-row">
            <div>
              <div className="section-label">Room</div>
              <div className="room-id">{roomId}</div>
            </div>
            <button
              id="copy-link-btn"
              className="btn btn-icon"
              onClick={handleCopyLink}
              title="Copy invite link"
            >
              {copied ? "✓" : "📋"}
            </button>
          </div>
          {copied && <div className="copy-toast">Link copied to clipboard!</div>}
        </div>

        {/* Audio Track & Player Card */}
        <div className="card animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="section-label">Audio Track</div>

          {track ? (
            <AudioPlayer
              audioRef={audioRef}
              audioUrl={audioUrl}
              track={track}
              status={playbackStatus}
              isHost={isHost}
              isTrackReady={isTrackReady}
              autoplayBlocked={autoplayBlocked}
              onEnableAudio={enableAudio}
              onRequestPlay={requestPlay}
              onRequestPause={requestPause}
              onRequestSeek={requestSeek}
              receivedBlob={receivedBlob}
            />
          ) : (
            <div className="empty-state">
              {isHost
                ? "Select an audio file from your device to listen with peers."
                : "Waiting for the host to upload an audio file…"}
            </div>
          )}

          {/* File Uploader — host only */}
          {isHost && (
            <FileUploader
              isHost={isHost}
              onFileReady={handleHostFileReady}
              disabled={connectionStatus !== "connected"}
            />
          )}

          {/* Transfer progress bar */}
          {transferState && (
            <TransferProgress
              progress={transferState.progress}
              totalBytes={transferState.totalBytes}
              bytesTransferred={transferState.bytesTransferred}
              fileName={transferState.fileName}
              status={transferState.status}
            />
          )}
        </div>

        {/* Connected Users */}
        <UserList
          users={users}
          localUserId={userId}
          hostId={hostId}
          readyUsers={readyUsers}
          connectionStatus={connectionStatus}
        />

        {/* System & Connection Status */}
        <ConnectionStatus
          connectionStatus={connectionStatus}
          peerStatus={overallPeerStatus}
          driftMs={driftMs}
          revision={revision}
          rtt={rtt}
          offset={offset}
        />

        {/* Developer Diagnostics Panel */}
        <DebugPanel
          userId={userId}
          hostId={hostId}
          offset={offset}
          rtt={rtt}
          sampleCount={sampleCount}
          peerStates={peerStates}
          driftMs={driftMs}
          revision={revision}
          track={track}
        />

        {/* Error Notification */}
        {error && (
          <div className="error-banner animate-fade-in">
            ⚠ {error}
          </div>
        )}
      </div>

      <style>{`
        .room-page {
          flex: 1;
          padding: 24px 0 40px;
        }

        .room-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .room-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
        }

        .room-logo-icon {
          font-size: 1.3rem;
          color: var(--color-primary);
        }

        .room-logo-text {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--color-text);
        }

        .user-badge-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--color-border);
          color: var(--color-text);
          font-size: 0.85rem;
          padding: 6px 12px;
          border-radius: var(--radius-full);
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }

        .user-badge-btn:hover {
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .rename-box {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .input-sm {
          padding: 4px 8px;
          font-size: 0.8rem;
          width: 140px;
        }

        .room-info-card {
          margin-bottom: 16px;
        }

        .room-info-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .room-id {
          font-family: var(--font-mono);
          font-size: 1.4rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--color-text);
        }

        .copy-toast {
          font-size: 0.8rem;
          color: var(--color-success);
          margin-top: 8px;
          animation: fadeIn 0.2s ease;
        }

        .card + .card {
          margin-top: 16px;
        }

        .empty-state {
          color: var(--color-text-dim);
          font-size: 0.9rem;
          padding: 12px 0;
          line-height: 1.4;
        }

        .error-banner {
          margin-top: 16px;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.25);
          color: var(--color-error);
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}
