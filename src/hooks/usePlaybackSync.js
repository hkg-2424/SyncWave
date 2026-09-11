import { useEffect, useRef, useState, useCallback } from "react";
import { PlaybackSyncManager } from "../services/playbackSync.js";
import { MESSAGE_TYPES } from "../protocol/messageTypes.js";

/**
 * usePlaybackSync — React hook managing server-authoritative playback and drift.
 *
 * BUG FIX (1): Previously accepted `clockSync` (the service instance) directly.
 * Because useClockSync returned `clockSyncRef.current` which was null on the
 * first render, the effect condition `if (!clockSync) return` prevented the
 * PlaybackSyncManager from ever being created.
 *
 * Fix: Accept `clockSyncRef` (the stable ref object) — the manager now reads
 * `clockSyncRef.current` dynamically, so initialization is unconditional.
 *
 * BUG FIX (2): Previously created PlaybackSyncManager with `audioElement: audioRef.current`.
 * But `audioRef.current` is null at hook initialization time — the <audio> element
 * is inside AudioPlayer which only mounts when `track` is set (after file transfer).
 *
 * Fix: Pass `audioRef` (the ref object) to the manager. PlaybackSyncManager now
 * accesses `this.audioRef.current` dynamically via a getter — always reading the
 * live DOM element whenever it needs it.
 */
export function usePlaybackSync({ clockSyncRef, sendMessage }) {
  const [playbackState, setPlaybackState] = useState({
    status: "paused",
    position: 0,
    revision: 0,
  });
  const [driftMs, setDriftMs] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const audioRef = useRef(null);
  const managerRef = useRef(null);

  useEffect(() => {
    // Create manager immediately — no longer conditional on clockSync being non-null.
    // The manager accesses clockSyncRef.current dynamically when it needs it.
    const manager = new PlaybackSyncManager({
      audioRef,       // Pass the ref object, not .current
      clockSyncRef,   // Pass the ref object, not .current
      sendMessage,
      onStateChange: (state) => setPlaybackState(state),
      onDriftUpdate: ({ driftMs }) => setDriftMs(driftMs),
      onAutoplayBlocked: (blocked) => setAutoplayBlocked(blocked),
    });

    managerRef.current = manager;

    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [clockSyncRef, sendMessage]);

  // Handle server playback messages
  const handlePlaybackMessage = useCallback((data) => {
    if (!managerRef.current) return;

    switch (data.type) {
      case MESSAGE_TYPES.ROOM_STATE:
        managerRef.current.handleRoomState(data.playback);
        break;

      case MESSAGE_TYPES.PLAY:
        managerRef.current.handlePlay(data);
        break;

      case MESSAGE_TYPES.PAUSE:
        managerRef.current.handlePause(data);
        break;

      case MESSAGE_TYPES.SEEK:
        managerRef.current.handleSeek(data);
        break;

      default:
        break;
    }
  }, []);

  const requestPlay = useCallback(() => {
    managerRef.current?.requestPlay();
  }, []);

  const requestPause = useCallback(() => {
    managerRef.current?.requestPause();
  }, []);

  const requestSeek = useCallback((position) => {
    managerRef.current?.requestSeek(position);
  }, []);

  const enableAudio = useCallback(async () => {
    const audio = audioRef.current;
    const manager = managerRef.current;
    if (!audio) return;

    const currentStatus = manager?.status ?? "paused";

    try {
      // ── Step 1: Ensure the audio element is actually loaded ──────────
      // Mobile browsers (iOS Safari, Android Chrome) silently ignore
      // preload="auto" to save bandwidth. The audio has readyState=0
      // (HAVE_NOTHING) even after the src is set. Calling play() on an
      // unbuffered element fails — even from a direct user gesture.
      // We must call load() and wait for canplay before proceeding.
      if (audio.readyState < 3 /* HAVE_FUTURE_DATA */) {
        // Kick off loading if not already in progress
        if (audio.networkState === 0 /* NETWORK_EMPTY */ || audio.readyState === 0) {
          audio.load();
        }
        // Wait up to 8s for the audio to be ready
        await new Promise((resolve) => {
          if (audio.readyState >= 3) { resolve(); return; }
          const onReady = () => {
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("error", onReady);
            resolve();
          };
          audio.addEventListener("canplay", onReady, { once: true });
          audio.addEventListener("error", onReady, { once: true });
          setTimeout(resolve, 8000);
        });
      }

      // ── Step 2: Branch on current playback status ─────────────────────
      if (currentStatus === "playing") {
        // Host is actively playing — seek to the authoritative position so
        // mobile doesn't resume from position 0, then start playback.
        const syncedPosition = manager.getAuthoritativePosition();
        if (isFinite(syncedPosition) && syncedPosition >= 0) {
          audio.currentTime = syncedPosition;
        }
        await audio.play();
        setAutoplayBlocked(false);
        if (manager) {
          manager.onAutoplayBlocked(false);
          manager._startDriftChecking();
        }
      } else {
        // Host is paused — don't play audio, but unlock the mobile audio
        // context so future play() calls will succeed without a gesture.
        // Standard technique: play at volume=0 then immediately pause.
        audio.volume = 0;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              audio.pause();
              audio.volume = 1;
            })
            .catch(() => {
              audio.volume = 1;
            });
        }
        // Context is now unlocked — clear the banner.
        setAutoplayBlocked(false);
        if (manager) manager.onAutoplayBlocked(false);
      }
    } catch (err) {
      console.error("Failed to enable audio:", err);
    }
  }, []);

  return {
    audioRef,
    status: playbackState.status,
    position: playbackState.position,
    revision: playbackState.revision,
    driftMs,
    autoplayBlocked,
    requestPlay,
    requestPause,
    requestSeek,
    enableAudio,
    handlePlaybackMessage,
  };
}
