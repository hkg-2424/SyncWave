/**
 * ConnectionStatus component displaying WebSocket, WebRTC, Drift, and Revision indicators.
 */
export default function ConnectionStatus({
  connectionStatus,
  peerStatus,
  driftMs,
  revision,
  rtt,
  offset,
}) {
  return (
    <div className="card room-status-card animate-slide-up" style={{ animationDelay: "0.2s" }}>
      <div className="section-label">System Status</div>

      <div className="status-grid">
        <div className="status-row">
          <span className="status-label">Server Connection</span>
          <span className={`status-value status-${connectionStatus}`}>
            <span className={`status-dot ${connectionStatus}`} />
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "connecting"
              ? "Connecting…"
              : "Disconnected"}
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">P2P DataChannel</span>
          <span className={`status-value status-${peerStatus}`}>
            <span className={`status-dot ${peerStatus}`} />
            {peerStatus === "connected"
              ? "Connected"
              : peerStatus === "connecting"
              ? "Negotiating…"
              : "No Peers"}
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">Sync Drift</span>
          <span className="status-value font-mono">
            {Math.abs(driftMs || 0)} ms
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">Playback Revision</span>
          <span className="status-value font-mono">
            #{revision || 0}
          </span>
        </div>
      </div>

      <style>{`
        .status-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2px 0;
        }

        .status-label {
          font-size: 0.85rem;
          color: var(--color-text-muted);
        }

        .status-value {
          font-size: 0.85rem;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-connected { color: var(--color-success); }
        .status-connecting { color: var(--color-warning); }
        .status-disconnected { color: var(--color-text-dim); }

        .font-mono {
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}
