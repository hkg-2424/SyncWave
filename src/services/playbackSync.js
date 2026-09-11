import { MESSAGE_TYPES } from "../protocol/messageTypes.js";

/**
 * PlaybackSyncManager — handles server-authoritative playback synchronization.
 *
 * BUG FIX: Previously accepted `audioElement` directly in the constructor.
 * The audio element is attached to a React ref and only mounted AFTER the
 * AudioPlayer component renders (which only happens when `track` is set).
 * So `audioElement` was always `null` at construction time.
 *
 * Fix: Accept `audioRef` (the React ref object) instead, and access
 * `this.audioRef.current` dynamically throughout — guaranteeing we always
 * work with the live DOM element, regardless of when it mounts.
 *
 * Implements:
 *   - Scheduled play execution via future executeAt timestamps
 *   - Revision tracking (rejecting stale updates)
 *   - Continuous drift calculation
 *   - Tiered drift correction:
 *       < 50ms: ignore
 *       50ms - 150ms: gentle playbackRate adjustment
 *       >= 150ms: hard seek
 *   - Autoplay handling & recovery
 */
export class PlaybackSyncManager {
  constructor({
    audioRef,
    clockSyncRef,
    sendMessage,
    onStateChange,
    onDriftUpdate,
    onAutoplayBlocked,
  }) {
    // Store refs (objects), not values — so we always get the current element/service
    this.audioRef = audioRef;
    this.clockSyncRef = clockSyncRef;
    this.sendMessage = sendMessage;
    this.onStateChange = onStateChange || (() => {});
    this.onDriftUpdate = onDriftUpdate || (() => {});
    this.onAutoplayBlocked = onAutoplayBlocked || (() => {});

    this.currentRevision = -1;
    this.status = "paused";
    this.authoritativePosition = 0;
    this.startedAtServerTime = null;

    this.scheduledPlayTimer = null;
    this.driftCheckInterval = null;
    this.currentDriftMs = 0;
  }

  /** Convenience getter for the current audio element (may be null if not yet mounted) */
  get audio() {
    return this.audioRef?.current ?? null;
  }

  /** Convenience getter for the current clock sync service */
  get clockSync() {
    return this.clockSyncRef?.current ?? null;
  }

  /**
   * Calculate current authoritative playback position based on server timeline.
   */
  getAuthoritativePosition(serverTime) {
    if (this.status !== "playing" || !this.startedAtServerTime) {
      return this.authoritativePosition;
    }
    const clockSync = this.clockSync;
    const sTime = serverTime ?? (clockSync ? clockSync.toServerTime() : Date.now());
    if (sTime < this.startedAtServerTime) {
      return this.authoritativePosition;
    }
    const elapsedSec = (sTime - this.startedAtServerTime) / 1000;
    return this.authoritativePosition + elapsedSec;
  }

  /**
   * Handle initial ROOM_STATE or RECONNECT state.
   */
  handleRoomState(playbackState) {
    if (!playbackState) return;
    if (playbackState.revision < this.currentRevision) return;

    this.currentRevision = playbackState.revision;
    this.status = playbackState.status;
    this.authoritativePosition = playbackState.position;
    this.startedAtServerTime = playbackState.startedAtServerTime;

    const audio = this.audio;
    const clockSync = this.clockSync;
    if (!audio) {
      // Audio element not mounted yet; state is stored and will be applied when play is requested
      this._notifyState();
      return;
    }

    if (this.status === "playing" && this.startedAtServerTime && clockSync) {
      const serverNow = clockSync.toServerTime();
      const currentPos = this.getAuthoritativePosition(serverNow);
      audio.currentTime = currentPos;
      this._attemptPlay();
      this._startDriftChecking();
    } else {
      this._clearScheduledPlay();
      this._stopDriftChecking();
      audio.currentTime = this.authoritativePosition;
      audio.pause();
    }

    this._notifyState();
  }

  /**
   * Handle server PLAY event with future executeAt timestamp.
   */
  handlePlay(data) {
    // 1. Revision check
    if (data.revision <= this.currentRevision) {
      console.warn(`[Sync] Stale PLAY revision rejected: ${data.revision} <= ${this.currentRevision}`);
      return;
    }

    this.currentRevision = data.revision;
    this.status = "playing";
    this.authoritativePosition = data.position;
    this.startedAtServerTime = data.executeAt;

    this._clearScheduledPlay();

    const audio = this.audio;
    const clockSync = this.clockSync;
    if (!audio) {
      this._notifyState();
      return;
    }

    // 2. Scheduled Play algorithm per Section 20
    const localExecuteAt = clockSync
      ? this.clockSync.toLocalTime(data.executeAt)
      : data.executeAt; // Fallback: use raw timestamp if clock sync not ready
    const delay = localExecuteAt - Date.now();

    if (delay > 0) {
      // Pre-seek to position and schedule play
      audio.currentTime = data.position;
      this.scheduledPlayTimer = setTimeout(() => {
        this.scheduledPlayTimer = null;
        this._attemptPlay();
        this._startDriftChecking();
      }, delay);
    } else {
      // Message arrived after scheduled time (network delay)
      const elapsedSec = Math.abs(delay) / 1000;
      audio.currentTime = data.position + elapsedSec;
      this._attemptPlay();
      this._startDriftChecking();
    }

    this._notifyState();
  }

  /**
   * Handle server PAUSE event.
   */
  handlePause(data) {
    if (data.revision <= this.currentRevision) {
      console.warn(`[Sync] Stale PAUSE revision rejected: ${data.revision} <= ${this.currentRevision}`);
      return;
    }

    this.currentRevision = data.revision;
    this.status = "paused";
    this.authoritativePosition = data.position;
    this.startedAtServerTime = null;

    this._clearScheduledPlay();
    this._stopDriftChecking();

    const audio = this.audio;
    if (audio) {
      audio.playbackRate = 1.0;
      audio.currentTime = data.position;
      audio.pause();
    }

    this._notifyState();
  }

  /**
   * Handle server SEEK event.
   */
  handleSeek(data) {
    if (data.revision <= this.currentRevision) {
      console.warn(`[Sync] Stale SEEK revision rejected: ${data.revision} <= ${this.currentRevision}`);
      return;
    }

    this.currentRevision = data.revision;
    this.authoritativePosition = data.position;

    const clockSync = this.clockSync;
    if (this.status === "playing" && clockSync) {
      this.startedAtServerTime = clockSync.toServerTime();
    }

    const audio = this.audio;
    if (audio) {
      audio.currentTime = data.position;
    }

    this._notifyState();
  }

  // ─── Host Actions (Sends requests to DO) ──────────────────────

  requestPlay() {
    this.sendMessage({
      type: MESSAGE_TYPES.PLAY_REQUEST,
      requestId: crypto.randomUUID(),
    });
  }

  requestPause() {
    // Immediate local pause for host responsiveness (Section 22)
    const audio = this.audio;
    if (audio) {
      audio.pause();
    }

    this.sendMessage({
      type: MESSAGE_TYPES.PAUSE_REQUEST,
      requestId: crypto.randomUUID(),
    });
  }

  requestSeek(position) {
    this.sendMessage({
      type: MESSAGE_TYPES.SEEK_REQUEST,
      position,
      requestId: crypto.randomUUID(),
    });
  }

  // ─── Drift Detection & Correction (Milestone 10) ──────────────

  _startDriftChecking() {
    this._stopDriftChecking();
    this.driftCheckInterval = setInterval(() => {
      this._checkDrift();
    }, 1500);
  }

  _stopDriftChecking() {
    if (this.driftCheckInterval) {
      clearInterval(this.driftCheckInterval);
      this.driftCheckInterval = null;
    }
    const audio = this.audio;
    if (audio) {
      audio.playbackRate = 1.0;
    }
  }

  _checkDrift() {
    const audio = this.audio;
    const clockSync = this.clockSync;
    if (!audio || this.status !== "playing" || !this.startedAtServerTime || !clockSync) return;

    const serverNow = clockSync.toServerTime();
    if (serverNow < this.startedAtServerTime) return; // Still in pre-roll window

    const expectedPosition = this.getAuthoritativePosition(serverNow);
    const actualPosition = audio.currentTime;
    const driftSec = expectedPosition - actualPosition;
    const driftMs = Math.round(driftSec * 1000);
    this.currentDriftMs = driftMs;

    this.onDriftUpdate({
      driftMs,
      expectedPosition,
      actualPosition,
    });

    const absDrift = Math.abs(driftSec);

    // Section 27 & 28 Drift Policy
    if (absDrift < 0.050) {
      // Within 50ms: nominal playback
      if (audio.playbackRate !== 1.0) {
        audio.playbackRate = 1.0;
      }
    } else if (absDrift >= 0.050 && absDrift < 0.150) {
      // 50ms - 150ms: Gentle rate adjustment
      audio.playbackRate = driftSec > 0 ? 1.02 : 0.98;
    } else {
      // >= 150ms: Hard seek
      console.log(`[Sync] Large drift detected (${driftMs}ms). Hard seeking to ${expectedPosition.toFixed(2)}s`);
      audio.currentTime = expectedPosition;
      audio.playbackRate = 1.0;
    }
  }

  async _attemptPlay() {
    const audio = this.audio;
    if (!audio) return;
    try {
      await audio.play();
      // Play succeeded — clear any autoplay-blocked state so the banner is dismissed.
      this.onAutoplayBlocked(false);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        console.warn("[Sync] Play rejected due to browser autoplay restriction.");
        this.onAutoplayBlocked(true);
      } else {
        console.error("[Sync] Audio play error:", err);
      }
    }
  }

  _clearScheduledPlay() {
    if (this.scheduledPlayTimer) {
      clearTimeout(this.scheduledPlayTimer);
      this.scheduledPlayTimer = null;
    }
  }

  _notifyState() {
    this.onStateChange({
      status: this.status,
      position: this.authoritativePosition,
      revision: this.currentRevision,
    });
  }

  destroy() {
    this._clearScheduledPlay();
    this._stopDriftChecking();
  }
}
