import { useEffect, useRef, useState, useCallback } from "react";
import { WebRTCManager } from "../services/webrtc.js";
import { MESSAGE_TYPES } from "../protocol/messageTypes.js";

/**
 * useWebRTC — Hook managing WebRTC peer connections and DataChannels.
 *
 * In SyncWave, the Host initiates WebRTC connections to all guests in the room.
 * The resulting DataChannel is used for peer-to-peer audio file transfer.
 *
 * BUG FIX: Previously returned `webrtcManager: webrtcRef.current` directly from
 * the hook's render return. On the first render (and any render before the
 * useEffect has run), `webrtcRef.current` is null. This caused `handleHostFileReady`
 * in RoomPage to capture a stale null value in its closure, meaning the host
 * could never find DataChannel peers to send the file to.
 *
 * Fix: Return `webrtcRef` (the stable ref object). Callers access `.current`
 * to always get the live WebRTCManager instance.
 */
export function useWebRTC({
  localUserId,
  isHost,
  users,
  sendMessage,
  onDataMessage,
}) {
  const [peerStates, setPeerStates] = useState({});
  const webrtcRef = useRef(null);
  const onDataMessageRef = useRef(onDataMessage);
  onDataMessageRef.current = onDataMessage;

  // Initialize WebRTCManager
  useEffect(() => {
    if (!localUserId) return;

    const manager = new WebRTCManager({
      localUserId,
      onSignalingMessage: (msg) => {
        if (sendMessage) {
          sendMessage(msg);
        }
      },
      onPeerStateChange: (remoteUserId, state) => {
        setPeerStates((prev) => ({
          ...prev,
          [remoteUserId]: state,
        }));
      },
      onDataMessage: (fromUserId, data) => {
        if (onDataMessageRef.current) {
          onDataMessageRef.current(fromUserId, data);
        }
      },
    });

    webrtcRef.current = manager;

    return () => {
      manager.closeAll();
      webrtcRef.current = null;
    };
  }, [localUserId, sendMessage]);

  // Host initiates WebRTC connection to any guest that doesn't have an active connection
  useEffect(() => {
    if (!isHost || !webrtcRef.current) return;

    const otherUsers = users.filter((u) => u.userId !== localUserId);
    for (const user of otherUsers) {
      if (!webrtcRef.current.isPeerActive(user.userId)) {
        webrtcRef.current.initiateConnection(user.userId);
      }
    }

    // Clean up connections for users who left
    for (const connectedUserId of Array.from(webrtcRef.current.peers.keys())) {
      if (!users.some((u) => u.userId === connectedUserId)) {
        webrtcRef.current.closePeer(connectedUserId);
        setPeerStates((prev) => {
          const next = { ...prev };
          delete next[connectedUserId];
          return next;
        });
      }
    }
  }, [isHost, users, localUserId]);

  // Handle incoming signaling messages from WebSocket
  const handleSignalingMessage = useCallback(async (data) => {
    if (!webrtcRef.current) return;

    switch (data.type) {
      case MESSAGE_TYPES.OFFER:
        await webrtcRef.current.handleOffer(data.fromUserId, data.sdp);
        break;

      case MESSAGE_TYPES.ANSWER:
        await webrtcRef.current.handleAnswer(data.fromUserId, data.sdp);
        break;

      case MESSAGE_TYPES.ICE_CANDIDATE:
        await webrtcRef.current.handleIceCandidate(data.fromUserId, data.candidate);
        break;

      default:
        break;
    }
  }, []);

  const sendData = useCallback((targetUserId, data) => {
    if (webrtcRef.current) {
      webrtcRef.current.sendData(targetUserId, data);
    }
  }, []);

  const broadcastData = useCallback((data) => {
    if (webrtcRef.current) {
      webrtcRef.current.broadcastData(data);
    }
  }, []);

  // Compute overall peer connection status for UI display
  const peerList = Object.values(peerStates);
  let overallPeerStatus = "disconnected";
  if (peerList.length > 0) {
    if (peerList.some((p) => p.dataChannelState === "open")) {
      overallPeerStatus = "connected";
    } else if (
      peerList.some(
        (p) =>
          p.connectionState === "connecting" ||
          p.iceConnectionState === "checking"
      )
    ) {
      overallPeerStatus = "connecting";
    }
  }

  return {
    peerStates,
    overallPeerStatus,
    handleSignalingMessage,
    sendData,
    broadcastData,
    // Return the stable ref object, not .current — callers use .current for the live manager
    webrtcRef,
  };
}
