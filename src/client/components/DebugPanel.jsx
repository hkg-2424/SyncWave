import { useState } from "react";

/**
 * DebugPanel — Developer diagnostics panel for inspecting clock synchronization,
 * WebRTC states, and authoritative timestamps.
 */
export default function DebugPanel({
  userId,
  hostId,
  offset,
  rtt,
  sampleCount,
  peerStates,
  driftMs,
  revision,
  track,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="debug-panel card animate-slide-up" style={{ animationDelay: "0.25s" }}>
      <button
        id="toggle-debug-btn"
        className="debug-toggle"
        onClick={() => setOpen(!open)}
      >
        <span>🛠 Developer Diagnostics</span>
        <span>{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {open && (
        <div className="debug-content animate-fade-in">
          <div className="debug-section">
            <div className="debug-title">Identity</div>
            <div className="debug-item"><span>Your ID:</span> <span className="mono">{userId}</span></div>
            <div className="debug-item"><span>Host ID:</span> <span className="mono">{hostId}</span></div>
          </div>

          <div className="debug-section">
            <div className="debug-title">Clock Synchronization (NTP)</div>
            <div className="debug-item"><span>Server Offset:</span> <span className="mono">{offset} ms</span></div>
            <div className="debug-item"><span>Round-Trip Time:</span> <span className="mono">{rtt} ms</span></div>
            <div className="debug-item"><span>Sync Samples:</span> <span className="mono">{sampleCount}</span></div>
          </div>

          <div className="debug-section">
            <div className="debug-title">Playback Synchronization</div>
            <div className="debug-item"><span>Measured Drift:</span> <span className="mono">{driftMs} ms</span></div>
            <div className="debug-item"><span>Revision:</span> <span className="mono">#{revision}</span></div>
          </div>

          <div className="debug-section">
            <div className="debug-title">WebRTC Peer States</div>
            {Object.keys(peerStates).length === 0 ? (
              <div className="debug-item-dim">No peers connected</div>
            ) : (
              Object.entries(peerStates).map(([pId, s]) => (
                <div key={pId} className="peer-debug-item">
                  <div className="mono peer-id">{pId.slice(0, 8)}…</div>
                  <div className="peer-tags">
                    <span className="tag">PC: {s.connectionState}</span>
                    <span className="tag">ICE: {s.iceConnectionState}</span>
                    <span className="tag">DC: {s.dataChannelState}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {track && (
            <div className="debug-section">
              <div className="debug-title">Track Verification</div>
              <div className="debug-item"><span>File:</span> <span>{track.fileName}</span></div>
              <div className="debug-item"><span>SHA-256:</span> <span className="mono hash">{track.sha256}</span></div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .debug-panel {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .debug-toggle {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: none;
          border: none;
          color: var(--color-text-dim);
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          padding: 4px 0;
        }

        .debug-toggle:hover {
          color: var(--color-text);
        }

        .debug-content {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          font-size: 0.75rem;
          color: var(--color-text-muted);
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding-top: 12px;
        }

        .debug-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .debug-title {
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: 2px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-size: 0.7rem;
        }

        .debug-item {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .debug-item-dim {
          color: var(--color-text-dim);
        }

        .mono {
          font-family: var(--font-mono);
          color: var(--color-text);
        }

        .hash {
          font-size: 0.65rem;
          word-break: break-all;
          max-width: 65%;
          text-align: right;
        }

        .peer-debug-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 3px 0;
        }

        .peer-tags {
          display: flex;
          gap: 4px;
        }

        .tag {
          background: rgba(255, 255, 255, 0.06);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 0.65rem;
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}
