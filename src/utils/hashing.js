/**
 * Cryptographic hashing utility using standard Web Crypto API.
 */

/**
 * Compute SHA-256 hash of an ArrayBuffer or Uint8Array.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<string>} Hexadecimal SHA-256 string
 */
export async function computeSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
