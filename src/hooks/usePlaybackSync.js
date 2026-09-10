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
    if (audio) {
      try {
        await audio.play();
        setAutoplayBlocked(false);
      } catch (err) {
        console.error("Failed to enable audio:", err);
      }
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
