import { computeSHA256 } from "../utils/hashing.js";
import { DATA_CHANNEL_MESSAGES } from "../protocol/messageTypes.js";

export const CHUNK_SIZE = 64 * 1024; // 64 KB per Section 15
const HIGH_WATER_MARK = 1024 * 1024; // 1 MB buffer limit before pausing
const LOW_WATER_THRESHOLD = 256 * 1024; // 256 KB threshold to resume sending

/**
 * FileSender — handles chunking, backpressure, and progress for sending files over WebRTC DataChannel.
 */
export class FileSender {
  /**
   * Send a file or Blob over an RTCDataChannel with backpressure.
   * @param {RTCDataChannel} dataChannel
   * @param {File | Blob} file
   * @param {object} metadata - { fileName, mimeType, sha256, duration }
   * @param {Function} onProgress - ({ bytesSent, totalBytes, progress }) => void
   */
  static async sendFile(dataChannel, file, metadata, onProgress) {
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("DataChannel is not open for transfer");
    }

    dataChannel.bufferedAmountLowThreshold = LOW_WATER_THRESHOLD;

    const transferId = crypto.randomUUID();
    const totalSize = file.size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    // 1. Send FILE_START control message
    dataChannel.send(
      JSON.stringify({
        type: DATA_CHANNEL_MESSAGES.FILE_START,
        transferId,
        fileName: metadata.fileName || file.name,
        mimeType: metadata.mimeType || file.type || "audio/mpeg",
        size: totalSize,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        sha256: metadata.sha256,
        duration: metadata.duration || 0,
      })
    );

    const arrayBuffer = await file.arrayBuffer();
    let offset = 0;

    // 2. Stream binary chunks with backpressure
    while (offset < totalSize) {
      if (dataChannel.readyState !== "open") {
        throw new Error("DataChannel closed unexpectedly during file transfer");
      }

      // Check backpressure
      if (dataChannel.bufferedAmount > HIGH_WATER_MARK) {
        await new Promise((resolve) => {
          const handler = () => {
            dataChannel.removeEventListener("bufferedamountlow", handler);
            resolve();
          };
          dataChannel.addEventListener("bufferedamountlow", handler);
        });
      }

      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      dataChannel.send(chunk);
      offset += chunk.byteLength;

      if (onProgress) {
        const progress = Math.min(100, Math.round((offset / totalSize) * 100));
        onProgress({
          bytesSent: offset,
          totalBytes: totalSize,
          progress,
        });
      }
    }

    // 3. Send FILE_COMPLETE control message
    dataChannel.send(
      JSON.stringify({
        type: DATA_CHANNEL_MESSAGES.FILE_COMPLETE,
        transferId,
      })
    );
  }
}

/**
 * FileReceiver — accumulates chunks, reconstructs Blob, and verifies SHA-256 integrity.
 */
export class FileReceiver {
  constructor({ onProgress, onVerified, onError }) {
    this.onProgress = onProgress || (() => {});
    this.onVerified = onVerified || (() => {});
    this.onError = onError || (() => {});

    this.currentTransfer = null;
  }

  /**
   * Feed a message received from the DataChannel (either string JSON or ArrayBuffer chunk).
   *
   * BUG FIX: Some browsers deliver DataChannel binary messages as Blob even when
   * binaryType is set to "arraybuffer". We normalize here to ensure consistent handling.
   */
  async handleDataMessage(data) {
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.type === DATA_CHANNEL_MESSAGES.FILE_START) {
          this._handleFileStart(msg);
        } else if (msg.type === DATA_CHANNEL_MESSAGES.FILE_COMPLETE) {
          await this._handleFileComplete(msg);
        }
      } catch (err) {
        console.error("[FileReceiver] Error processing text message:", err);
      }
      return;
    }

    // Normalize Blob to ArrayBuffer (some browsers ignore binaryType="arraybuffer")
    if (data instanceof Blob) {
      try {
        const buffer = await data.arrayBuffer();
        this._handleBinaryChunk(buffer);
      } catch (err) {
        console.error("[FileReceiver] Failed to convert Blob to ArrayBuffer:", err);
      }
      return;
    }

    // Binary chunk (ArrayBuffer)
    if (data instanceof ArrayBuffer) {
      this._handleBinaryChunk(data);
    }
  }

  _handleFileStart(msg) {
    this.currentTransfer = {
      transferId: msg.transferId,
      fileName: msg.fileName,
      mimeType: msg.mimeType,
      size: msg.size,
      totalChunks: msg.totalChunks,
      expectedSha256: msg.sha256,
      duration: msg.duration || 0,
      chunks: [],
      bytesReceived: 0,
    };

    this.onProgress({
      bytesReceived: 0,
      totalBytes: msg.size,
      progress: 0,
      fileName: msg.fileName,
    });
  }

  _handleBinaryChunk(chunk) {
    if (!this.currentTransfer) return;

    this.currentTransfer.chunks.push(chunk);
    this.currentTransfer.bytesReceived += chunk.byteLength;

    const progress = Math.min(
      100,
      Math.round(
        (this.currentTransfer.bytesReceived / this.currentTransfer.size) * 100
      )
    );

    this.onProgress({
      bytesReceived: this.currentTransfer.bytesReceived,
      totalBytes: this.currentTransfer.size,
      progress,
      fileName: this.currentTransfer.fileName,
    });
  }

  async _handleFileComplete(msg) {
    if (!this.currentTransfer || this.currentTransfer.transferId !== msg.transferId) {
      return;
    }

    const { chunks, mimeType, expectedSha256, fileName, duration, size } =
      this.currentTransfer;

    try {
      // 1. Reconstruct Blob
      const blob = new Blob(chunks, { type: mimeType });
      const buffer = await blob.arrayBuffer();

      // 2. Compute and verify SHA-256
      const actualSha256 = await computeSHA256(buffer);

      if (actualSha256 !== expectedSha256) {
        const err = new Error(
          `SHA-256 verification failed! Expected ${expectedSha256}, got ${actualSha256}`
        );
        this.onError(err);
        this.currentTransfer = null;
        return;
      }

      // 3. Create audio URL
      const audioUrl = URL.createObjectURL(blob);

      this.onVerified({
        blob,
        audioUrl,
        trackInfo: {
          fileName,
          mimeType,
          size,
          sha256: actualSha256,
          duration,
        },
      });

      this.currentTransfer = null;
    } catch (err) {
      this.onError(err);
      this.currentTransfer = null;
    }
  }

  reset() {
    this.currentTransfer = null;
  }
}
