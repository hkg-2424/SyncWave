import { formatFileSize } from "../../utils/formatting.js";

/**
 * TransferProgress component showing real-time peer-to-peer audio transfer progress.
 */
export default function TransferProgress({ progress, totalBytes, bytesTransferred, fileName, status }) {
  if (progress === null || progress === undefined) return null;

  return (
    <div className="transfer-progress-card animate-fade-in">
      <div className="transfer-info">
        <span className="transfer-filename">{fileName || "Audio File"}</span>
        <span className="transfer-percentage">{progress}%</span>
      </div>

      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      <div className="transfer-meta">
        <span className="transfer-status">
          {status === "verifying" && "🔍 Verifying SHA-256 integrity…"}
          {status === "transferring" && "⚡ Transferring peer-to-peer…"}
          {status === "ready" && "✓ Verified & Ready"}
          {status === "error" && "⚠ Verification failed"}
        </span>
        {totalBytes > 0 && (
          <span className="transfer-bytes">
            {formatFileSize(bytesTransferred || 0)} / {formatFileSize(totalBytes)}
          </span>
        )}
      </div>

      <style>{`
        .transfer-progress-card {
          margin-top: 14px;
          padding: 12px;
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--color-border);
        }

        .transfer-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 0.85rem;
        }

        .transfer-filename {
          font-weight: 500;
          color: var(--color-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 75%;
        }

        .transfer-percentage {
          font-family: var(--font-mono);
          font-weight: 600;
          color: var(--color-primary);
        }

        .progress-bar-track {
          width: 100%;
          height: 8px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--color-primary), #818cf8);
          border-radius: 4px;
          transition: width 0.15s ease-out;
        }

        .transfer-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.75rem;
          color: var(--color-text-dim);
        }

        .transfer-status {
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
