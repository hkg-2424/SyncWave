/**
 * SyncWave Worker — Backend entry point.
 *
 * This Worker handles:
 *   1. POST /api/room/create — Generate a new room ID and return it
 *   2. GET  /api/room/:roomId/ws — Upgrade to WebSocket, forward to the RoomDO
 *   3. All other requests — Fall through to static assets (the React SPA)
 *
 * The Worker itself is stateless. All room state lives in Durable Objects.
 */

// Re-export the Durable Object class so Cloudflare's runtime can find it.
// This is required — the class must be exported from the Worker entry point.
export { RoomDO } from "./room.js";

/**
 * Generate a cryptographically random room ID.
 * Uses 4 bytes of randomness → 8 hex chars → ~4 billion possible rooms.
 * This avoids sequential/guessable IDs.
 */
function generateRoomId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── API Routes ───────────────────────────────────────────────

    // POST /api/room/create → create a new room, return { roomId }
    if (url.pathname === "/api/room/create" && request.method === "POST") {
      const roomId = generateRoomId();
      return Response.json({ roomId }, { status: 201 });
    }

    // GET /api/room/:roomId/ws → WebSocket upgrade, forwarded to RoomDO
    const wsMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)\/ws$/);
    if (wsMatch) {
      const roomId = wsMatch[1].toUpperCase();

      // Get a deterministic Durable Object ID from the room ID.
      // All requests for room "ABC123" go to the same DO instance.
      const doId = env.ROOMS.idFromName(roomId);
      const roomStub = env.ROOMS.get(doId);

      // Forward the request to the Durable Object.
      // The DO will handle the WebSocket upgrade.
      return roomStub.fetch(request);
    }

    // ── Static Assets (React SPA) ────────────────────────────────

    // For all other routes, serve the frontend.
    // The `ASSETS` binding is configured in wrangler.jsonc with
    // not_found_handling: "single-page-application", so routes like
    // /room/ABC123 will serve index.html and let React Router handle it.
    return env.ASSETS.fetch(request);
  },
};
