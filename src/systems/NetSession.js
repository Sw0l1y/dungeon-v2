/**
 * NetSession — WebSocket signaling + WebRTC DataChannel wrapper.
 *
 * Usage:
 *   const net = new NetSession();
 *   net.onConnected    = () => { ... };
 *   net.onMessage      = (data) => { ... };
 *   net.onDisconnected = () => { ... };
 *   net.onError        = (msg) => { ... };
 *   net.host('ABCD');   // or net.join('ABCD');
 *   net.send({ t: 'gs', ... });
 */

const SIGNAL_URL  = 'wss://play.sw0l1ylab.com/signal';
const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class NetSession {
  constructor() {
    this.role         = null;    // 'host' | 'client'
    this.room         = null;
    this.peerId       = null;    // our peer_id from signaling server
    this.remotePeerId = null;
    this.status       = 'idle'; // idle|connecting|waiting|connected|error|disconnected

    this._ws                = null;
    this._pc                = null;
    this._dc                = null;
    this._iceServers        = FALLBACK_ICE;
    this._pendingCandidates = [];

    // Callbacks — assign before calling host() / join()
    this.onWaiting      = null;   // host: connected to server, waiting for peer
    this.onConnected    = null;   // DataChannel open — game can start
    this.onMessage      = null;   // (data: object) reliable game packet received
    this.onDisconnected = null;   // remote peer dropped
    this.onError        = null;   // (message: string)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  host(room) {
    this.role   = 'host';
    this.room   = room;
    this.status = 'connecting';
    this._openWS(() => {
      this._wsSend({ type: 'hello', role: 'host', room });
    });
  }

  join(room) {
    this.role   = 'client';
    this.room   = room;
    this.status = 'connecting';
    this._openWS(() => {
      this._wsSend({ type: 'hello', role: 'client', room });
    });
  }

  send(obj) {
    if (this._dc?.readyState === 'open') {
      try { this._dc.send(JSON.stringify(obj)); } catch { /* ignore send errors */ }
    }
  }

  close() {
    const prev = this.status;
    this.status = 'disconnected';
    try { this._dc?.close(); } catch {}
    try { this._pc?.close(); } catch {}
    try { this._ws?.close(); } catch {}
    this._dc = this._pc = this._ws = null;
    if (prev === 'connected') this.onDisconnected?.();
  }

  // ── WebSocket / Signaling ──────────────────────────────────────────────────

  _openWS(onOpen) {
    let ws;
    try { ws = new WebSocket(SIGNAL_URL); } catch {
      this._fail('Could not connect to signaling server');
      return;
    }
    this._ws = ws;
    ws.onopen    = onOpen;
    ws.onmessage = (ev) => {
      try { this._onSignal(JSON.parse(ev.data)); } catch {}
    };
    ws.onerror = () => this._fail('Signaling server unreachable');
    ws.onclose = () => {
      if (this.status === 'connected') {
        this.status = 'disconnected';
        this.onDisconnected?.();
      } else if (this.status !== 'idle' && this.status !== 'disconnected') {
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
          // RTCPeerConnection created later when peer_joined arrives
        } else {
          // Client learns host's peer ID from welcome
          if (msg.host_peer_id) this.remotePeerId = msg.host_peer_id;
          // Set up peer connection — host will send offer shortly
          this._setupPeer();
        }
        break;
      }

      case 'peer_joined': {
        // Host side: a client has joined our room
        this.remotePeerId = msg.peer_id;
        this._setupPeer();

        // Host creates DataChannel and sends offer
        this._dc = this._pc.createDataChannel('game', {
          ordered:         false,
          maxRetransmits:  0,   // unreliable for low-latency game packets
        });
        this._setupDC(this._dc);

        const offer = await this._pc.createOffer();
        await this._pc.setLocalDescription(offer);
        this._wsSend({
          type:    'signal',
          target:  this.remotePeerId,
          payload: this._pc.localDescription.toJSON(),
        });
        break;
      }

      case 'signal': {
        const { payload } = msg;
        if (!this._pc) break;   // shouldn't happen but guard

        if (payload.type === 'offer') {
          await this._pc.setRemoteDescription(new RTCSessionDescription(payload));
          await this._flushPendingCandidates();
          const answer = await this._pc.createAnswer();
          await this._pc.setLocalDescription(answer);
          this._wsSend({
            type:    'signal',
            target:  this.remotePeerId,
            payload: this._pc.localDescription.toJSON(),
          });

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
        break;
      }

      case 'host_left':
      case 'peer_left': {
        if (this.status === 'connected') {
          this.status = 'disconnected';
          this.onDisconnected?.();
        } else if (this.status === 'waiting' || this.status === 'connecting') {
          this._fail('Peer left before connecting');
        }
        break;
      }

      case 'error':
        this._fail(msg.message ?? 'Server error');
        break;
    }
  }

  // ── WebRTC ─────────────────────────────────────────────────────────────────

  _setupPeer() {
    this._pc = new RTCPeerConnection({ iceServers: this._iceServers });

    this._pc.onicecandidate = (e) => {
      if (e.candidate && this.remotePeerId) {
        this._wsSend({
          type:    'signal',
          target:  this.remotePeerId,
          payload: e.candidate.toJSON(),
        });
      }
    };

    // Client receives the DataChannel from host
    if (this.role === 'client') {
      this._pc.ondatachannel = (e) => {
        this._dc = e.channel;
        this._setupDC(this._dc);
      };
    }
  }

  async _flushPendingCandidates() {
    for (const c of this._pendingCandidates) {
      await this._pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    this._pendingCandidates = [];
  }

  _setupDC(dc) {
    dc.onopen = () => {
      this.status = 'connected';
      this.onConnected?.();
    };
    dc.onmessage = (ev) => {
      try { this.onMessage?.(JSON.parse(ev.data)); } catch {}
    };
    dc.onclose = () => {
      if (this.status === 'connected') {
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

  _fail(msg) {
    if (this.status === 'error' || this.status === 'disconnected') return;
    this.status = 'error';
    this.onError?.(msg);
  }
}
