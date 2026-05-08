import { Scene         } from './Scene.js';
import { ClassScene    } from './ClassScene.js';
import { RemoteBinding } from '../systems/RemoteBinding.js';

const COLORS      = ['#8cf3ff', '#ff8c42', '#a8ff78', '#ff6b9d', '#c77dff', '#ffd166'];
const COLOR_NAMES = ['Cyan',    'Orange',  'Green',   'Pink',    'Purple',  'Gold'   ];
const MAX_NAME    = 12;

const CARD_W = 300;
const CARD_H = 340;
const GAP    = 80;

export class OnlineLobbyScene extends Scene {

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._role = this.game.state.netRole;      // 'host' | 'client'
    this._net  = this.game.state.netSession;
    this._code = this.game.state.netCode ?? '';

    const isHost = this._role === 'host';

    // Default names / colors differ per role so same-device feel natural
    this._slots = [
      { active: true,  name: isHost ? 'Player 1' : 'Player 3', colorIdx: isHost ? 0 : 2 },
      { active: false, name: isHost ? 'Player 2' : 'Player 4', colorIdx: isHost ? 1 : 3 },
    ];

    this._editingSlot  = null;
    this._remoteConfig = null;   // [{name,color}] from other device; null = not yet
    this._copyFeedback = 0;      // seconds to show "Copied!" (host only)
    this._syncTimer    = 0;

    this._mouse        = { x: 0, y: 0 };
    this._pendingClick = null;

    // ── Wire net message handler ──────────────────────────────────────────────
    if (this._net) {
      this._net.onMessage = (data) => {
        // Other device periodically sends their lobby config
        if (data.t === 'lobbySync') {
          this._remoteConfig = data.players;
        }
        // Host sends 'lobbyStart' to tell client to launch; includes host's final config
        if (data.t === 'lobbyStart' && this._role === 'client') {
          this._remoteConfig = data.hc;  // host's finalized player array
          this._finalize();
        }
      };
    }

    // Immediately send our current config
    this._syncLobby();

    this._onMouseMove = (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this._mouse.x = (e.clientX - r.left) * (this.game.canvas.width  / r.width);
      this._mouse.y = (e.clientY - r.top)  * (this.game.canvas.height / r.height);
    };
    this._onMouseDown = (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this._pendingClick = {
        x: (e.clientX - r.left) * (this.game.canvas.width  / r.width),
        y: (e.clientY - r.top)  * (this.game.canvas.height / r.height),
      };
    };

    this.game.canvas.addEventListener('mousemove', this._onMouseMove);
    this.game.canvas.addEventListener('mousedown', this._onMouseDown);
  }

  onExit() {
    this.game.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.game.canvas.removeEventListener('mousedown', this._onMouseDown);
    // Do NOT close net — ClassScene / GameScene still need it
  }

  // ── Data helpers ───────────────────────────────────────────────────────────

  _activePlayers() {
    return this._slots
      .filter(s => s.active)
      .map(s => ({ name: s.name, color: COLORS[s.colorIdx] }));
  }

  _syncLobby() {
    this._net?.send({ t: 'lobbySync', players: this._activePlayers() });
  }

  // ── Layout helpers ─────────────────────────────────────────────────────────

  _cardX(slotIdx) {
    const W = this.game.canvas.width;
    const totalW = CARD_W * 2 + GAP;
    const x1 = (W - totalW) / 2;
    return slotIdx === 0 ? x1 : x1 + CARD_W + GAP;
  }

  get _cardY() { return 115; }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  _nameField(slotIdx) {
    return { x: this._cardX(slotIdx) + 20, y: this._cardY + 68, w: CARD_W - 40, h: 38 };
  }

  _colorSwatch(slotIdx, colorIdx) {
    const sw = 34, sh = 34, gap = 8, cols = 3;
    const gridW = cols * sw + (cols - 1) * gap;
    const gridX = this._cardX(slotIdx) + (CARD_W - gridW) / 2;
    const gridY = this._cardY + 148;
    return {
      x: gridX + (colorIdx % cols) * (sw + gap),
      y: gridY + Math.floor(colorIdx / cols) * (sh + gap),
      w: sw, h: sh,
    };
  }

  _addP2Btn() {
    const x = this._cardX(1);
    return { x: x + 30, y: this._cardY + CARD_H / 2 - 26, w: CARD_W - 60, h: 52 };
  }

  _removeP2Btn() {
    const x = this._cardX(1);
    return { x: x + CARD_W / 2 - 52, y: this._cardY + CARD_H - 46, w: 104, h: 30 };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    return { x: W / 2 - 120, y: this._cardY + CARD_H + 28, w: 240, h: 48 };
  }

  _copyBtn() {
    const W = this.game.canvas.width;
    return { x: W / 2 + 68, y: 46, w: 90, h: 28 };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt) {
    if (this._copyFeedback > 0) this._copyFeedback -= dt;

    // Periodic sync
    this._syncTimer += dt;
    if (this._syncTimer >= 0.5) {
      this._syncTimer = 0;
      this._syncLobby();
    }

    const input = this.game.input;
    const click = this._pendingClick;
    this._pendingClick = null;

    // V key: toggle second local player
    if (input.justPressed('KeyV')) {
      this._slots[1].active = !this._slots[1].active;
      if (this._slots[1].active) this._resolveColorConflict(1);
      if (!this._slots[1].active && this._editingSlot === 1) this._editingSlot = null;
      this._syncLobby();
    }

    // Name typing
    if (this._editingSlot !== null) {
      let changed = false;
      for (const ch of input.chars) {
        const s = this._slots[this._editingSlot];
        if (s.name.length < MAX_NAME) { s.name += ch; changed = true; }
      }
      if (input.justPressed('Backspace')) {
        this._slots[this._editingSlot].name = this._slots[this._editingSlot].name.slice(0, -1);
        changed = true;
      }
      if (changed) this._syncLobby();
      if (input.justPressed('Escape') || input.justPressed('Enter')) {
        this._editingSlot = null;
        return;
      }
    }

    // Host Enter: launch when remote is ready
    if (this._editingSlot === null && this._role === 'host' && this._remoteConfig) {
      if (input.justPressed('Enter')) { this._hostLaunch(); return; }
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    const W = this.game.canvas.width;

    // ── START (host only) ──────────────────────────────────────────────────
    if (this._role === 'host' && this._remoteConfig && this._hit(this._startBtn(), pt)) {
      this._hostLaunch(); return;
    }

    // ── Copy code (host only) ──────────────────────────────────────────────
    if (this._role === 'host' && this._code) {
      if (this._hit(this._copyBtn(), pt)) {
        navigator.clipboard?.writeText(this._code).catch(() => {});
        this._copyFeedback = 1.5;
        return;
      }
    }

    // ── Add P2 ────────────────────────────────────────────────────────────
    if (!this._slots[1].active && this._hit(this._addP2Btn(), pt)) {
      this._slots[1].active = true;
      this._resolveColorConflict(1);
      this._syncLobby();
      return;
    }

    // ── Slot interactions ─────────────────────────────────────────────────
    for (const i of [0, 1]) {
      if (!this._slots[i].active) continue;

      if (this._hit(this._nameField(i), pt)) { this._editingSlot = i; return; }

      for (let ci = 0; ci < COLORS.length; ci++) {
        if (this._hit(this._colorSwatch(i, ci), pt)) {
          if (!this._takenColorIdxs(i).has(ci)) {
            this._slots[i].colorIdx = ci;
            this._syncLobby();
          }
          return;
        }
      }

      if (i === 1 && this._hit(this._removeP2Btn(), pt)) {
        this._slots[1].active = false;
        if (this._editingSlot === 1) this._editingSlot = null;
        this._syncLobby();
        return;
      }
    }

    // Click outside a field → stop editing
    this._editingSlot = null;
  }

  _takenColorIdxs(forSlotIdx) {
    const taken = new Set();
    this._slots.forEach((s, i) => { if (i !== forSlotIdx && s.active) taken.add(s.colorIdx); });
    return taken;
  }

  _resolveColorConflict(slotIdx) {
    const taken = this._takenColorIdxs(slotIdx);
    if (!taken.has(this._slots[slotIdx].colorIdx)) return;
    for (let i = 0; i < COLORS.length; i++) {
      if (!taken.has(i)) { this._slots[slotIdx].colorIdx = i; return; }
    }
  }

  // ── Launch ─────────────────────────────────────────────────────────────────

  _hostLaunch() {
    const myConfig = this._activePlayers();
    this._net?.send({ t: 'lobbyStart', hc: myConfig });
    // host config, client config
    this._buildStateAndSwitch(myConfig, this._remoteConfig);
  }

  // Called on client when host sends lobbyStart
  _finalize() {
    // this._remoteConfig = host's config (set before calling _finalize)
    const myConfig = this._activePlayers();
    // host config, client config
    this._buildStateAndSwitch(this._remoteConfig, myConfig);
  }

  _buildStateAndSwitch(hostConfig, clientConfig) {
    const hc = hostConfig  ?? [];
    const cc = clientConfig ?? [];

    // Create one RemoteBinding per remote player
    const isHost = this._role === 'host';
    const remoteCount    = isHost ? cc.length : hc.length;
    const remoteBindings = Array.from({ length: remoteCount }, () => new RemoteBinding());

    const localBindings = [this.game.bindings.player1, this.game.bindings.player2];

    // Player array layout: host's players first (indices 0..hc-1),
    // then client's players (indices hc..hc+cc-1).
    let players;
    if (isHost) {
      players = [
        ...hc.map((p, i) => ({ name: p.name, color: p.color, binding: localBindings[i] })),
        ...cc.map((p, i) => ({ name: p.name, color: p.color, binding: remoteBindings[i], remote: true, classId: 'sword' })),
      ];
    } else {
      players = [
        ...hc.map((p, i) => ({ name: p.name, color: p.color, binding: remoteBindings[i], remote: true, classId: 'sword' })),
        ...cc.map((p, i) => ({ name: p.name, color: p.color, binding: localBindings[i] })),
      ];
    }

    this.game.state.players           = players;
    this.game.state.remoteBindings    = remoteBindings;
    this.game.state.hostPlayerCount   = hc.length;
    this.game.state.clientPlayerCount = cc.length;

    this.game.scenes.switch(new ClassScene(this.game));
  }

  // ── Draw ───────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;
    const t = Date.now();
    ctx.clearRect(0, 0, W, H);

    const isHost = this._role === 'host';

    // ── Title ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ONLINE LOBBY', W / 2, 52);

    // ── Room code + copy button (host) ────────────────────────────────────
    if (isHost && this._code) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Room: ${this._code}`, W / 2 - 10, 79);

      const cp  = this._copyBtn();
      const copied = this._copyFeedback > 0;
      const cpHov  = !copied && this._hit(cp, this._mouse);
      ctx.fillStyle = copied ? 'rgba(100,255,140,0.18)' : cpHov ? 'rgba(140,243,255,0.18)' : 'rgba(140,243,255,0.07)';
      ctx.beginPath(); ctx.roundRect(cp.x, cp.y, cp.w, cp.h, 6); ctx.fill();
      ctx.strokeStyle = copied ? 'rgba(100,255,140,0.55)' : cpHov ? '#8cf3ff' : 'rgba(140,243,255,0.28)';
      ctx.lineWidth = cpHov || copied ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(cp.x, cp.y, cp.w, cp.h, 6); ctx.stroke();
      ctx.fillStyle = copied ? 'rgba(100,255,160,0.9)' : cpHov ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(copied ? '✓ Copied!' : 'COPY', cp.x + cp.w / 2, cp.y + cp.h / 2);
    }

    // ── Remote device status (top-right) ─────────────────────────────────
    const rc  = this._remoteConfig;
    const rcY = 79;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    if (rc) {
      const a = 0.65 + 0.25 * Math.sin(t / 260);
      ctx.fillStyle = `rgba(140,243,255,${a})`;
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.fillText(
        `● Other device: ${rc.map(p => p.name).join(' & ')}`,
        W - 24, rcY,
      );
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.fillText('○ Other device connecting...', W - 24, rcY);
    }

    // ── Player cards ─────────────────────────────────────────────────────
    this._drawCard(ctx, 0);
    this._drawCard(ctx, 1);

    // ── START / waiting ───────────────────────────────────────────────────
    if (isHost) {
      this._drawStartBtn(ctx, W);
    } else {
      const canStart = !!rc;
      ctx.fillStyle = canStart ? 'rgba(140,243,255,0.55)' : 'rgba(255,255,255,0.3)';
      ctx.font = canStart ? 'bold 15px "Trebuchet MS", sans-serif' : '15px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(
        canStart ? 'Waiting for host to start...' : 'Waiting for other device...',
        W / 2, this._cardY + CARD_H + 52,
      );
    }

    // ── Bottom hint ───────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(
      this._editingSlot !== null
        ? 'Type name  •  Enter or Esc to confirm'
        : `Click to edit  •  V to add/remove local player${isHost ? '  •  Enter to start' : ''}`,
      W / 2, H - 16,
    );
  }

  _drawStartBtn(ctx, W) {
    const canStart = !!this._remoteConfig;
    const btn = this._startBtn();
    const hov = canStart && this._hit(btn, this._mouse);

    ctx.fillStyle = canStart
      ? (hov ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)')
      : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = canStart
      ? (hov ? '#8cf3ff' : 'rgba(140,243,255,0.3)')
      : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = canStart && hov ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = canStart ? (hov ? '#8cf3ff' : 'rgba(255,255,255,0.6)') : 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START GAME', btn.x + btn.w / 2, btn.y + btn.h / 2);

    if (!canStart) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.fillText('Waiting for other device...', W / 2, btn.y + btn.h + 18);
    }
  }

  _drawCard(ctx, i) {
    const slot  = this._slots[i];
    const x     = this._cardX(i);
    const y     = this._cardY;
    const color = COLORS[slot.colorIdx];

    // Card bg
    ctx.fillStyle = slot.active ? 'rgba(140,243,255,0.07)' : 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, 14); ctx.fill();
    ctx.strokeStyle = slot.active ? 'rgba(140,243,255,0.22)' : 'rgba(140,243,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, 14); ctx.stroke();

    // Header
    ctx.fillStyle = slot.active ? color : 'rgba(255,255,255,0.25)';
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`YOUR PLAYER ${i + 1}`, x + 20, y + 28);

    const hint = i === 0 ? 'WASD + Q/E' : 'IJKL + U/P';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(hint, x + CARD_W - 20, y + 28);

    if (!slot.active) {
      this._drawAddP2Card(ctx, x, y);
      return;
    }

    this._drawNameField(ctx, i, color);
    this._drawColorField(ctx, i, color);
    if (i === 1) this._drawRemoveBtn(ctx);
  }

  _drawAddP2Card(ctx, x, y) {
    const btn    = this._addP2Btn();
    const hovered = this._hit(btn, this._mouse);

    ctx.fillStyle = hovered ? 'rgba(140,243,255,0.14)' : 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10); ctx.fill();
    ctx.strokeStyle = hovered ? '#8cf3ff' : 'rgba(140,243,255,0.2)';
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10); ctx.stroke();

    ctx.fillStyle = hovered ? '#8cf3ff' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ Add Local Player', x + CARD_W / 2, btn.y + btn.h / 2 - 8);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillText('or press  V', x + CARD_W / 2, btn.y + btn.h / 2 + 12);
  }

  _drawNameField(ctx, i, color) {
    const f       = this._nameField(i);
    const editing = this._editingSlot === i;
    const hovered = this._hit(f, this._mouse);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('NAME', f.x, f.y - 12);

    ctx.fillStyle = editing ? 'rgba(140,243,255,0.12)' : hovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(f.x, f.y, f.w, f.h, 6); ctx.fill();
    ctx.strokeStyle = editing ? '#8cf3ff' : hovered ? 'rgba(140,243,255,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = editing ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(f.x, f.y, f.w, f.h, 6); ctx.stroke();

    const cursor = editing && Math.floor(Date.now() / 500) % 2 === 0 ? '│' : '';
    ctx.fillStyle = '#fff';
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._slots[i].name + cursor, f.x + 10, f.y + f.h / 2);
  }

  _drawColorField(ctx, i, color) {
    const sx    = this._cardX(i);
    const taken = this._takenColorIdxs(i);

    ctx.fillStyle    = 'rgba(255,255,255,0.35)';
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('COLOR', sx + 20, this._cardY + 136);

    for (let ci = 0; ci < COLORS.length; ci++) {
      const s       = this._colorSwatch(i, ci);
      const sel     = this._slots[i].colorIdx === ci;
      const isTaken = taken.has(ci);
      const hovered = !isTaken && !sel && this._hit(s, this._mouse);

      ctx.save();
      ctx.globalAlpha = isTaken ? 0.28 : 1;
      ctx.fillStyle   = COLORS[ci];
      ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 6); ctx.fill();
      ctx.restore();

      if (sel) {
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2.5;
        ctx.beginPath(); ctx.roundRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6, 9); ctx.stroke();
      } else if (hovered) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.roundRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4, 7); ctx.stroke();
      }

      if (isTaken) {
        ctx.strokeStyle = 'rgba(255,50,50,0.9)';
        ctx.lineWidth   = 2.5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x + 7, s.y + 7); ctx.lineTo(s.x + s.w - 7, s.y + s.h - 7);
        ctx.moveTo(s.x + s.w - 7, s.y + 7); ctx.lineTo(s.x + 7, s.y + s.h - 7);
        ctx.stroke(); ctx.lineCap = 'butt';
      }
    }

    ctx.fillStyle    = 'rgba(255,255,255,0.4)';
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(COLOR_NAMES[this._slots[i].colorIdx], sx + CARD_W / 2, this._cardY + 232);
  }

  _drawRemoveBtn(ctx) {
    const btn    = this._removeP2Btn();
    const hovered = this._hit(btn, this._mouse);
    ctx.fillStyle = hovered ? '#ff8080' : 'rgba(255,100,100,0.4)';
    ctx.font = `${hovered ? 'bold ' : ''}12px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('[ Remove Player ]', btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
}
