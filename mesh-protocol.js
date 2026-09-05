'use strict';

/**
 * mesh-protocol.js
 *
 * Standardized data layout and routing script for peer-to-peer
 * offline mesh relay (WebRTC and Web Bluetooth).
 */

class MeshPacket {
  constructor({ id, ttl = 3, ts, origin, payload }) {
    // Generate a short random ID if none provided (good enough for local mesh)
    this.id = id || Math.random().toString(36).substring(2, 9);
    this.ttl = ttl;
    this.ts = ts || Date.now();
    // Unique device ID per session
    this.origin = origin || MeshRouter.getLocalNodeId();

    // Rich payload containing the hazard data
    this.payload = payload || {
      text: '',
      severity: 'medium',
      lat: null,
      lon: null,
      tags: []
    };
  }

  // Serialize to JSON string (minified for low bandwidth / QR constraints)
  serialize() {
    return JSON.stringify({
      i: this.id,
      t: this.ttl,
      ts: this.ts,
      o: this.origin,
      p: this.payload
    });
  }

  // Deserialize from minimal JSON format
  static deserialize(jsonString) {
    try {
      const raw = JSON.parse(jsonString);
      return new MeshPacket({
        id: raw.i,
        ttl: raw.t,
        ts: raw.ts,
        origin: raw.o,
        payload: raw.p
      });
    } catch (e) {
      console.error('Failed to parse mesh packet', e);
      return null;
    }
  }
}

class MeshRouter {
  static seenPackets = new Set();
  static localNodeId = Math.random().toString(36).substring(2, 9);

  static getLocalNodeId() {
    return this.localNodeId;
  }

  /**
   * Process an incoming raw string message from WebRTC or Bluetooth.
   * Decrements TTL, checks for duplicates.
   * @param {string} rawString
   * @returns {MeshPacket|null} Returns packet if valid and new, null if duplicate or expired.
   */
  static processIncoming(rawString) {
    // Handle legacy basic alerts just in case
    if (rawString.includes('"type":"alert"')) {
      try {
        const legacy = JSON.parse(rawString);
        return new MeshPacket({
          payload: { text: legacy.text || '', severity: 'medium', tags: [] }
        });
      } catch (e) { }
    }

    const packet = MeshPacket.deserialize(rawString);
    if (!packet) return null;

    // Check if we've already seen this packet (deduplication)
    if (this.seenPackets.has(packet.id)) {
      console.log(`[Mesh] Dropped duplicate packet: ${packet.id}`);
      return null;
    }

    // Remember this packet
    this.seenPackets.add(packet.id);

    // Keep set size manageable
    if (this.seenPackets.size > 500) {
      const first = this.seenPackets.values().next().value;
      this.seenPackets.delete(first);
    }

    // Decrement TTL for rebroadcast purposes
    packet.ttl -= 1;

    console.log(`[Mesh] Processed new packet: ${packet.id}, TTL now ${packet.ttl}`);
    return packet;
  }

  /**
   * Create a new outgoing mesh packet string.
   * @param {Object} payload Rich payload
   * @param {number} ttl Max hops
   * @returns {string} Serialized packet string
   */
  static createOutgoing(payload, ttl = 3) {
    const packet = new MeshPacket({ payload, ttl });
    this.seenPackets.add(packet.id); // Add our own packet so we don't process it if echoed back
    return packet.serialize();
  }
}

// Export for global use
window.MeshPacket = MeshPacket;
window.MeshRouter = MeshRouter;
