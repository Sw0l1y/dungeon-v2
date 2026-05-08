import { Scene           } from './Scene.js';
import { OnlineWaitScene } from './OnlineWaitScene.js';
import { ClassScene      } from './ClassScene.js';
import { RemoteBinding   } from '../systems/RemoteBinding.js';

const COLORS      = ['#8cf3ff', '#ff8c42', '#a8ff78', '#ff6b9d', '#c77dff', '#ffd166'];
const COLOR_NAMES = ['Cyan',    'Orange',  'Green',   'Pink',    'Purple',  'Gold'   ];
const MAX_NAME    = 12;

// ── Grid layout (virtual canvas 1120×630) ─────────────────────────────────────
// 2 × 2 grid.  Col 0 = host's slots.  Col 1 = client's slots.
// Row 0 = primary (always filled once connected).  Row 1 = optional secondary.
//
//   [P1 – host primary ]  [P2 – client primary ]
//   [P3 – host optional]  [P4 – client optional]
//
const CARD_W = 238;
const CARD_H = 195;
const GAP_X  = 20;
const GAP_Y  = 16;
const GRID_X = (1120 - 2 * CARD_W - GAP_X) / 2;  // 312
const GRID_Y = 105;

export class OnlineLobbyScene extends Scene {

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._role      = this.game.state.netRole;
    this._net       = this.game.state.netSession;
    this._code      = this.game.state.netCode ?? '';
    this._connected = false;
    this._error     = '';
    this._copyFeedback = 0;
    this._syncTimer    = 0;
    this._editingSlot  = null;   // 0 | 1 | null  (index into _mySlots)

    const isHost = this._role === 'host';

    // Each device controls its column:
    //   host  → col 0 → P1 (slot 0) and P3 (slot 1, optional)
    //   client → col 1 → P2 (slot 0) and P4 (slot 1, optional)
    this._mySlots = [
      { active: true,  name: isHost ? 'Player 1' : 'Player 2', colorIdx: isHost ? 0 : 1 },
      { active: false, name: isHost ? 'Player 3' : 'Player 4', colorIdx: isHost ? 2 : 3 },
    ];
    this._remoteSlots = null;    // [{active,name,colorIdx}×2] or null = not yet received

    this._mouse        = { x: 0, y: 0 };
    this._pendingClick = null;

    if (this._net) {
      // Host: server confirmed role – grid already visible, nothing extra needed
      this._net.onWaiting = () => {};

      // DataChannel open
      this._net.onConnected = () => {
        this._connected = true;
        this._syncLobby();
      };

      this._net.onMessage = (data) => {
        if (data.t === 'lobbySync' && Array.isArray(data.s)) {
          this._remoteSlots = data.s.map(sd =>
            sd ? { active: !!sd.a, name: sd.n, colorIdx: sd.c } : null,
          );
        }
        // Host tells client to launch; includes final host config
        if (data.t === 'lobbyStart' && this._role === 'client') {
          if (Array.isArray(data.hc)) {
            this._remoteSlots = data.hc.map(sd =>
              sd ? { active: true, name: sd.n, colorIdx: sd.c } : null,
            );
          }
          this._doLaunch();
        }
      };

      this._net.onDisconnected = () => {
        this._connected = false;
        this._remoteSlots = null;
        this._error = 'Other device disconnected';
      };

      this._net.onError = (m) => { this._error = m || 'Connection error'; };
    }

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
    // Don't close net – ClassScene / GameScene still need it
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  _syncLobby() {
    if (!this._net || !this._connected) return;
    this._net.send({
      t: 'lobbySync',
      s: this._mySlots.map(s => ({ a: s.active ? 1 : 0, n: s.name, c: s.colorIdx })),
    });
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  _cardRect(idx) {
    return {
      x: GRID_X + (idx % 2) * (CARD_W + GAP_X),
      y: GRID_Y + Math.floor(idx / 2) * (CARD_H + GAP_Y),
      w: CARD_W, h: CARD_H,
    };
  }

  // col 0 = host, col 1 = client
  _isMyCard(idx)  { return this._role === 'host' ? idx % 2 === 0 : idx % 2 === 1; }
  _mySlotOf(idx)  { return Math.floor(idx / 2); }   // 0 = primary, 1 = secondary

  _slotData(idx) {
    const si = this._mySlotOf(idx);
    return this._isMyCard(idx)
      ? this._mySlots[si]
      : (this._remoteSlots?.[si] ?? null);
  }

  _playerLabel(idx) { return `P${idx + 1}`; }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  _nameField(card) {
    return { x: card.x + 14, y: card.y + 56, w: card.w - 28, h: 32 };
  }

  _colorSwatch(card, ci) {
    const sw = 28, sh = 28, gap = 6, cols = 3;
    const gridW = cols * sw + (cols - 1) * gap;   // 96
    const gx    = card.x + (card.w - gridW) / 2;
    const gy    = card.y + 110;
    return {
      x: gx + (ci % cols) * (sw + gap),
      y: gy + Math.floor(ci / cols) * (sh + gap),
      w: sw, h: sh,
    };
  }

  _addBtn(card) {
    return { x: card.x + 24, y: card.y + CARD_H / 2 - 22, w: card.w - 48, h: 44 };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    const y = GRID_Y + 2 * CARD_H + GAP_Y + 14;
    return { x: W / 2 - 120, y, w: 240, h: 44 };
  }

  _backBtn() {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;
    return { x: W / 2 - 55, y: H - 46, w: 110, h: 30 };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt) {
    if (this._copyFeedback > 0) this._copyFeedback -= dt;

    this._syncTimer += dt;
    if (this._syncTimer >= 0.5) { this._syncTimer = 0; this._syncLobby(); }

    const input = this.game.input;
    const click  = this._pendingClick;
    this._pendingClick = null;

    // V: toggle my secondary slot
    if (input.justPressed('KeyV')) {
      this._mySlots[1].active = !this._mySlots[1].active;
      if (!this._mySlots[1].active && this._editingSlot === 1) this._editingSlot = null;
      this._syncLobby();
    }

    // Escape: stop editing or go back
    if (input.justPressed('Escape')) {
      if (this._editingSlot !== null) { this._editingSlot = null; return; }
      this._goBack(); return;
    }

    // Name typing
    if (this._editingSlot !== null) {
      let changed = false;
      for (const ch of input.chars) {
        if (this._mySlots[this._editingSlot].name.length < MAX_NAME) {
          this._mySlots[this._editingSlot].name += ch; changed = true;
        }
      }
      if (input.justPressed('Backspace')) {
        this._mySlots[this._editingSlot].name = this._mySlots[this._editingSlot].name.slice(0, -1);
        changed = true;
      }
      if (changed) this._syncLobby();
      if (input.justPressed('Enter')) { this._editingSlot = null; return; }
    }

    // Host Enter: launch
    if (this._editingSlot === null && this._role === 'host' && this._connected && this._remoteSlots) {
      if (input.justPressed('Enter')) { this._hostStart(); return; }
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    // Back
    if (this._hit(this._backBtn(), pt)) { this._goBack(); return; }

    // Copy code (host) — _copyBtnRect is set during draw()
    if (this._role === 'host' && this._code && this._copyBtnRect) {
      if (this._hit(this._copyBtnRect, pt)) {
        navigator.clipboard?.writeText(this._code).catch(() => {});
        this._copyFeedback = 1.5; return;
      }
    }

    // START (host)
    if (this._role === 'host' && this._connected && this._remoteSlots) {
      if (this._hit(this._startBtn(), pt)) { this._hostStart(); return; }
    }

    // Card interactions — only own cards
    for (let idx = 0; idx < 4; idx++) {
      if (!this._isMyCard(idx)) continue;
      const si   = this._mySlotOf(idx);
      const slot = this._mySlots[si];
      const card = this._cardRect(idx);

      if (slot.active) {
        // Name field
        if (this._hit(this._nameField(card), pt)) { this._editingSlot = si; return; }
        // Color swatches
        for (let ci = 0; ci < COLORS.length; ci++) {
          if (this._hit(this._colorSwatch(card, ci), pt)) {
            slot.colorIdx = ci; this._syncLobby(); return;
          }
        }
      } else {
        // Add button (secondary only)
        if (si === 1 && this._hit(this._addBtn(card), pt)) {
          slot.active = true; this._syncLobby(); return;
        }
      }
    }

    this._editingSlot = null;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _goBack() {
    this._net?.close();
    this.game.state.netSession = null;
    this.game.state.netRole    = null;
    this.game.state.netCode    = null;
    this.game.scenes.switch(new OnlineWaitScene(this.game));
  }

  // ── Launch ─────────────────────────────────────────────────────────────────

  _hostStart() {
    const myConfig = this._mySlots.map(s => s.active ? { n: s.name, c: s.colorIdx } : null);
    this._net?.send({ t: 'lobbyStart', hc: myConfig });
    this._doLaunch();
  }

  _doLaunch() {
    const isHost = this._role === 'host';

    const toPlayerConfig = (slots) =>
      (slots ?? []).filter(s => s?.active).map(s => ({ name: s.name, color: COLORS[s.colorIdx] }));

    const myConfig     = toPlayerConfig(this._mySlots);
    const remoteConfig = toPlayerConfig(this._remoteSlots);

    const hostConfig   = isHost ? myConfig   : remoteConfig;
    const clientConfig = isHost ? remoteConfig : myConfig;

    const remoteCount    = isHost ? clientConfig.length : hostConfig.length;
    const remoteBindings = Array.from({ length: remoteCount }, () => new RemoteBinding());
    const localBindings  = [this.game.bindings.player1, this.game.bindings.player2];

    let players;
    if (isHost) {
      players = [
        ...hostConfig.map((p, i)   => ({ name: p.name, color: p.color, binding: localBindings[i] })),
        ...clientConfig.map((p, i) => ({ name: p.name, color: p.color, binding: remoteBindings[i], remote: true, classId: 'sword' })),
      ];
    } else {
      players = [
        ...hostConfig.map((p, i)   => ({ name: p.name, color: p.color, binding: remoteBindings[i], remote: true, classId: 'sword' })),
        ...clientConfig.map((p, i) => ({ name: p.name, color: p.color, binding: localBindings[i] })),
      ];
    }

    this.game.state.players           = players;
    this.game.state.remoteBindings    = remoteBindings;
    this.game.state.hostPlayerCount   = hostConfig.length;
    this.game.state.clientPlayerCount = clientConfig.length;

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
    ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ONLINE LOBBY', W / 2, 50);

    // ── Room code + copy button ────────────────────────────────────────────
    if (isHost && this._code) {
      const cp   = this._codeCopyBtn();
      const ctxt = `Room: ${this._code}`;
      ctx.font = '13px "Trebuchet MS", sans-serif';
      const tw = ctx.measureText(ctxt).width;

      const gap    = 8;
      const totalW = tw + gap + cp.w;
      const startX = W / 2 - totalW / 2;

      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(ctxt, startX, 78);

      const btnX = startX + tw + gap;
      const copied = this._copyFeedback > 0;
      const cpHov  = !copied && this._hit(cp, this._mouse);
      ctx.fillStyle = copied ? 'rgba(100,255,140,0.18)' : cpHov ? 'rgba(140,243,255,0.18)' : 'rgba(140,243,255,0.07)';
      ctx.beginPath(); ctx.roundRect(btnX, cp.y, cp.w, cp.h, 5); ctx.fill();
      ctx.strokeStyle = copied ? 'rgba(100,255,140,0.55)' : cpHov ? '#8cf3ff' : 'rgba(140,243,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(btnX, cp.y, cp.w, cp.h, 5); ctx.stroke();
      ctx.fillStyle = copied ? 'rgba(100,255,160,0.9)' : cpHov ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(copied ? '✓ Copied!' : 'COPY', btnX + cp.w / 2, cp.y + cp.h / 2);

      // Store actual button position for hit-testing
      this._copyBtnRect = { x: btnX, y: cp.y, w: cp.w, h: cp.h };
    }

    // ── Error banner ──────────────────────────────────────────────────────
    if (this._error) {
      ctx.fillStyle = '#ff7070';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this._error, W / 2, 79);
    }

    // ── Player labels above each column ───────────────────────────────────
    // (Not strictly necessary since each card shows P1–P4, but column headers help)

    // ── Grid ─────────────────────────────────────────────────────────────
    for (let idx = 0; idx < 4; idx++) {
      this._drawCard(ctx, idx, t);
    }

    // ── START or waiting text ─────────────────────────────────────────────
    const sb = this._startBtn();
    if (isHost) {
      this._drawStartBtn(ctx, W, t);
    } else if (this._connected) {
      ctx.fillStyle = 'rgba(140,243,255,0.5)';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for host to start...', W / 2, sb.y + sb.h / 2);
    }

    // ── Back button ───────────────────────────────────────────────────────
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

    // ── Bottom hint ───────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(
      this._editingSlot !== null
        ? 'Type name  •  Enter to confirm'
        : 'Click name to edit  •  V to add/remove your second player',
      W / 2, H - 8,
    );
  }

  // Returns a template rect for the copy button (x is recalculated at draw time based on text width)
  _codeCopyBtn() {
    return { x: 0, y: 68, w: 68, h: 24 };  // x is overridden at draw time
  }

  _drawStartBtn(ctx, W, t) {
    const ready = this._connected && !!this._remoteSlots;
    const btn   = this._startBtn();
    const hov   = ready && this._hit(btn, this._mouse);

    ctx.fillStyle = ready
      ? (hov ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)')
      : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = ready
      ? (hov ? '#8cf3ff' : 'rgba(140,243,255,0.3)')
      : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = ready && hov ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = ready ? (hov ? '#8cf3ff' : 'rgba(255,255,255,0.6)') : 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START GAME', btn.x + btn.w / 2, btn.y + btn.h / 2);

    if (!ready) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.fillText(
        !this._connected ? 'Waiting for player to join...' : 'Waiting for other device...',
        W / 2, btn.y + btn.h + 14,
      );
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '12px "Trebuchet MS", sans-serif';
      ctx.fillText('or press Enter', W / 2, btn.y + btn.h + 14);
    }
  }

  // ── Card drawing ───────────────────────────────────────────────────────────

  _drawCard(ctx, idx, t) {
    const isMine = this._isMyCard(idx);
    const si     = this._mySlotOf(idx);
    const slot   = this._slotData(idx);
    const card   = this._cardRect(idx);

    // Primary remote slot before connection = connecting spinner
    if (!isMine && si === 0 && !this._connected) {
      this._drawConnectingCard(ctx, card, idx, t); return;
    }

    if (!slot || !slot.active) {
      if (isMine && si === 1) this._drawAddCard(ctx, card, idx);
      else                    this._drawEmptyCard(ctx, card, idx);
      return;
    }

    this._drawActiveCard(ctx, card, idx, slot, isMine);
  }

  _drawConnectingCard(ctx, card, _idx, t) {
    const { x, y, w, h } = card;
    const spin = ((Date.now() / 1000) * Math.PI * 2) % (Math.PI * 2);

    ctx.fillStyle = 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(140,243,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(this._role === 'host' ? 1 : 0), x + 14, y + 20);

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();

    // Spinner
    ctx.strokeStyle = 'rgba(140,243,255,0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2 - 12, 14, spin, spin + Math.PI * 1.4);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const msg = this._role === 'host' ? 'Waiting for player...' : 'Connecting...';
    ctx.fillText(msg, x + w / 2, y + h / 2 + 12);

    // Show code in the waiting card (host only, since they need to share it)
    if (this._role === 'host' && this._code) {
      for (let i = 0; i < 4; i++) {
        const bx = x + (w - (4 * 30 + 3 * 6)) / 2 + i * 36;
        const by = y + h - 46;
        const pulse = 0.12 + 0.06 * Math.sin(Date.now() / 400);
        ctx.fillStyle = `rgba(140,243,255,${pulse})`;
        ctx.beginPath(); ctx.roundRect(bx, by, 30, 34, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(140,243,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, by, 30, 34, 6); ctx.stroke();
        ctx.fillStyle = '#8cf3ff';
        ctx.font = 'bold 18px "Trebuchet MS", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this._code[i] ?? '', bx + 15, by + 17);
      }
    }
  }

  _drawEmptyCard(ctx, card, idx) {
    const { x, y, w, h } = card;
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('— empty —', x + w / 2, y + h / 2);
  }

  _drawAddCard(ctx, card, idx) {
    const { x, y, w, h } = card;
    const btn = this._addBtn(card);
    const hov = this._hit(btn, this._mouse);

    ctx.fillStyle = 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(140,243,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();

    ctx.fillStyle = hov ? 'rgba(140,243,255,0.14)' : 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hov ? '#8cf3ff' : 'rgba(140,243,255,0.2)';
    ctx.lineWidth = hov ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();

    ctx.fillStyle = hov ? '#8cf3ff' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ Add Player', x + w / 2, btn.y + btn.h / 2 - 7);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('or press  V', x + w / 2, btn.y + btn.h / 2 + 10);
  }

  _drawActiveCard(ctx, card, idx, slot, isMine) {
    const { x, y, w, h } = card;
    const color     = COLORS[slot.colorIdx];
    const mySlotIdx = this._mySlotOf(idx);

    // Card bg — mine slightly brighter
    ctx.fillStyle = isMine ? 'rgba(140,243,255,0.07)' : 'rgba(140,243,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = isMine ? (color + 'aa') : 'rgba(140,243,255,0.18)';
    ctx.lineWidth = isMine ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    // Player label
    ctx.fillStyle = color;
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._playerLabel(idx), x + 14, y + 20);

    // Right-side badge
    if (isMine) {
      const hint = mySlotIdx === 0 ? 'WASD + Q/E' : 'IJKL + U/P';
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(hint, x + w - 12, y + 20);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('other device', x + w - 12, y + 20);
    }

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 12, y + 34); ctx.lineTo(x + w - 12, y + 34); ctx.stroke();

    if (isMine) {
      // ── Editable ────────────────────────────────────────────────────────
      const nf      = this._nameField(card);
      const editing = this._editingSlot === mySlotIdx;
      const nfHov   = !editing && this._hit(nf, this._mouse);

      ctx.fillStyle = editing ? 'rgba(140,243,255,0.12)' : nfHov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(nf.x, nf.y, nf.w, nf.h, 5); ctx.fill();
      ctx.strokeStyle = editing ? '#8cf3ff' : nfHov ? 'rgba(140,243,255,0.35)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = editing ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(nf.x, nf.y, nf.w, nf.h, 5); ctx.stroke();

      const cursor = editing && Math.floor(Date.now() / 500) % 2 === 0 ? '│' : '';
      ctx.fillStyle = '#fff';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(slot.name + cursor, nf.x + 8, nf.y + nf.h / 2);

      // Color label
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('COLOR', x + 14, y + 100);

      // Color swatches
      for (let ci = 0; ci < COLORS.length; ci++) {
        const s   = this._colorSwatch(card, ci);
        const sel = slot.colorIdx === ci;
        const sv  = !sel && this._hit(s, this._mouse);

        ctx.globalAlpha = sel ? 1 : 0.6;
        ctx.fillStyle = COLORS[ci];
        ctx.beginPath(); ctx.roundRect(s.x, s.y, s.w, s.h, 5); ctx.fill();
        ctx.globalAlpha = 1;

        if (sel) {
          ctx.strokeStyle = color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6, 8); ctx.stroke();
        } else if (sv) {
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4, 7); ctx.stroke();
        }
      }

      // Color name below swatches
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(COLOR_NAMES[slot.colorIdx], x + w / 2, y + 182);

    } else {
      // ── Read-only remote ─────────────────────────────────────────────────
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
