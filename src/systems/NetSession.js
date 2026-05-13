/**
 * NetSession — WebSocket signaling + WebRTC DataChannel wrapper.
 *
 * Supports one-to-many connections on the HOST side (up to 3 clients) and
 * a single connection on the CLIENT side.
 *
 * Host usage:
 *   net.host('ABCD');
 *   net.onConnected    = (peerId) => { ... };   // fires per new client
 *   net.onMessage      = (data, peerId) => { }; // fires per message, with sender
 *   net.onDisconnected = (peerId) => { ... };   // fires per dropped client
 *   net.send(obj);            // broadcast to ALL connected clients
 *   net.sendTo(peerId, obj);  // unicast to one client
 *   net.connectedPeerIds();   // → string[]
 *
 * Client usage (unchanged from before):
 *   net.join('ABCD');
 *   net.onConnected    = () => { ... };
 *   net.onMessage      = (data) => { ... };
 *   net.onDisconnected = () => { ... };
 *   net.send(obj);   // sends to host
 *
 * NOTE: Multi-client signal routing requires the signaling server to include
 * a 'from' (or 'peer_id') field in relayed signal messages so the host can
 * match answers/candidates to the correct RTCPeerConnection. With a single
 * client the code falls back to the only known peer, preserving backward compat.
 */

const SIGNAL_URL   = 'wss://play.sw0l1ylab.com/signal';
const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class NetSession {
  constructor() {
    this.role         = null;    // 'host' | 'client'
    this.room         = null;
    this.peerId       = null;    // our signaling peer_id
    this.remotePeerId = null;    // last-connected peer (compat; client: the host)
    this.status       = 'idle'; // idle|connecting|waiting|connected|error|disconnected

    this._ws                = null;
    this._iceServers        = FALLBACK_ICE;

    // Host: one RTCPeerConnection + DataChannel per connected client
    // Map<peerId, { pc, dc, pendingCandidates, wasConnected }>
    this._peers = new Map();

    // Client: single peer (backward compat)
    this._pc                = null;
    this._dc                = null;
    this._pendingCandidates = [];

    // ── Callbacks ─────────────────────────────────────────────────────────────
    // Assign before calling host() / join().
    this.onWaiting      = null;   // host: connected to server, waiting for first peer
    this.onConnected    = null;   // host: (peerId)  client: ()
    this.onMessage      = null;   // (data, peerId?) — peerId present on host side
    this.onDisconnected = null;   // host: (peerId)  client: ()
    this.onError        = null;   // (message, peerId?) — peerId present for DC errors
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  host(room) {
    this.role   = 'host';
    this.room   = room;
    this.status = 'connecting';
    this._openWS(() => this._wsSend({ type: 'hello', role: 'host', room }));
  }

  join(room) {
    this.role   = 'client';
    this.room   = room;
    this.status = 'connecting';
    this._openWS(() => this._wsSend({ type: 'hello', role: 'client', room }));
  }

  /** Broadcast obj to ALL connected peers (host) or send to host (client). */
  send(obj) {
    const str = JSON.stringify(obj);
    let sent  = false;
    for (const { dc } of this._peers.values()) {
      if (dc?.readyState === 'open') {
        try { dc.send(str); sent = true; } catch {}
      }
    }
    // Client path (or host before any multi-peer connections open)
    if (!sent && this._dc?.readyState === 'open') {
      try { this._dc.send(str); } catch {}
    }
  }

  /** Send obj to one specific peer by ID (host only). */
  sendTo(peerId, obj) {
    const peer = this._peers.get(peerId);
    if (peer?.dc?.readyState === 'open') {
      try { peer.dc.send(JSON.stringify(obj)); } catch {}
    }
  }

  /** Returns the peer IDs of all currently-open host connections. */
  connectedPeerIds() {
    return [...this._peers.entries()]
      .filter(([, p]) => p.dc?.readyState === 'open')
      .map(([id]) => id);
  }

  /** Returns total bytes queued to send across all open DataChannels (congestion indicator). */
  getBufferedAmount() {
    let total = 0;
    for (const { dc } of this._peers.values()) {
      if (dc?.readyState === 'open') total += dc.bufferedAmount;
    }
    if (this._dc?.readyState === 'open') total += this._dc.bufferedAmount;
    return total;
  }

  /**
   * Async: returns ICE candidate-pair stats for the first active RTCPeerConnection.
   * { type: 'relay'|'srflx'|'host'|'prflx'|'?', rtt: ms|null }
   * type === 'relay' means all traffic is being routed through a TURN server.
   */
  async getWebRTCStats() {
    const pc = this._pc ?? [...this._peers.values()][0]?.pc;
    if (!pc) return { type: '?', rtt: null };
    try {
      const report = await pc.getStats();
      let pair = null;
      for (const s of report.values()) {
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
          pair = s; break;
        }
      }
      if (!pair) {
        // Fallback: take the highest-priority succeeded pair even if not marked nominated
        for (const s of report.values()) {
          if (s.type === 'candidate-pair' && s.state === 'succeeded') {
            if (!pair || s.priority > pair.priority) pair = s;
          }
        }
      }
      if (!pair) return { type: '?', rtt: null };
      const remote = report.get(pair.remoteCandidateId);
      const type   = remote?.candidateType ?? '?';
      const rtt    = pair.currentRoundTripTime != null
        ? Math.round(pair.currentRoundTripTime * 1000)
        : null;
      return { type, rtt };
    } catch {
      return { type: '?', rtt: null };
    }
  }

  /** Number of currently-open peer connections. */
  get connectedPeerCount() {
    if (this._peers.size > 0)
      return [...this._peers.values()].filter(p => p.dc?.readyState === 'open').length;
    return this._dc?.readyState === 'open' ? 1 : 0;
  }

  close() {
    this.status = 'disconnected';
    for (const { pc, dc } of this._peers.values()) {
      try { dc?.close(); } catch {}
      try { pc?.close(); } catch {}
    }
    this._peers.clear();
    try { this._dc?.close(); } catch {}
    try { this._pc?.close(); } catch {}
    try { this._ws?.close(); } catch {}
    this._dc = this._pc = this._ws = null;
  }

  // ── WebSocket / Signaling ─────────────────────────────────────────────────

  _openWS(onOpen) {
    let ws;
    try { ws = new WebSocket(SIGNAL_URL); } catch {
      this._fail('Could not connect to signaling server');
      return;
    }
    this._ws    = ws;
    ws.onopen   = onOpen;
    ws.onmessage = (ev) => {
      try { this._onSignal(JSON.parse(ev.data)); } catch {}
    };
    ws.onerror = () => this._fail('Signaling server unreachable');
    ws.onclose = () => {
      // While waiting for the first peer the WS is critical; after that the
      // DataChannel carries the game and a WS drop is non-fatal.
      if (this.status === 'connecting' || this.status === 'waiting') {
        this._fail('Lost connection to signaling server');
      }
    };
  }

  _wsSend(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  // ── Signaling message handler ─────────────────────────────────────────────

  async _onSignal(msg) {
    switch (msg.type) {

      case 'welcome': {
        this.peerId      = msg.peer_id;
        this._iceServers = msg.ice_servers?.length ? msg.ice_servers : FALLBACK_ICE;
        if (this.role === 'host') {
          this.status = 'waiting';
          this.onWaiting?.();
        } else {
          if (msg.host_peer_id) this.remotePeerId = msg.host_peer_id;
          this._setupClientPeer();
        }
        break;
      }

      case 'peer_joined': {
        // Host: a new client has joined the room — create a dedicated peer connection.
        const peerId = msg.peer_id;
        const peer   = this._makeHostPeer(peerId);
        const offer  = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        this._wsSend({ type: 'signal', target: peerId, payload: peer.pc.localDescription.toJSON() });
        break;
      }

      case 'signal': {
        const payload = msg.payload;
        // 'from' identifies the sender in relay-style signaling servers.
        // Falls back to 'peer_id' for servers that use that field name instead.
        const from = msg.from ?? msg.peer_id;

        if (this.role === 'host') {
          // Route to the correct peer connection.
          // If 'from' is absent and there is only one peer, use it as a fallback so
          // existing single-client sessions still work with servers that omit 'from'.
          let peer = from ? this._peers.get(from) : null;
          if (!peer && this._peers.size === 1) {
            peer = this._peers.values().next().value;
          }
          if (!peer) break;

          if (payload.type === 'answer') {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(payload));
            for (const c of peer.pendingCandidates) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            peer.pendingCandidates = [];
          } else if ('candidate' in payload) {
            if (peer.pc.remoteDescription) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(payload)).catch(() => {});
            } else {
              peer.pendingCandidates.push(payload);
            }
          }

        } else {
          // Client: single peer path (unchanged)
          if (!this._pc) break;
          if (payload.type === 'offer') {
            await this._pc.setRemoteDescription(new RTCSessionDescription(payload));
            await this._flushPendingCandidates();
            const answer = await this._pc.createAnswer();
            await this._pc.setLocalDescription(answer);
            this._wsSend({ type: 'signal', target: this.remotePeerId, payload: this._pc.localDescription.toJSON() });
          } else if (payload.type === 'answer') {
            await this._pc.setRemoteDescription(new RTCSessionDescription(payload));
            await this._flushPendingCandidates();
          } else if ('candidate' in payload) {
            if (this._pc.remoteDescription) {
              await this._pc.addIceCandidate(new RTCIceCandidate(payload)).catch(() => {});
            } else {
              this._pendingCandidates.push(payload);
            }
          }
        }
        break;
      }

      case 'host_left':
      case 'peer_left': {
        if (this.role === 'client') {
          if (this.status === 'connected' || this.status === 'connecting') {
            this.status = 'disconnected';
            this.onDisconnected?.();
          }
        }
        // Host: individual peer drops are handled by dc.onclose
        break;
      }

      case 'error':
        this._fail(msg.message ?? 'Server error');
        break;
    }
  }

  // ── Host peer creation ────────────────────────────────────────────────────

  _makeHostPeer(peerId) {
    const pc                = new RTCPeerConnection({ iceServers: this._iceServers });
    const pendingCandidates = [];

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._wsSend({ type: 'signal', target: peerId, payload: e.candidate.toJSON() });
      }
    };

    const dc   = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
    const peer = { pc, dc, pendingCandidates, wasConnected: false };
    this._peers.set(peerId, peer);

    dc.onopen = () => {
      peer.wasConnected = true;
      if (this.status !== 'connected') this.status = 'connected';
      this.remotePeerId = peerId;   // compat: tracks last-connected peer
      this.onConnected?.(peerId);
    };
    dc.onmessage = (ev) => {
      try { this.onMessage?.(JSON.parse(ev.data), peerId); } catch {}
    };
    dc.onclose = () => {
      this._peers.delete(peerId);
      if (peer.wasConnected) this.onDisconnected?.(peerId);
    };
    dc.onerror = () => {
      if (peer.wasConnected) this.onError?.('DataChannel error', peerId);
    };

    return peer;
  }

  // ── Client peer setup ─────────────────────────────────────────────────────

  _setupClientPeer() {
    this._pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this._pc.onicecandidate = (e) => {
      if (e.candidate && this.remotePeerId) {
        this._wsSend({ type: 'signal', target: this.remotePeerId, payload: e.candidate.toJSON() });
      }
    };
    this._pc.ondatachannel = (e) => {
      this._dc = e.channel;
      this._setupClientDC(this._dc);
    };
  }

  _setupClientDC(dc) {
    dc.onopen = () => {
      this.status = 'connected';
      this.onConnected?.();
    };
    dc.onmessage = (ev) => {
      try { this.onMessage?.(JSON.parse(ev.data)); } catch {}
    };
    dc.onclose = () => {
      if (this.status === 'connected' || this.status === 'error') {
        this.status = 'disconnected';
        this.onDisconnected?.();
      }
    };
    dc.onerror = () => {
      if (this.status === 'connected') {
        this.status = 'error';
        this.onError?.('DataChannel error');
      }
    };
  }

  async _flushPendingCandidates() {
    for (const c of this._pendingCandidates) {
      await this._pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    this._pendingCandidates = [];
  }

  _fail(msg) {
    if (this.status === 'error' || this.status === 'disconnected') return;
    this.status = 'error';
    this.onError?.(msg);
  }
}
