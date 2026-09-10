/**
 * File and playback validation utilities.
 */

export const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per Section 12

export const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/vorbis",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
  "audio/flac",
];

export const ALLOWED_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".webm",
  ".flac",
];

/**
 * Validate an audio file for type and size constraints.
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAudioFile(file) {
  if (!file) {
    return { valid: false, error: "No file selected." };
  }

  if (file.size > MAX_AUDIO_FILE_SIZE) {
    return {
      valid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit of 100 MB.`,
    };
  }

  const hasAllowedMime = ALLOWED_AUDIO_TYPES.includes(file.type.toLowerCase());
  const fileNameLower = file.name.toLowerCase();
  const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => fileNameLower.endsWith(ext));

  if (!hasAllowedMime && !hasAllowedExt) {
    return {
      valid: false,
      error: "Unsupported file format. Please upload an MP3, WAV, OGG, M4A, AAC, or WebM audio file.",
    };
  }

  return { valid: true };
}
