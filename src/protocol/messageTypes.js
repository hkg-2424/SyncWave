/**
 * Protocol definitions for SyncWave WebSocket and DataChannel communications.
 * Centralized to avoid arbitrary strings throughout the application.
 */

export const MESSAGE_TYPES = {
  // Room membership
  JOIN_ROOM: "JOIN_ROOM",
  ROOM_STATE: "ROOM_STATE",
  USER_JOINED: "USER_JOINED",
  USER_LEFT: "USER_LEFT",
  HOST_CHANGED: "HOST_CHANGED",

  // Authoritative playback commands
  PLAY_REQUEST: "PLAY_REQUEST",
  PAUSE_REQUEST: "PAUSE_REQUEST",
  SEEK_REQUEST: "SEEK_REQUEST",
  PLAY: "PLAY",
  PAUSE: "PAUSE",
  SEEK: "SEEK",

  // Clock synchronization
  CLOCK_SYNC_REQUEST: "CLOCK_SYNC_REQUEST",
  CLOCK_SYNC_RESPONSE: "CLOCK_SYNC_RESPONSE",

  // Track state
  TRACK_METADATA: "TRACK_METADATA",
  TRACK_READY: "TRACK_READY",

  // WebRTC signaling
  OFFER: "OFFER",
  ANSWER: "ANSWER",
  ICE_CANDIDATE: "ICE_CANDIDATE",

  // Errors
  ERROR: "ERROR",
};

export const DATA_CHANNEL_MESSAGES = {
  FILE_START: "FILE_START",
  FILE_COMPLETE: "FILE_COMPLETE",
  FILE_ACK: "FILE_ACK",
  PING: "PING",
  PONG: "PONG",
};

export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export const DATA_CHANNEL_NAME = "audio-transfer";
