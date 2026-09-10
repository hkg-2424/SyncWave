import { MESSAGE_TYPES } from "../protocol/messageTypes.js";

/**
 * ClockSyncService — NTP-like 4-timestamp clock synchronization.
 *
 * Estimates offset between client local clock and server clock:
 *   estimatedServerTime = localTime + offset
 *   localTime = serverTime - offset
 */
export class ClockSyncService {
  constructor({ sendMessage, onSyncUpdate }) {
    this.sendMessage = sendMessage;
    this.onSyncUpdate = onSyncUpdate || (() => {});

    this.samples = []; // Array of { offset, rtt, timestamp }
    this.maxSamples = 10;
    this.offset = 0; // ms: serverNow - clientNow
    this.rtt = 0; // ms round-trip time
    this.timer = null;
    this.isSyncing = false;
  }

  /**
   * Send a single sync request to the server.
   */
  requestSync() {
    if (!this.sendMessage) return;
    const clientSendTime = Date.now();
    this.sendMessage({
      type: MESSAGE_TYPES.CLOCK_SYNC_REQUEST,
      clientSendTime,
    });
  }

  /**
   * Process a CLOCK_SYNC_RESPONSE from the server.
   */
  handleResponse(data) {
    const t1 = data.clientSendTime;
    const t2 = data.serverReceiveTime;
    const t3 = data.serverSendTime;
    const t4 = Date.now();

    const rtt = Math.max(0, t4 - t1 - (t3 - t2));
    const offset = Math.round(((t2 - t1) + (t3 - t4)) / 2);

    this.samples.push({ offset, rtt, timestamp: t4 });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Outlier rejection: select sample with lowest RTT
    const bestSample = [...this.samples].sort((a, b) => a.rtt - b.rtt)[0];
    this.offset = bestSample.offset;
    this.rtt = bestSample.rtt;

    this.onSyncUpdate({
      offset: this.offset,
      rtt: this.rtt,
      sampleCount: this.samples.length,
    });
  }

  /**
   * Start periodic synchronization (burst on start, then regular interval).
   */
  start() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    // Initial burst of 3 samples for fast convergence
    this.requestSync();
    setTimeout(() => this.requestSync(), 500);
    setTimeout(() => this.requestSync(), 1200);

    // Periodic interval every 5 seconds
    this.timer = setInterval(() => {
      this.requestSync();
    }, 5000);
  }

  stop() {
    this.isSyncing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Convert a server timestamp to a local client timestamp.
   */
  toLocalTime(serverTimestamp) {
    return serverTimestamp - this.offset;
  }

  /**
   * Convert a local client timestamp to server timestamp.
   */
  toServerTime(localTimestamp = Date.now()) {
    return localTimestamp + this.offset;
  }
}
