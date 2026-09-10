/**
 * UserList component displaying members, host badges, and track readiness.
 */
export default function UserList({ users, localUserId, hostId, readyUsers, connectionStatus }) {
  return (
    <div className="card animate-slide-up" style={{ animationDelay: "0.1s" }}>
      <div className="section-label">People ({users.length})</div>
      {users.length === 0 ? (
        <div className="empty-state">Connecting…</div>
      ) : (
        <ul className="user-list">
          {users.map((user) => {
            const isReady = readyUsers?.includes(user.userId);
            const isUserHost = user.userId === hostId;
            const isYou = user.userId === localUserId;

            return (
              <li key={user.userId} className="user-item">
                <span
                  className={`status-dot ${
                    connectionStatus === "connected" ? "connected" : "connecting"
                  }`}
                />
                <span className="user-name">
                  {user.displayName}
                  {isYou && <span className="user-you"> (you)</span>}
                </span>

                <div className="user-badges">
                  {isReady && (
                    <span className="badge badge-ready" title="Audio track ready">
                      ✓ Ready
                    </span>
                  )}
                  {isUserHost && <span className="badge badge-host">HOST</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <style>{`
        .user-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .user-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          transition: background 0.15s;
        }

        .user-item:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .user-name {
          font-size: 0.95rem;
          font-weight: 500;
          flex: 1;
        }

        .user-you {
          color: var(--color-text-dim);
          font-weight: 400;
          font-size: 0.85rem;
        }

        .user-badges {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .badge-ready {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
          font-size: 0.7rem;
          padding: 2px 6px;
        }
      `}</style>
    </div>
  );
}
