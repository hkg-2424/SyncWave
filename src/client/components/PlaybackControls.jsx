import { useEffect, useState } from "react";
import { formatTime } from "../../utils/formatting.js";

/**
 * PlaybackControls — audio scrubber and play/pause controls.
 * Host controls playback; guests follow authoritatively.
 */
export default function PlaybackControls({
  audioRef,
  status,
  isHost,
  duration,
  disabled,
  onRequestPlay,
  onRequestPause,
  onRequestSeek,
}) {
  const [displayTime, setDisplayTime] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  // Smoothly update display time while playing
  useEffect(() => {
    let animFrame;
    const update = () => {
      if (audioRef.current && !isSeeking) {
        setDisplayTime(audioRef.current.currentTime || 0);
      }
      if (status === "playing") {
        animFrame = requestAnimationFrame(update);
      }
    };

    if (status === "playing") {
      animFrame = requestAnimationFrame(update);
    } else if (audioRef.current) {
      setDisplayTime(audioRef.current.currentTime || 0);
    }

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  }, [status, isSeeking, audioRef]);

  function handleSeekChange(e) {
    if (!isHost) return;
    setIsSeeking(true);
    setSeekValue(parseFloat(e.target.value));
  }

  function handleSeekCommit(e) {
    if (!isHost) return;
    setIsSeeking(false);
    const targetTime = parseFloat(e.target.value);
    onRequestSeek(targetTime);
  }

  const effectiveTime = isSeeking ? seekValue : displayTime;
  const effectiveDuration = duration || (audioRef.current?.duration) || 0;
  const progressPercent = effectiveDuration > 0 ? (effectiveTime / effectiveDuration) * 100 : 0;

  return (
    <div className="playback-controls">
      {/* Time & Scrubber */}
      <div className="scrubber-container">
        <span className="time-label">{formatTime(effectiveTime)}</span>
        <div className="slider-wrapper">
          <input
            type="range"
            min={0}
            max={effectiveDuration || 100}
            step={0.1}
            value={effectiveTime}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            disabled={disabled || !isHost || effectiveDuration === 0}
            className={`scrubber-slider ${!isHost ? "guest-readonly" : ""}`}
            style={{
              background: `linear-gradient(to right, var(--color-primary) ${progressPercent}%, rgba(255,255,255,0.1) ${progressPercent}%)`,
            }}
          />
        </div>
        <span className="time-label">{formatTime(effectiveDuration)}</span>
      </div>

      {/* Buttons */}
      <div className="controls-row">
        {isHost ? (
          <button
            id="play-pause-btn"
            className="btn btn-primary play-btn"
            onClick={status === "playing" ? onRequestPause : onRequestPlay}
            disabled={disabled || effectiveDuration === 0}
            title={status === "playing" ? "Pause" : "Play"}
          >
            {status === "playing" ? "⏸ Pause" : "▶ Play"}
          </button>
        ) : (
          <div className="guest-playback-indicator">
            <span className={`status-dot ${status === "playing" ? "connected" : ""}`} />
            <span>{status === "playing" ? "Host is playing" : "Host paused"}</span>
          </div>
        )}
      </div>

      <style>{`
        .playback-controls {
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .scrubber-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .time-label {
          font-family: var(--font-mono);
          font-size: 0.8rem;
          color: var(--color-text-dim);
          min-width: 44px;
        }

        .slider-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
        }

        .scrubber-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          outline: none;
          cursor: pointer;
          transition: background 0.1s;
        }

        .scrubber-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
          cursor: pointer;
          transition: transform 0.1s;
        }

        .scrubber-slider:hover::-webkit-slider-thumb {
          transform: scale(1.2);
        }

        .scrubber-slider.guest-readonly {
          cursor: default;
        }

        .scrubber-slider.guest-readonly::-webkit-slider-thumb {
          cursor: default;
          transform: none;
        }

        .controls-row {
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .play-btn {
          padding: 10px 32px;
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
        }

        .guest-playback-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          color: var(--color-text-dim);
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: var(--radius-full);
          border: 1px solid var(--color-border);
        }
      `}</style>
    </div>
  );
}
