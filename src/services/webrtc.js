import { RTC_CONFIG, DATA_CHANNEL_NAME, MESSAGE_TYPES } from "../protocol/messageTypes.js";

/**
 * WebRTCManager — coordinates RTCPeerConnection and RTCDataChannel instances.
 *
 * Designed for a star/mesh peer architecture:
 * In SyncWave, the Host initiates connections to all joining Guests to transfer audio.
 * The DataChannel ("audio-transfer") is bidirectional and reliable (ordered: true).
 */
export class WebRTCManager {
  constructor({ localUserId, onSignalingMessage, onPeerStateChange, onDataMessage }) {
    this.localUserId = localUserId;
    this.onSignalingMessage = onSignalingMessage || (() => {});
    this.onPeerStateChange = onPeerStateChange || (() => {});
    this.onDataMessage = onDataMessage || (() => {});

    // Map of userId -> { pc, dc, iceQueue: [], dcState: "closed", connectionState: "new" }
    this.peers = new Map();
  }

  /**
   * Get or create a peer record for a remote user.
   */
  _getOrCreatePeer(remoteUserId) {
    if (this.peers.has(remoteUserId)) {
      return this.peers.get(remoteUserId);
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer = {
      remoteUserId,
      pc,
      dc: null,
      iceQueue: [],
      dcState: "closed",
      connectionState: "new",
      iceConnectionState: "new",
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignalingMessage({
          type: MESSAGE_TYPES.ICE_CANDIDATE,
          targetUserId: remoteUserId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      peer.connectionState = pc.connectionState;
      this._notifyStateChange(peer);

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(remoteUserId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      peer.iceConnectionState = pc.iceConnectionState;
      this._notifyStateChange(peer);
    };

    this.peers.set(remoteUserId, peer);
    return peer;
  }

  /**
   * Bind event handlers to an RTCDataChannel.
   */
  _bindDataChannel(peer, dc) {
    peer.dc = dc;
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
      peer.dcState = "open";
      this._notifyStateChange(peer);
    };

    dc.onclose = () => {
      peer.dcState = "closed";
      this._notifyStateChange(peer);
    };

    dc.onerror = (err) => {
      console.error(`[WebRTC DC Error with ${peer.remoteUserId}]:`, err);
      peer.dcState = "error";
      this._notifyStateChange(peer);
    };

    dc.onmessage = (event) => {
      this.onDataMessage(peer.remoteUserId, event.data);
    };
  }

  _notifyStateChange(peer) {
    this.onPeerStateChange(peer.remoteUserId, {
      connectionState: peer.pc.connectionState,
      iceConnectionState: peer.pc.iceConnectionState,
      dataChannelState: peer.dcState,
    });
  }

  /**
   * Drain any queued ICE candidates once remote description is set.
   */
  async _drainIceQueue(peer) {
    while (peer.iceQueue.length > 0) {
      const candidate = peer.iceQueue.shift();
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[WebRTC] Failed to add queued ICE candidate:`, err);
      }
    }
  }

  /**
   * Check if an active connection exists for a peer.
   */
  isPeerActive(remoteUserId) {
    const peer = this.peers.get(remoteUserId);
    if (!peer) return false;
    const state = peer.pc?.connectionState;
    return state === "new" || state === "connecting" || state === "connected";
  }

  /**
   * Host / Caller: Initiate connection and create DataChannel.
   */
  async initiateConnection(targetUserId) {
    if (!targetUserId || targetUserId === this.localUserId) return;
    if (this.isPeerActive(targetUserId)) return;

    // Reset any existing closed/failed connection to this peer
    this.closePeer(targetUserId);

    const peer = this._getOrCreatePeer(targetUserId);

    // Create DataChannel on offerer side
    const dc = peer.pc.createDataChannel(DATA_CHANNEL_NAME, { ordered: true });
    this._bindDataChannel(peer, dc);

    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);

      this.onSignalingMessage({
        type: MESSAGE_TYPES.OFFER,
        targetUserId,
        sdp: peer.pc.localDescription,
      });
    } catch (err) {
      console.error(`[WebRTC] Failed to create offer for ${targetUserId}:`, err);
    }
  }

  /**
   * Guest / Callee: Handle SDP offer from remote user.
   */
  async handleOffer(fromUserId, sdp) {
    if (!fromUserId || fromUserId === this.localUserId) return;

    // If existing connection exists and is connected/connecting, recreate
    this.closePeer(fromUserId);

    const peer = this._getOrCreatePeer(fromUserId);

    // Setup listener for incoming data channel
    peer.pc.ondatachannel = (event) => {
      if (event.channel.label === DATA_CHANNEL_NAME) {
        this._bindDataChannel(peer, event.channel);
      }
    };

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this._drainIceQueue(peer);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);

      this.onSignalingMessage({
        type: MESSAGE_TYPES.ANSWER,
        targetUserId: fromUserId,
        sdp: peer.pc.localDescription,
      });
    } catch (err) {
      console.error(`[WebRTC] Failed to handle offer from ${fromUserId}:`, err);
    }
  }

  /**
   * Host / Caller: Handle SDP answer from remote user.
   */
  async handleAnswer(fromUserId, sdp) {
    const peer = this.peers.get(fromUserId);
    if (!peer) {
      console.warn(`[WebRTC] Received answer from unknown peer ${fromUserId}`);
      return;
    }

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this._drainIceQueue(peer);
    } catch (err) {
      console.error(`[WebRTC] Failed to handle answer from ${fromUserId}:`, err);
    }
  }

  /**
   * Handle ICE candidate from remote user.
   */
  async handleIceCandidate(fromUserId, candidate) {
    const peer = this.peers.get(fromUserId) || this._getOrCreatePeer(fromUserId);

    if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[WebRTC] Failed to add ICE candidate from ${fromUserId}:`, err);
      }
    } else {
      // Queue until remote description is set
      peer.iceQueue.push(candidate);
    }
  }

  /**
   * Send data through the DataChannel to a specific peer.
   * Handles string or ArrayBuffer/Uint8Array.
   */
  sendData(targetUserId, data) {
    const peer = this.peers.get(targetUserId);
    if (!peer || !peer.dc || peer.dc.readyState !== "open") {
      throw new Error(`DataChannel to peer ${targetUserId} is not open`);
    }
    peer.dc.send(data);
  }

  /**
   * Broadcast data through all open DataChannels.
   */
  broadcastData(data) {
    for (const [userId, peer] of this.peers) {
      if (peer.dc && peer.dc.readyState === "open") {
        try {
          peer.dc.send(data);
        } catch (err) {
          console.warn(`[WebRTC] Failed to send data to ${userId}:`, err);
        }
      }
    }
  }

  /**
   * Get the primary connected peer's status (or aggregated status).
   */
  getPeerStatus(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return { connectionState: "disconnected", dataChannelState: "closed" };
    return {
      connectionState: peer.connectionState,
      iceConnectionState: peer.iceConnectionState,
      dataChannelState: peer.dcState,
    };
  }

  /**
   * Check if at least one peer has an open DataChannel.
   */
  hasOpenDataChannel() {
    for (const peer of this.peers.values()) {
      if (peer.dc && peer.dc.readyState === "open") return true;
    }
    return false;
  }

  /**
   * Close connection to a specific peer.
   */
  closePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;

    if (peer.dc) {
      try { peer.dc.close(); } catch {}
    }
    if (peer.pc) {
      try { peer.pc.close(); } catch {}
    }

    this.peers.delete(userId);
    this.onPeerStateChange(userId, {
      connectionState: "closed",
      iceConnectionState: "closed",
      dataChannelState: "closed",
    });
  }

  /**
   * Close all peer connections.
   */
  closeAll() {
    for (const userId of Array.from(this.peers.keys())) {
      this.closePeer(userId);
    }
  }
}
