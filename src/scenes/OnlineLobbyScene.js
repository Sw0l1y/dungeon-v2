import { Scene           } from './Scene.js';
import { OnlineWaitScene } from './OnlineWaitScene.js';
import { ClassScene      } from './ClassScene.js';
import { RemoteBinding   } from '../systems/RemoteBinding.js';

// Synchronous clipboard write — works in Safari when called directly from a user-gesture handler
function _copyToClipboard(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  ta.remove();
}

const COLORS      = ['#8cf3ff', '#ff8c42', '#a8ff78', '#ff6b9d', '#c77dff', '#ffd166', '#ff3a4a', '#4488ff', '#44eebb', '#eeeeee'];
const COLOR_NAMES = ['Cyan',    'Orange',  'Green',   'Pink',    'Purple',  'Gold',    'Red',     'Blue',    'Teal',    'White'  ];
const MAX_NAME    = 12;
const MAX_LOCAL   = 2;   // max local (non-remote) players per device
const MAX_PLAYERS = 4;   // total player cap across all devices

// ── Grid layout (virtual canvas 1120×630) ────────────────────────────────────
//   [P1]  [P2]
//   [P3]  [P4]
const CARD_W = 238;
const CARD_H = 195;
const GAP_X  = 20;
const GAP_Y  = 16;
const GRID_X = (1120 - 2 * CARD_W - GAP_X) / 2;  // 312
const GRID_Y = 105;

function defaultSlot(idx) {
  return { active: false, name: `Player ${idx + 1}`, colorIdx: idx % COLORS.length, isRemote: false, peerId: null };
}

export class OnlineLobbyScene extends Scene {

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._role      = this.game.state.netRole;
    this._net       = this.game.state.netSession;
    this._code      = this.game.state.netCode ?? '';
    this._connected = false;
    this._error     = '';
    this._errorTimer    = 0;
    this._copyFeedback  = 0;
    this._syncTimer     = 0;
    this._editingSlot   = null;
    this._nameInput     = null; // active HTML <input> overlay, or null
    this._mySlotIdxs    = [];    // client: which slot indices belong to this device

    // Host: Set<peerId> of currently connected clients
    this._connectedPeers = new Set();
    // Host: per-peer disconnect-verify timers (fallback if onDisconnected misses)
    this._disconnectVerifyTimers = new Map(); // peerId → countdown

    const isHost = this._role === 'host';

    // Host owns all slots from the start; client waits for the first lobbySync
    this._slots = isHost
      ? [
          { active: true,  name: 'Player 1', colorIdx: 0, isRemote: false, peerId: null },
          { active: false, name: 'Player 2', colorIdx: 1, isRemote: false, peerId: null },
          { active: false, name: 'Player 3', colorIdx: 2, isRemote: false, peerId: null },
          { active: false, name: 'Player 4', colorIdx: 3, isRemote: false, peerId: null },
        ]
      : null;

    this._kicked        = false;
    this._copyBtnRect   = null;
    this._mouse         = { x: 0, y: 0 };
    this._pendingClick  = null;

    if (this._net) {
      this._net.onWaiting = () => {};

      // ── DataChannel opened (new client connected) ────────────────────────
      this._net.onConnected = (peerId) => {
        // Client side: peerId is undefined — just mark connected
        if (!isHost) { this._connected = true; return; }

        this._connectedPeers.add(peerId);
        this._connected = true;
        this._disconnectVerifyTimers.delete(peerId);

        const totalActive = this._slots.filter(s => s.active).length;
        const emptyIdx    = this._slots.findIndex(s => !s.active);

        if (emptyIdx !== -1 && totalActive < MAX_PLAYERS) {
          this._slots[emptyIdx] = {
            active: true, name: `Player ${emptyIdx + 1}`,
            colorIdx: this._nextFreeColor(emptyIdx),
            isRemote: true, peerId,
          };
          this._syncLobby();
        } else {
          // No room — politely kick the new joiner
          this._net.sendTo(peerId, { t: 'kicked' });
        }
      };

      // ── Incoming messages ────────────────────────────────────────────────
      this._net.onMessage = (data, peerId) => {
        if (isHost) {
          // ── clientUpdate: name or color change from a client ──────────────
          if (data.t === 'clientUpdate') {
            // Accept updates only for slots that belong to this peer
            const ri = (typeof data.idx === 'number' && this._slots[data.idx]?.peerId === peerId)
              ? data.idx
              : -1;
            if (ri !== -1) {
              if (typeof data.n === 'string') this._slots[ri].name = data.n.slice(0, MAX_NAME);
              if (typeof data.c === 'number') {
                if (!this._colorTaken(ri, data.c)) {
                  this._slots[ri].colorIdx = data.c;
                } else {
                  this._syncLobby(); // reject: re-sync so client sees correct state
                  return;
                }
              }
            }
            this._syncLobby();
          }

          // ── clientAddPlayer: client wants a 2nd local slot ────────────────
          if (data.t === 'clientAddPlayer') {
            const totalActive = this._slots.filter(s => s.active).length;
            const peerCount   = this._slots.filter(s => s.active && s.peerId === peerId).length;
            if (totalActive < MAX_PLAYERS && peerCount < MAX_LOCAL) {
              const emptyIdx = this._slots.findIndex(s => !s.active);
              if (emptyIdx !== -1) {
                this._slots[emptyIdx] = {
                  active: true, name: `Player ${emptyIdx + 1}`,
                  colorIdx: this._nextFreeColor(emptyIdx),
                  isRemote: true, peerId,
                };
                this._syncLobby();
              }
            }
          }

          // ── clientRemoveSlot: client removes one of their own slots ────────
          if (data.t === 'clientRemoveSlot' && typeof data.idx === 'number') {
            const s = this._slots[data.idx];
            if (s?.isRemote && s?.peerId === peerId) {
              this._slots[data.idx] = defaultSlot(data.idx);
              this._syncLobby();
            }
          }

        } else {
          // ── Full state snapshot from host ─────────────────────────────────
          if (data.t === 'lobbySync' && Array.isArray(data.s)) {
            this._slots = data.s.map((sd, i) => sd
              ? { active: !!sd.a, name: sd.n ?? `Player ${i + 1}`, colorIdx: sd.c ?? i % COLORS.length, isRemote: !!sd.r, peerId: null }
              : defaultSlot(i)
            );
            if (Array.isArray(data.mine)) this._mySlotIdxs = data.mine;
          }

          // ── Host launched — apply final state and go ──────────────────────
          if (data.t === 'lobbyStart' && Array.isArray(data.s)) {
            this._slots = data.s.map((sd, i) => sd
              ? { active: !!sd.a, name: sd.n ?? `Player ${i + 1}`, colorIdx: sd.c ?? i % COLORS.length, isRemote: !!sd.r, peerId: null }
              : defaultSlot(i)
            );
            if (Array.isArray(data.mine)) this._mySlotIdxs = data.mine;
            this._doLaunch();
          }

          // ── Host kicked this device ────────────────────────────────────────
          if (data.t === 'kicked') this._kicked = true;
        }
      };

      // ── Peer disconnected ────────────────────────────────────────────────
      this._net.onDisconnected = (peerId) => {
        if (isHost) {
          this._disconnectVerifyTimers.delete(peerId);
          this._handlePeerDisconnect(peerId);
        } else {
          this._connected = false;
          this._setError('Host disconnected');
        }
      };

      // ── DataChannel error ────────────────────────────────────────────────
      this._net.onError = (m, peerId) => {
        if (isHost && peerId) {
          // Start a verify window; onDisconnected cancels it if the DC closes normally
          this._setError('Client connection lost…');
          this._disconnectVerifyTimers.set(peerId, 4);
        } else if (!isHost) {
          this._setError(m || 'Connection error');
        }
      };
    }

    this._onMouseMove = (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this._mouse.x = (e.clientX - r.left) * (this.game.canvas.width  / r.width);
      this._mouse.y = (e.clientY - r.top)  * (this.game.canvas.height / r.height);
    };
    this._onMouseDown = (e) => {
      const r  = this.game.canvas.getBoundingClientRect();
      const pt = {
        x: (e.clientX - r.left) * (this.game.canvas.width  / r.width),
        y: (e.clientY - r.top)  * (this.game.canvas.height / r.height),
      };
      // Copy must be synchronous inside the event handler so Safari's
      // user-gesture context is still active (expires after one async tick).
      if (this._role === 'host' && this._code && this._copyBtnRect && this._hit(this._copyBtnRect, pt)) {
        _copyToClipboard(this._code);
        this._copyFeedback = 1.5;
        return;
      }
      this._pendingClick = pt;
    };

    this.game.canvas.addEventListener('mousemove', this._onMouseMove);
    this.game.canvas.addEventListener('mousedown', this._onMouseDown);
  }

  onExit() {
    this._hideNameInput();
    this.game.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.game.canvas.removeEventListener('mousedown', this._onMouseDown);
    // Don't close net — ClassScene / GameScene still need it
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _setError(msg) {
    this._error      = msg;
    this._errorTimer = msg ? 4 : 0;
  }

  // Returns true if any OTHER active slot already uses this colorIdx
  _colorTaken(slotIdx, colorIdx) {
    return (this._slots ?? []).some(
      (s, i) => i !== slotIdx && s.active && s.colorIdx === colorIdx,
    );
  }

  // Returns the first color index not in use by any other active slot
  _nextFreeColor(slotIdx) {
    const taken = new Set(
      (this._slots ?? [])
        .filter((s, i) => i !== slotIdx && s.active)
        .map(s => s.colorIdx),
    );
    for (let c = 0; c < COLORS.length; c++) {
      if (!taken.has(c)) return c;
    }
    return 0;
  }

  // Handle a peer going away (host side)
  _handlePeerDisconnect(peerId) {
    this._connectedPeers.delete(peerId);
    this._connected = this._connectedPeers.size > 0;
    if (this._slots) {
      for (let i = 0; i < this._slots.length; i++) {
        if (this._slots[i].peerId === peerId) this._slots[i] = defaultSlot(i);
      }
    }
    if (this._connected) {
      this._setError('A client disconnected');
      this._syncLobby();
    } else {
      this._setError('Client disconnected');
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  // Send a personalised lobby state to each connected client.
  // The 'mine' field tells the client which slot indices belong to their device.
  _syncLobby() {
    if (!this._net || !this._connected || this._role !== 'host') return;
    const payload = this._slots.map(s => ({
      a: s.active ? 1 : 0, n: s.name, c: s.colorIdx, r: s.isRemote ? 1 : 0,
    }));
    for (const peerId of this._net.connectedPeerIds()) {
      const mine = this._slots
        .map((s, i) => (s.peerId === peerId ? i : -1))
        .filter(i => i !== -1);
      this._net.sendTo(peerId, { t: 'lobbySync', s: payload, mine });
    }
  }

  // ── HTML name-input overlay ───────────────────────────────────────────────

  _showNameInput(slotIdx) {
    this._hideNameInput();
    this._editingSlot = slotIdx;

    const card = this._cardRect(slotIdx);
    const nf   = this._nameField(card);
    const rect = this.game.canvas.getBoundingClientRect();
    const sx   = rect.width  / this.game.canvas.width;
    const sy   = rect.height / this.game.canvas.height;

    const el = document.createElement('input');
    el.type      = 'text';
    el.maxLength = MAX_NAME;
    el.value     = this._slots?.[slotIdx]?.name ?? '';

    Object.assign(el.style, {
      position:   'fixed',
      left:       `${rect.left + nf.x * sx}px`,
      top:        `${rect.top  + nf.y * sy}px`,
      width:      `${nf.w * sx}px`,
      height:     `${nf.h * sy}px`,
      padding:    `0 ${8 * sx}px`,
      background: 'transparent',
      border:     'none',
      outline:    'none',
      color:      '#fff',
      font:       `${13 * sy}px "Trebuchet MS", sans-serif`,
      boxSizing:  'border-box',
      caretColor: '#8cf3ff',
      zIndex:     '9999',
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.stopPropagation();
        el.blur();
      }
    });

    el.addEventListener('input', () => {
      const slot = this._slots?.[slotIdx];
      if (!slot) return;
      slot.name = el.value;
      if (this._role === 'host') this._syncLobby();
      else this._net?.send({ t: 'clientUpdate', idx: slotIdx, n: slot.name });
    });

    el.addEventListener('blur', () => {
      if (this._editingSlot === slotIdx) {
        const slot = this._slots?.[slotIdx];
        if (slot) slot.name = el.value;
      }
      el.remove();
      if (this._nameInput === el) {
        this._nameInput   = null;
        this._editingSlot = null;
      }
    });

    document.body.appendChild(el);
    el.focus();
    el.select();
    this._nameInput = el;
  }

  _hideNameInput() {
    if (this._nameInput) this._nameInput.blur();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  _cardRect(idx) {
    return {
      x: GRID_X + (idx % 2) * (CARD_W + GAP_X),
      y: GRID_Y + Math.floor(idx / 2) * (CARD_H + GAP_Y),
      w: CARD_W, h: CARD_H,
    };
  }

  _playerLabel(idx) { return `P${idx + 1}`; }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  _nameField(card) {
    return { x: card.x + 14, y: card.y + 56, w: card.w - 28, h: 32 };
  }

  _colorSwatch(card, ci) {
    const sw = 28, sh = 28, gap = 6, cols = 5;
    const gridW = cols * sw + (cols - 1) * gap;
    const gx = card.x + (card.w - gridW) / 2;
    const gy = card.y + 108;
    return {
      x: gx + (ci % cols) * (sw + gap),
      y: gy + Math.floor(ci / cols) * (sh + gap),
      w: sw, h: sh,
    };
  }

  _addBtn(card) {
    return { x: card.x + 24, y: card.y + CARD_H / 2 - 22, w: card.w - 48, h: 44 };
  }

  _removeBtn(card) {
    return { x: card.x + card.w - 32, y: card.y + 8, w: 22, h: 22 };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    const y = GRID_Y + 2 * CARD_H + GAP_Y + 14;
    return { x: W / 2 - 120, y, w: 240, h: 44 };
  }

  _backBtn() {
    return { x: 14, y: 12, w: 110, h: 28 };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(dt) {
    if (this._copyFeedback > 0) this._copyFeedback -= dt;
    if (this._errorTimer   > 0) {
      this._errorTimer -= dt;
      if (this._errorTimer <= 0) { this._errorTimer = 0; this._error = ''; }
    }

    // Tick per-peer disconnect-verify timers
    for (const [peerId, t] of this._disconnectVerifyTimers) {
      const remaining = t - dt;
      if (remaining <= 0) {
        this._disconnectVerifyTimers.delete(peerId);
        this._handlePeerDisconnect(peerId);
      } else {
        this._disconnectVerifyTimers.set(peerId, remaining);
      }
    }

    // Host: periodically push full state to all clients
    if (this._role === 'host') {
      this._syncTimer += dt;
      if (this._syncTimer >= 0.5) { this._syncTimer = 0; this._syncLobby(); }
    }

    const input = this.game.input;
    const click  = this._pendingClick;
    this._pendingClick = null;

    // Kicked: only allow going back
    if (this._kicked) {
      if (input.justPressed('Escape') || input.justPressed('Enter')) this._goBack();
      if (click) this._handleClick(click);
      return;
    }

    // Escape: stop editing or go back
    if (input.justPressed('Escape')) {
      if (this._editingSlot !== null) { this._editingSlot = null; return; }
      this._goBack(); return;
    }

    // Name typing: handled by HTML overlay input

    // Host Enter = launch
    if (this._editingSlot === null && this._role === 'host') {
      if (input.justPressed('Enter')) { this._hostStart(); return; }
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    // Back button — works even when kicked
    if (this._hit(this._backBtn(), pt)) { this._goBack(); return; }
    if (this._kicked) return;

    const isHost = this._role === 'host';

    // START (host only)
    if (isHost && this._slots?.some(s => s.active) && this._hit(this._startBtn(), pt)) {
      this._hostStart(); return;
    }

    const slots = this._slots;
    if (!slots) return;

    // ── Client "+ Add 2nd Player" ─────────────────────────────────────────
    if (!isHost) {
      const myCount    = this._mySlotIdxs.filter(i => slots[i]?.active).length;
      const totalCount = slots.filter(s => s.active).length;
      if (myCount < MAX_LOCAL && totalCount < MAX_PLAYERS) {
        const firstEmpty = slots.findIndex(s => !s.active);
        if (firstEmpty !== -1) {
          const card = this._cardRect(firstEmpty);
          if (this._hit(this._addBtn(card), pt)) {
            this._net?.send({ t: 'clientAddPlayer' });
            return;
          }
        }
      }
    }

    for (let idx = 0; idx < 4; idx++) {
      const slot    = slots[idx];
      const card    = this._cardRect(idx);
      const canEdit = isHost ? !slot.isRemote : this._mySlotIdxs.includes(idx);

      if (slot.active) {
        // ── Host remove ────────────────────────────────────────────────────
        if (isHost && this._hit(this._removeBtn(card), pt)) {
          if (slot.isRemote && slot.peerId) {
            const peerSlots = slots.filter(s => s.active && s.isRemote && s.peerId === slot.peerId);
            if (peerSlots.length <= 1) {
              this._net?.sendTo(slot.peerId, { t: 'kicked' });
            }
          }
          slot.active   = false;
          slot.isRemote = false;
          slot.peerId   = null;
          if (this._editingSlot === idx) this._editingSlot = null;
          this._syncLobby();
          return;
        }

        // ── Client remove their own 2nd slot ──────────────────────────────
        if (!isHost && canEdit) {
          const myActiveCount = this._mySlotIdxs.filter(i => slots[i]?.active).length;
          if (myActiveCount > 1 && this._hit(this._removeBtn(card), pt)) {
            this._net?.send({ t: 'clientRemoveSlot', idx });
            return;
          }
        }

        // ── Edit name / color ──────────────────────────────────────────────
        if (!canEdit) continue;

        if (this._hit(this._nameField(card), pt)) { this._showNameInput(idx); return; }

        for (let ci = 0; ci < COLORS.length; ci++) {
          if (this._hit(this._colorSwatch(card, ci), pt)) {
            if (!this._colorTaken(idx, ci)) {
              slot.colorIdx = ci;
              if (isHost) this._syncLobby();
              else this._net?.send({ t: 'clientUpdate', idx, c: ci });
            }
            return;
          }
        }

      } else {
        // ── Host add local player ──────────────────────────────────────────
        if (isHost && this._hit(this._addBtn(card), pt)) {
          const localCount  = slots.filter(s => s.active && !s.isRemote).length;
          const totalActive = slots.filter(s => s.active).length;
          if (localCount < MAX_LOCAL && totalActive < MAX_PLAYERS) {
            slot.active    = true;
            slot.isRemote  = false;
            slot.peerId    = null;
            slot.name      = `Player ${idx + 1}`;
            slot.colorIdx  = this._nextFreeColor(idx);
            this._syncLobby();
          }
          return;
        }
      }
    }

    this._editingSlot = null;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _goBack() {
    this._net?.close();
    this.game.state.netSession = null;
    this.game.state.netRole    = null;
    this.game.state.netCode    = null;
    this.game.scenes.switch(new OnlineWaitScene(this.game));
  }

  // ── Launch ────────────────────────────────────────────────────────────────

  _hostStart() {
    if (!this._slots?.some(s => s.active)) return;
    const payload = this._slots.map(s => ({
      a: s.active ? 1 : 0, n: s.name, c: s.colorIdx, r: s.isRemote ? 1 : 0,
    }));
    // Send each client a personalised start message with their slot indices
    for (const peerId of this._net?.connectedPeerIds() ?? []) {
      const mine = this._slots
        .map((s, i) => (s.peerId === peerId ? i : -1))
        .filter(i => i !== -1);
      this._net.sendTo(peerId, { t: 'lobbyStart', s: payload, mine });
    }
    this._doLaunch();
  }

  _doLaunch() {
    const isHost     = this._role === 'host';
    const slots      = this._slots ?? [];
    const mySlotIdxs = isHost ? [] : (this._mySlotIdxs ?? []);
    const mySlotSet  = new Set(mySlotIdxs);

    // Collect slots with their original indices so order is preserved
    const hostSlotPairs   = slots.map((s, i) => [s, i]).filter(([s]) => s?.active && !s.isRemote);
    const remoteSlotPairs = slots.map((s, i) => [s, i]).filter(([s]) => s?.active &&  s.isRemote);

    const localBindings = [this.game.bindings.player1, this.game.bindings.player2];

    let players;
    let remoteBindings;
    let peerInputMap  = undefined;
    let myPlayerIdxs  = undefined;

    if (isHost) {
      // Every remote slot gets a RemoteBinding so the host can apply client input
      remoteBindings = remoteSlotPairs.map(() => new RemoteBinding());

      // Map peerId → {offset, count} so GameScene can route input packets
      peerInputMap = new Map();
      let rbOffset = 0;
      for (const [s] of remoteSlotPairs) {
        const pid = s.peerId;
        if (pid && !peerInputMap.has(pid)) peerInputMap.set(pid, { offset: rbOffset, count: 0 });
        if (pid) peerInputMap.get(pid).count++;
        rbOffset++;
      }

      players = [
        ...hostSlotPairs.map(([s], i) => ({
          name: s.name, color: COLORS[s.colorIdx], binding: localBindings[i],
        })),
        ...remoteSlotPairs.map(([s], i) => ({
          name: s.name, color: COLORS[s.colorIdx], binding: remoteBindings[i],
          remote: true, peerId: s.peerId,
        })),
      ];

    } else {
      // Client: my slots get local bindings; everything else gets a RemoteBinding.
      // Player array must be in the SAME ORDER as on the host (host slots first,
      // then remote slots in slot-index order).
      const nonLocalCount = hostSlotPairs.length +
        remoteSlotPairs.filter(([, i]) => !mySlotSet.has(i)).length;
      remoteBindings = Array.from({ length: nonLocalCount }, () => new RemoteBinding());

      let rbIdx    = 0;
      let localIdx = 0;

      players = [
        ...hostSlotPairs.map(([s]) => ({
          name: s.name, color: COLORS[s.colorIdx], binding: remoteBindings[rbIdx++], remote: true,
        })),
        ...remoteSlotPairs.map(([s, slotIdx]) => {
          const isLocal = mySlotSet.has(slotIdx);
          return {
            name: s.name, color: COLORS[s.colorIdx],
            binding: isLocal ? localBindings[localIdx++] : remoteBindings[rbIdx++],
            remote: !isLocal,
          };
        }),
      ];

      // Which player-array indices are locally controlled (used for input packets)
      myPlayerIdxs = players.map((p, i) => (!p.remote ? i : -1)).filter(i => i !== -1);
    }

    this.game.state.players            = players;
    this.game.state.remoteBindings     = remoteBindings;
    this.game.state.hostPlayerCount    = hostSlotPairs.length;
    this.game.state.clientPlayerCount  = remoteSlotPairs.length;
    if (peerInputMap !== undefined) this.game.state.peerInputMap  = peerInputMap;
    if (myPlayerIdxs !== undefined) this.game.state.myPlayerIdxs = myPlayerIdxs;

    this.game.scenes.switch(new ClassScene(this.game));
  }

  // ── Draw ─────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;
    const t = Date.now();
    ctx.clearRect(0, 0, W, H);

    const isHost = this._role === 'host';

    // ── Header ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 28px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ONLINE LOBBY', W / 2, 38);

    this._drawCodeRow(ctx, W, t);

    if (this._error) {
      ctx.fillStyle = '#ff7070';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this._error, W / 2, 95);
    }

    // ── Client kicked overlay ─────────────────────────────────────────────
    if (!isHost && this._kicked) {
      this._drawKickedOverlay(ctx, W, H);
      this._drawBackBtn(ctx);
      return;
    }

    // ── Client awaiting first sync ────────────────────────────────────────
    if (!isHost && !this._slots) {
      this._drawCenteredSpinner(ctx, W, H, t);
      this._drawBackBtn(ctx);
      return;
    }

    // ── Grid ──────────────────────────────────────────────────────────────
    for (let idx = 0; idx < 4; idx++) this._drawCard(ctx, idx, t);

    // ── Start / waiting hint ──────────────────────────────────────────────
    if (isHost) {
      this._drawStartBtn(ctx, W, t);
    } else {
      const sb = this._startBtn();
      ctx.fillStyle = 'rgba(140,243,255,0.5)';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for host to start...', W / 2, sb.y + sb.h / 2);
    }

    // ── Back + hint ───────────────────────────────────────────────────────
    this._drawBackBtn(ctx);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const hint = this._editingSlot !== null
      ? 'Type name  •  Enter to confirm'
      : isHost
        ? 'Click slot to add  •  × to remove  •  Enter to start'
        : 'Click name/color to edit  •  + to add 2nd local player';
    ctx.fillText(hint, W / 2, H - 8);
  }

  // ── Draw helpers ─────────────────────────────────────────────────────────

  _drawCodeRow(ctx, W, _t) {
    if (!this._code) return;
    const isHost = this._role === 'host';
    const cy = 72;

    if (isHost) {
      const ctxt = `Room: ${this._code}`;
      ctx.font = '13px "Trebuchet MS", sans-serif';
      const tw = ctx.measureText(ctxt).width;
      const cpW = 68, cpH = 24, gap = 8;
      const sx = W / 2 - (tw + gap + cpW) / 2;

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(ctxt, sx, cy);

      const btnX   = sx + tw + gap;
      const copied = this._copyFeedback > 0;
      const cpHov  = !copied && this._hit({ x: btnX, y: cy - cpH / 2, w: cpW, h: cpH }, this._mouse);

      ctx.fillStyle = copied ? 'rgba(100,255,140,0.18)' : cpHov ? 'rgba(140,243,255,0.18)' : 'rgba(140,243,255,0.07)';
      ctx.beginPath(); ctx.roundRect(btnX, cy - cpH / 2, cpW, cpH, 5); ctx.fill();
      ctx.strokeStyle = copied ? 'rgba(100,255,140,0.55)' : cpHov ? '#8cf3ff' : 'rgba(140,243,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(btnX, cy - cpH / 2, cpW, cpH, 5); ctx.stroke();
      ctx.fillStyle = copied ? 'rgba(100,255,160,0.9)' : cpHov ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(copied ? '✓ Copied!' : 'COPY', btnX + cpW / 2, cy);

      this._copyBtnRect = { x: btnX, y: cy - cpH / 2, w: cpW, h: cpH };
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Room: ${this._code}`, W / 2, cy);
    }
  }

  _drawKickedOverlay(ctx, W, H) {
    const cx = W / 2, cy = H / 2 - 30;
    ctx.fillStyle = 'rgba(10,14,28,0.85)';
    ctx.beginPath(); ctx.roundRect(cx - 220, cy - 56, 440, 112, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,80,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cx - 220, cy - 56, 440, 112, 16); ctx.stroke();
    ctx.fillStyle = '#ff7070';
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('You were removed from the lobby', cx, cy - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.fillText('Press ESC or click Back to return', cx, cy + 18);
  }

  _drawCenteredSpinner(ctx, W, H, _t) {
    const cx   = W / 2, cy = H / 2 - 20;
    const spin = ((Date.now() / 1000) * Math.PI * 2) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,243,255,0.5)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, 18, spin, spin + Math.PI * 1.4); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '14px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Connecting to host...', cx, cy + 36);
  }

  _drawBackBtn(ctx) {
    const back    = this._backBtn();
    const backHov = this._hit(back, this._mouse);
    ctx.fillStyle = backHov ? 'rgba(255,255,255,0.1)' : 'transparent';
    ctx.strokeStyle = backHov ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(back.x, back.y, back.w, back.h, 6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(back.x, back.y, back.w, back.h, 6); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('← Back  (ESC)', back.x + back.w / 2, back.y + back.h / 2);
  }

  _drawStartBtn(ctx, W, _t) {
    const hasPlayers = this._slots?.some(s => s.active) ?? false;
    const btn  = this._startBtn();
    const hov  = hasPlayers && this._hit(btn, this._mouse);
    ctx.fillStyle = hasPlayers
      ? (hov ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)')
      : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hasPlayers
      ? (hov ? '#8cf3ff' : 'rgba(140,243,255,0.3)')
      : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = hasPlayers && hov ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = hasPlayers ? (hov ? '#8cf3ff' : 'rgba(255,255,255,0.6)') : 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START GAME', btn.x + btn.w / 2, btn.y + btn.h / 2);
    if (hasPlayers) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.fillText('or press Enter', W / 2, btn.y + btn.h + 14);
    }
  }

  // ── Card drawing ──────────────────────────────────────────────────────────

  _drawCard(ctx, idx, t) {
    const slot   = this._slots?.[idx];
    const card   = this._cardRect(idx);
    const isHost = this._role === 'host';

    if (!slot || !slot.active) {
      if (isHost) {
        this._drawAddCard(ctx, card, idx);
      } else {
        // Client: show "+ Add 2nd Player" on the first empty slot when allowed
        const myCount    = this._mySlotIdxs.filter(i => (this._slots ?? [])[i]?.active).length;
        const totalCount = (this._slots ?? []).filter(s => s.active).length;
        const firstEmpty = (this._slots ?? []).findIndex(s => !s.active);
        if (myCount < MAX_LOCAL && totalCount < MAX_PLAYERS && idx === firstEmpty) {
          this._drawClientAddCard(ctx, card, idx);
        } else {
          this._drawEmptyCard(ctx, card, idx);
        }
      }
      return;
    }

    const canEdit = isHost ? !slot.isRemote : this._mySlotIdxs.includes(idx);
    this._drawActiveCard(ctx, card, idx, slot, canEdit);
  }

  _drawEmptyCard(ctx, card, idx) {
    const { x, y, w, h } = card;
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('— empty —', x + w / 2, y + h / 2);
  }

  _drawAddCard(ctx, card, idx) {
    const { x, y, w, h } = card;
    const localCount  = this._slots.filter(s => s.active && !s.isRemote).length;
    const totalActive = this._slots.filter(s => s.active).length;
    const atLimit = localCount >= MAX_LOCAL || totalActive >= MAX_PLAYERS;

    if (atLimit) { this._drawEmptyCard(ctx, card, idx); return; }

    const btn = this._addBtn(card);
    const hov = this._hit(btn, this._mouse);
    ctx.fillStyle = 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = hov ? 'rgba(140,243,255,0.25)' : 'rgba(140,243,255,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();
    ctx.fillStyle = hov ? 'rgba(140,243,255,0.14)' : 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hov ? '#8cf3ff' : 'rgba(140,243,255,0.2)'; ctx.lineWidth = hov ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = hov ? '#8cf3ff' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ Add Player', x + w / 2, btn.y + btn.h / 2);
  }

  _drawClientAddCard(ctx, card, idx) {
    const { x, y, w, h } = card;
    const btn = this._addBtn(card);
    const hov = this._hit(btn, this._mouse);
    ctx.fillStyle = 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = hov ? 'rgba(140,243,255,0.25)' : 'rgba(140,243,255,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();
    ctx.fillStyle = hov ? 'rgba(140,243,255,0.14)' : 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hov ? '#8cf3ff' : 'rgba(140,243,255,0.2)'; ctx.lineWidth = hov ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = hov ? '#8cf3ff' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ Add Local Player', x + w / 2, btn.y + btn.h / 2 - 7);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('play on this device', x + w / 2, btn.y + btn.h / 2 + 10);
  }

  _drawActiveCard(ctx, card, idx, slot, canEdit) {
    const { x, y, w, h } = card;
    const isHost = this._role === 'host';
    const color  = COLORS[slot.colorIdx];

    ctx.fillStyle = canEdit ? 'rgba(140,243,255,0.07)' : 'rgba(140,243,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = canEdit ? (color + 'aa') : 'rgba(140,243,255,0.18)';
    ctx.lineWidth = canEdit ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);

    // Right badge — shift left when remove button is visible
    const myActiveCount = this._mySlotIdxs.filter(i => (this._slots ?? [])[i]?.active).length;
    const showRemoveBtn = isHost || (!isHost && canEdit && myActiveCount > 1);
    const badgeRight    = x + w - (showRemoveBtn ? 40 : 12);

    if (slot.isRemote && !canEdit) {
      // Other device's remote slot — show "online" badge
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('online', badgeRight, y + 20);
    } else if (canEdit) {
      // This device's slot (local host player or client's own remote slot)
      const myActiveIdxs = isHost
        ? (this._slots ?? []).map((s, i) => (!s.isRemote && s.active ? i : -1)).filter(i => i !== -1)
        : this._mySlotIdxs.filter(i => (this._slots ?? [])[i]?.active);
      const li = myActiveIdxs.indexOf(idx);
      const hint = li === 0 ? 'WASD+Q/E' : li === 1 ? 'IJKL+U/P' : '';
      if (hint) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '10px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(hint, badgeRight, y + 20);
      }
    }

    // Remove button
    if (showRemoveBtn) {
      const rb  = this._removeBtn(card);
      const hov = this._hit(rb, this._mouse);
      ctx.fillStyle = hov ? 'rgba(255,80,80,0.28)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.roundRect(rb.x, rb.y, rb.w, rb.h, 4); ctx.fill();
      ctx.strokeStyle = hov ? 'rgba(255,100,100,0.7)' : 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(rb.x, rb.y, rb.w, rb.h, 4); ctx.stroke();
      ctx.fillStyle = hov ? '#ff6060' : 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×', rb.x + rb.w / 2, rb.y + rb.h / 2);
    }

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();

    if (canEdit) {
      // Editable name field
      const nf      = this._nameField(card);
      const editing = this._editingSlot === idx;
      const nfHov   = !editing && this._hit(nf, this._mouse);
      ctx.fillStyle = editing ? 'rgba(140,243,255,0.12)' : nfHov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(nf.x, nf.y, nf.w, nf.h, 5); ctx.fill();
      ctx.strokeStyle = editing ? '#8cf3ff' : nfHov ? 'rgba(140,243,255,0.35)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = editing ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(nf.x, nf.y, nf.w, nf.h, 5); ctx.stroke();
      if (!editing) {
        ctx.fillStyle = '#fff';
        ctx.font = '13px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(slot.name, nf.x + 8, nf.y + nf.h / 2);
      }

      // Color section
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('COLOR', x + 14, y + 97);
      for (let ci = 0; ci < COLORS.length; ci++) {
        const s     = this._colorSwatch(card, ci);
        const sel   = slot.colorIdx === ci;
        const taken = !sel && this._colorTaken(idx, ci);
        const sv    = !sel && !taken && this._hit(s, this._mouse);
        ctx.globalAlpha = taken ? 0.18 : sel ? 1 : 0.6;
        ctx.fillStyle = COLORS[ci];
        ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 5); ctx.fill();
        ctx.globalAlpha = 1;
        if (sel) {
          ctx.strokeStyle = color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6, 8); ctx.stroke();
        } else if (sv) {
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4, 7); ctx.stroke();
        } else if (taken) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
          const cx2 = s.x + s.w / 2, cy2 = s.y + s.h / 2, r = 5;
          ctx.beginPath(); ctx.moveTo(cx2 - r, cy2 - r); ctx.lineTo(cx2 + r, cy2 + r); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx2 + r, cy2 - r); ctx.lineTo(cx2 - r, cy2 + r); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(COLOR_NAMES[slot.colorIdx], x + w / 2, y + 180);
    } else {
      // Read-only display
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x + 22, y + 62, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '14px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(slot.name, x + 36, y + 62);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillText(COLOR_NAMES[slot.colorIdx], x + 36, y + 82);
    }
  }
}
