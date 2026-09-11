import { useEffect, useRef } from "react";
import PlaybackControls from "./PlaybackControls.jsx";
import { formatFileSize } from "../../utils/formatting.js";

/**
 * AudioPlayer component holding the HTMLAudioElement and playback interface.
 *
 * NEW: Guests who have received the audio file via WebRTC are shown a
 * "Download" button so they can save the file locally.
 */
export default function AudioPlayer({
  audioRef,
  audioUrl,
  track,
  status,
  isHost,
  isTrackReady,
  autoplayBlocked,
  onEnableAudio,
  onRequestPlay,
  onRequestPause,
  onRequestSeek,
  receivedBlob, // Blob received via WebRTC (guests only)
}) {
  const previousUrlRef = useRef(null);

  // Manage object URL lifecycle to prevent memory leaks (Milestone 14)
  useEffect(() => {
    if (audioUrl && audioUrl !== previousUrlRef.current) {
      if (previousUrlRef.current && previousUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(previousUrlRef.current);
      }
      previousUrlRef.current = audioUrl;
    }

    return () => {
      if (previousUrlRef.current && previousUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(previousUrlRef.current);
      }
    };
  }, [audioUrl]);

  // iOS Safari and Android Chrome require an explicit audio.load() call when
  // the src changes — they do NOT auto-load the new source, causing play() to
  // silently fail until load() is called first.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && audioUrl) {
      audio.load();
    }
  }, [audioUrl, audioRef]);

  // Create a download URL for the guest (from the received blob)
  const downloadUrl = receivedBlob ? URL.createObjectURL(receivedBlob) : audioUrl;
  const canDownload = !isHost && isTrackReady && track;

  return (
    <div className="audio-player-card">
      {/* Underlying Audio Element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="auto"
        playsInline
      />

      {/* Autoplay restriction warning & unlock button (Section 31) */}
      {autoplayBlocked && (
        <div className="autoplay-banner animate-slide-up">
          <span>Browser blocked autoplay. Click to enable synchronized playback:</span>
          <button
            id="enable-audio-btn"
            className="btn btn-secondary btn-sm"
            onClick={onEnableAudio}
          >
            🔊 Enable Audio
          </button>
        </div>
      )}

      {track ? (
        <div className="track-details">
          <div className="track-icon">🎵</div>
          <div className="track-meta-content">
            <div className="track-name" title={track.fileName}>
              {track.fileName}
            </div>
            <div className="track-subtext">
              {formatFileSize(track.size)} • {track.mimeType || "audio"}
            </div>
          </div>

          {/* Guest download button — only shown after file is fully received */}
          {canDownload && (
            <a
              id="guest-download-btn"
              href={downloadUrl}
              download={track.fileName}
              className="btn btn-download"
              title={`Download ${track.fileName}`}
            >
              ⬇ Download
            </a>
          )}
        </div>
      ) : null}

      <PlaybackControls
        audioRef={audioRef}
        status={status}
        isHost={isHost}
        duration={track?.duration || 0}
        disabled={!isTrackReady}
        onRequestPlay={onRequestPlay}
        onRequestPause={onRequestPause}
        onRequestSeek={onRequestSeek}
      />

      <style>{`
        .audio-player-card {
          margin-top: 8px;
        }

        .autoplay-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          margin-bottom: 14px;
          font-size: 0.85rem;
          color: var(--color-warning);
          gap: 12px;
        }

        .btn-sm {
          padding: 4px 12px;
          font-size: 0.8rem;
          white-space: nowrap;
        }

        .track-details {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: var(--radius-md);
          border: 1px solid var(--color-border);
        }

        .track-icon {
          font-size: 1.6rem;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          background: rgba(99, 102, 241, 0.12);
          border-radius: var(--radius-sm);
        }

        .track-meta-content {
          overflow: hidden;
          flex: 1;
        }

        .track-name {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--color-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-subtext {
          font-size: 0.75rem;
          color: var(--color-text-dim);
          margin-top: 2px;
        }

        .btn-download {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          font-size: 0.78rem;
          font-weight: 600;
          text-decoration: none;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.35);
          color: var(--color-primary);
          border-radius: var(--radius-full);
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }

        .btn-download:hover {
          background: rgba(99, 102, 241, 0.22);
          border-color: rgba(99, 102, 241, 0.55);
          transform: translateY(-1px);
        }

        .btn-download:active {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}
