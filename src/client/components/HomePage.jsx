import { useState } from "react";
import { useNavigate } from "react-router-dom";

const NAME_KEY = "syncwave-displayName";

function getStoredName() {
  return sessionStorage.getItem(NAME_KEY) || "";
}

export default function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [joining, setJoining] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false); // { roomId }
  const [displayName, setDisplayName] = useState(() => getStoredName());
  const [nameTouched, setNameTouched] = useState(false);

  const trimmedName = displayName.trim();
  const nameValid = trimmedName.length > 0;
  const nameError = nameTouched && !nameValid ? "Please enter a display name." : null;

  function saveName() {
    sessionStorage.setItem(NAME_KEY, trimmedName);
  }

  async function handleCreateRoom() {
    setNameTouched(true);
    if (!nameValid) return;
    saveName();
    setCreating(true);
    setRoomNotFound(false);
    try {
      const res = await fetch("/api/room/create", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create room");
      const { roomId } = await res.json();
      navigate(`/room/${roomId}`);
    } catch (err) {
      console.error("Failed to create room:", err);
      setCreating(false);
    }
  }

  async function handleJoinRoom(e) {
    e.preventDefault();
    setNameTouched(true);
    if (!nameValid) return;
    const id = joinId.trim().toUpperCase();
    if (!id) return;
    saveName();
    setJoining(true);
    setRoomNotFound(false);
    try {
      const res = await fetch(`/api/room/${id}/exists`);
      const { exists } = await res.json();
      if (exists) {
        navigate(`/room/${id}`);
      } else {
        setRoomNotFound(true);
        setJoining(false);
      }
    } catch {
      // Network error — let them through anyway, server will handle it
      navigate(`/room/${id}`);
    }
  }

  return (
    <div className="home-page">
      {/* Background gradient orbs */}
      <div className="home-bg">
        <div className="home-orb home-orb-1" />
        <div className="home-orb home-orb-2" />
      </div>

      <div className="home-content animate-slide-up">
        {/* Logo */}
        <div className="home-logo">
          <span className="home-logo-icon">◉</span>
          <h1 className="home-title">SyncWave</h1>
        </div>

        <p className="home-tagline">Listen together, in sync.</p>

        <p className="home-desc">
          Create a room, share the link, and enjoy perfectly synchronized audio
          with friends — no accounts, no uploads to servers. Your music travels
          directly between browsers.
        </p>

        {/* ── Display Name Picker ─────────────────────────────── */}
        <div className="name-picker">
          <label className="name-label" htmlFor="display-name-input">
            👤 Your display name
          </label>
          <input
            id="display-name-input"
            type="text"
            className={`name-input${nameError ? " name-input-error" : ""}${nameValid ? " name-input-valid" : ""}`}
            placeholder="e.g. Alex, DJ Shadow…"
            value={displayName}
            maxLength={24}
            autoComplete="nickname"
            onChange={(e) => {
              setDisplayName(e.target.value);
              setNameTouched(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
          />
          {nameError && <div className="name-error-msg">⚠ {nameError}</div>}
          {nameValid && (
            <div className="name-preview">
              You'll appear as <strong>{trimmedName}</strong> in the room
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="home-actions">
          <button
            id="create-room-btn"
            className="btn btn-primary btn-lg"
            onClick={handleCreateRoom}
            disabled={creating}
          >
            {creating ? (
              <>
                <span className="spinner" />
                Creating…
              </>
            ) : (
              "Create Room"
            )}
          </button>
        </div>

        {/* Join by code */}
        <div className="home-join-section">
          <div className="home-divider">
            <span>or join an existing room</span>
          </div>
          <form className="home-join-form" onSubmit={handleJoinRoom}>
            <input
              id="join-room-input"
              type="text"
              placeholder="Enter Room ID"
              value={joinId}
              onChange={(e) => { setJoinId(e.target.value); setRoomNotFound(false); }}
              className={`home-join-input${roomNotFound ? " join-input-error" : ""}`}
              maxLength={12}
            />
            <button
              id="join-room-btn"
              type="submit"
              className="btn btn-secondary"
              disabled={!joinId.trim() || joining}
            >
              {joining ? <><span className="spinner spinner-dark" /> Checking…</> : "Join"}
            </button>
          </form>

          {/* Room Not Found card */}
          {roomNotFound && (
            <div className="room-not-found animate-fade-in">
              <div className="rnf-icon">🔍</div>
              <div className="rnf-body">
                <div className="rnf-title">
                  Room <span className="rnf-id">{joinId.trim().toUpperCase()}</span> not found
                </div>
                <p className="rnf-desc">
                  No active room exists with that ID. It may have expired or the ID could be wrong.
                </p>
                <div className="rnf-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleCreateRoom}
                    disabled={creating}
                  >
                    {creating ? <><span className="spinner" /> Creating…</> : "✦ Create My Own Room"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setRoomNotFound(false); setJoinId(""); }}
                  >
                    Try Another ID
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .home-page {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          padding: 40px 20px;
        }

        /* Room Not Found */
        .join-input-error {
          border-color: var(--color-error) !important;
          box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15);
        }

        .room-not-found {
          margin-top: 16px;
          display: flex;
          align-items: flex-start;
          gap: 14px;
          background: rgba(248, 113, 113, 0.06);
          border: 1px solid rgba(248, 113, 113, 0.25);
          border-radius: var(--radius-lg);
          padding: 18px;
          text-align: left;
        }

        .rnf-icon {
          font-size: 1.6rem;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .rnf-body {
          flex: 1;
        }

        .rnf-title {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--color-text);
          margin-bottom: 4px;
        }

        .rnf-id {
          font-family: var(--font-mono);
          color: var(--color-error);
        }

        .rnf-desc {
          font-size: 0.8rem;
          color: var(--color-text-dim);
          line-height: 1.5;
          margin-bottom: 14px;
        }

        .rnf-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .rnf-actions .btn {
          padding: 8px 18px;
          font-size: 0.85rem;
        }

        .spinner-dark {
          border-color: rgba(0,0,0,0.2);
          border-top-color: #333;
        }

        .home-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }

        .home-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          opacity: 0.4;
        }

        .home-orb-1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, var(--color-primary) 0%, transparent 70%);
          top: -200px;
          right: -100px;
          animation: float 8s ease-in-out infinite;
        }

        .home-orb-2 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, var(--color-accent) 0%, transparent 70%);
          bottom: -150px;
          left: -100px;
          animation: float 10s ease-in-out infinite reverse;
        }

        @keyframes float {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, -20px); }
        }

        .home-content {
          position: relative;
          z-index: 1;
          text-align: center;
          max-width: 480px;
          width: 100%;
        }

        .home-logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .home-logo-icon {
          font-size: 2rem;
          color: var(--color-primary);
          filter: drop-shadow(0 0 8px var(--color-primary-glow));
        }

        .home-title {
          font-size: 2.8rem;
          font-weight: 800;
          background: linear-gradient(135deg, var(--color-text) 0%, var(--color-primary-hover) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -0.02em;
        }

        .home-tagline {
          font-size: 1.2rem;
          color: var(--color-text-muted);
          font-weight: 400;
          margin-bottom: 16px;
        }

        .home-desc {
          font-size: 0.9rem;
          color: var(--color-text-dim);
          line-height: 1.7;
          margin-bottom: 32px;
        }

        /* ── Name Picker ─────────────────────────────────── */
        .name-picker {
          text-align: left;
          margin-bottom: 28px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: 18px 20px 16px;
          transition: border-color var(--transition-med);
        }
        .name-picker:focus-within {
          border-color: var(--color-border-glow);
          box-shadow: 0 0 0 1px var(--color-primary-glow);
        }

        .name-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-dim);
          margin-bottom: 10px;
        }

        .name-input {
          width: 100%;
          padding: 11px 14px;
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text);
          font-family: var(--font-sans);
          font-size: 1rem;
          font-weight: 500;
          outline: none;
          transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
        }
        .name-input::placeholder {
          color: var(--color-text-dim);
          font-weight: 400;
        }
        .name-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-glow);
        }
        .name-input.name-input-valid {
          border-color: rgba(52, 211, 153, 0.4);
        }
        .name-input.name-input-error {
          border-color: var(--color-error);
          box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15);
        }

        .name-error-msg {
          margin-top: 7px;
          font-size: 0.78rem;
          color: var(--color-error);
        }

        .name-preview {
          margin-top: 8px;
          font-size: 0.78rem;
          color: var(--color-text-dim);
        }
        .name-preview strong {
          color: var(--color-primary-hover);
          font-weight: 600;
        }

        /* ── Actions ─────────────────────────────────────── */
        .home-actions {
          margin-bottom: 32px;
        }

        .btn-lg {
          padding: 16px 40px;
          font-size: 1.05rem;
          border-radius: var(--radius-md);
          width: 100%;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          flex-shrink: 0;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .home-join-section {
          width: 100%;
        }

        .home-divider {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }

        .home-divider::before,
        .home-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--color-border);
        }

        .home-divider span {
          font-size: 0.8rem;
          color: var(--color-text-dim);
          white-space: nowrap;
        }

        .home-join-form {
          display: flex;
          gap: 8px;
        }

        .home-join-input {
          flex: 1;
          padding: 12px 16px;
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          color: var(--color-text);
          font-family: var(--font-mono);
          font-size: 0.95rem;
          letter-spacing: 0.05em;
          outline: none;
          transition: border-color var(--transition-fast);
        }

        .home-join-input::placeholder {
          color: var(--color-text-dim);
          font-family: var(--font-sans);
          letter-spacing: 0;
        }

        .home-join-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-glow);
        }

        @media (max-width: 480px) {
          .home-title {
            font-size: 2rem;
          }
          .btn-lg {
            padding: 14px 32px;
            font-size: 1rem;
          }
          .home-join-form {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
