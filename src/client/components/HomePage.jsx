import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState("");

  async function handleCreateRoom() {
    setCreating(true);
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

  function handleJoinRoom(e) {
    e.preventDefault();
    const id = joinId.trim().toUpperCase();
    if (id) navigate(`/room/${id}`);
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
              onChange={(e) => setJoinId(e.target.value)}
              className="home-join-input"
              maxLength={12}
            />
            <button
              id="join-room-btn"
              type="submit"
              className="btn btn-secondary"
              disabled={!joinId.trim()}
            >
              Join
            </button>
          </form>
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
          margin-bottom: 36px;
        }

        .home-actions {
          margin-bottom: 32px;
        }

        .btn-lg {
          padding: 16px 40px;
          font-size: 1.05rem;
          border-radius: var(--radius-md);
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
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
            width: 100%;
          }
          .home-join-form {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
