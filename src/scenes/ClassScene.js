import { Scene            } from './Scene.js';
import { GameScene        } from './GameScene.js';
import { LobbyScene       } from './LobbyScene.js';
import { OnlineLobbyScene } from './OnlineLobbyScene.js';

const CLASSES = [
  {
    id:   'sword',
    name: 'Sword',
    lines: ['Wide melee swing', 'High damage, short range'],
    key:  'Space  /  Enter',
  },
  {
    id:   'archer',
    name: 'Archer',
    lines: ['Fast projectile', 'Auto-aims nearest enemy'],
    key:  'Space  /  Enter',
  },
  {
    id:   'rogue',
    name: 'Rogue',
    lines: ['Dash through enemies', 'Invincible during dash'],
    key:  'Space  /  Enter',
  },
];

const CARD_W   = 180;
const CARD_H   = 200;
const CARD_GAP = 20;

export class ClassScene extends Scene {

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    const allPlayers = this.game.state.players;
    const net        = this.game.state.netSession ?? null;
    const role       = this.game.state.netRole    ?? null;

    // All players start with no selection — everyone must explicitly pick a class.
    this._selections = allPlayers.map(() => null);

    // Which player indices belong to this device vs. the other device
    this._localIdxs  = allPlayers.map((p, i) => i).filter(i => !allPlayers[i].remote);
    this._remoteIdxs = allPlayers.map((p, i) => i).filter(i =>  allPlayers[i].remote);

    this._mouse        = { x: 0, y: 0 };
    this._pendingClick = null;

    // ── Net message handlers ───────────────────────────────────────────────
    if (net) {
      net.onMessage = (data) => {
        // Other device broadcasting their current picks
        if (data.t === 'classSync' && data.s) {
          for (const [idxStr, clsId] of Object.entries(data.s)) {
            const idx = parseInt(idxStr, 10);
            // Only update indices owned by the remote device
            if (this._remoteIdxs.includes(idx)) this._selections[idx] = clsId;
          }
        }
        // Host launching — carries the full authoritative selection map
        if (data.t === 'start' && data.s) {
          for (const [idxStr, clsId] of Object.entries(data.s)) {
            this._selections[parseInt(idxStr, 10)] = clsId;
          }
          this._finalize();
        }
      };
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
  }

  // ── layout ─────────────────────────────────────────────────────────────────

  // sectionIdx = 0,1 — position within the local-players display strip
  _classCard(sectionIdx, classIdx) {
    const W  = this.game.canvas.width;
    const n  = this._localIdxs.length;
    const sectionW  = n === 1 ? W : W / n;
    const sectionCX = sectionIdx * sectionW + sectionW / 2;
    const nc  = CLASSES.length;
    const cw  = Math.min(CARD_W, Math.floor((sectionW - 40 - CARD_GAP * (nc - 1)) / nc));
    const totalW = cw * nc + CARD_GAP * (nc - 1);
    const startX = sectionCX - totalW / 2;
    return { x: startX + classIdx * (cw + CARD_GAP), y: 190, w: cw, h: CARD_H };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    return { x: W / 2 - 110, y: 430, w: 220, h: 48 };
  }

  _backBtn() {
    return { x: 20, y: 16, w: 110, h: 36 };
  }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  // All players (local AND remote) have a non-null selection
  get _allSelected() {
    return this._selections.every(s => s !== null);
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(_dt) {
    const click   = this._pendingClick;
    this._pendingClick = null;

    const role     = this.game.state.netRole ?? null;
    const isClient = role === 'client';

    if (this.game.input.justPressed('Escape')) { this._goBack(); return; }

    // Host / local: Enter confirms when all selected
    if (!isClient && this._allSelected && this.game.input.justPressed('Enter')) {
      this._launch(); return;
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    const role     = this.game.state.netRole ?? null;
    const isClient = role === 'client';

    if (this._hit(this._backBtn(), pt)) { this._goBack(); return; }

    // START button — only host / local can press it
    if (!isClient && this._allSelected && this._hit(this._startBtn(), pt)) {
      this._launch(); return;
    }

    // Class card clicks — iterate local players by their section index
    this._localIdxs.forEach((playerGlobalIdx, sectionIdx) => {
      CLASSES.forEach((cls, cIdx) => {
        if (this._hit(this._classCard(sectionIdx, cIdx), pt)) {
          // Locked if ANY player (local or remote) already chose this class
          const takenByAny = this._selections.some(
            (sel, gi) => gi !== playerGlobalIdx && sel === cls.id,
          );
          if (!takenByAny) {
            this._selections[playerGlobalIdx] = cls.id;
            this._broadcastSelections();
          }
        }
      });
    });
  }

  // ── net sync ───────────────────────────────────────────────────────────────

  // Send this device's current picks to the other device
  _broadcastSelections() {
    const net = this.game.state.netSession ?? null;
    if (!net) return;
    const s = {};
    for (const gi of this._localIdxs) {
      if (this._selections[gi] !== null) s[gi] = this._selections[gi];
    }
    net.send({ t: 'classSync', s });
  }

  // ── launch ────────────────────────────────────────────────────────────────

  _launch() {
    const net  = this.game.state.netSession ?? null;
    const role = this.game.state.netRole    ?? null;

    if (role === 'host') {
      // Build the authoritative final map (fill any un-picked remotes with 'sword')
      const s = {};
      for (let i = 0; i < this._selections.length; i++) {
        s[i] = this._selections[i] ?? 'sword';
      }
      net?.send({ t: 'start', s });
    }

    this._finalize();
  }

  _goBack() {
    const role = this.game.state.netRole ?? null;
    if (role === 'host' || role === 'client') {
      this.game.scenes.switch(new OnlineLobbyScene(this.game));
    } else {
      this.game.scenes.switch(new LobbyScene(this.game));
    }
  }

  _finalize() {
    this.game.state.players = this.game.state.players.map((p, i) => ({
      ...p,
      classId: this._selections[i] ?? 'sword',
    }));
    this.game.state.roomIndex = 0;  // always start campaign from room 0
    this.game.scenes.switch(new GameScene(this.game));
  }

  // ── draw ──────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // ── Back button ────────────────────────────────────────────────────────────
    const backBtn   = this._backBtn();
    const backHover = this._hit(backBtn, this._mouse);
    ctx.fillStyle   = backHover ? 'rgba(140,243,255,0.10)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h, 6); ctx.fill();
    ctx.strokeStyle = backHover ? 'rgba(140,243,255,0.50)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth   = backHover ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h, 6); ctx.stroke();
    ctx.fillStyle   = backHover ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
    ctx.font        = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('← Back', backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);

    // ── Title ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SELECT CLASS', W / 2, 56);

    const allPlayers    = this.game.state.players;
    const n             = this._localIdxs.length;
    const role          = this.game.state.netRole ?? null;
    const isClient      = role === 'client';

    // Section dividers for multi-player
    if (n >= 2) {
      for (let s = 1; s < n; s++) {
        const lx = (W / n) * s;
        ctx.strokeStyle = 'rgba(140,243,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, 90); ctx.lineTo(lx, H - 60); ctx.stroke();
      }
    }

    // Draw each local player's section
    this._localIdxs.forEach((globalIdx, sectionIdx) => {
      const p        = allPlayers[globalIdx];
      const sectionW = n === 1 ? W : W / n;
      const sectionCX = sectionIdx * sectionW + sectionW / 2;

      // Player label
      ctx.fillStyle = p.color;
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.name, sectionCX, 130);

      // Selection state hint
      if (this._selections[globalIdx] === null) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '13px "Trebuchet MS", sans-serif';
        ctx.fillText('click to choose', sectionCX, 155);
      } else {
        const chosen = CLASSES.find(c => c.id === this._selections[globalIdx]);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '13px "Trebuchet MS", sans-serif';
        ctx.fillText(`✓ ${chosen.name} selected`, sectionCX, 155);
      }

      // Class cards
      CLASSES.forEach((cls, cIdx) => {
        const card     = this._classCard(sectionIdx, cIdx);
        const selected = this._selections[globalIdx] === cls.id;
        // Locked if any other player (local or remote) already chose this class
        const locked   = this._selections.some(
          (sel, gi) => gi !== globalIdx && sel === cls.id,
        );
        const hovered  = !locked && this._hit(card, this._mouse);
        this._drawClassCard(ctx, card, cls, p.color, selected, hovered, locked);
      });
    });

    // START / waiting hint
    const canStart = this._allSelected;
    if (isClient) {
      // Client: show status instead of START button
      ctx.fillStyle = canStart ? 'rgba(140,243,255,0.55)' : 'rgba(255,255,255,0.3)';
      ctx.font = canStart ? 'bold 16px "Trebuchet MS", sans-serif' : '15px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(
        canStart ? 'Waiting for host to start...' : 'Select your class',
        W / 2, 454,
      );
    } else {
      // Host or local: draw START button
      const startBtn   = this._startBtn();
      const startHover = canStart && this._hit(startBtn, this._mouse);
      ctx.fillStyle = canStart
        ? (startHover ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)')
        : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(startBtn.x, startBtn.y, startBtn.w, startBtn.h, 8); ctx.fill();
      ctx.strokeStyle = canStart
        ? (startHover ? '#8cf3ff' : 'rgba(140,243,255,0.3)')
        : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = canStart && startHover ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(startBtn.x, startBtn.y, startBtn.w, startBtn.h, 8); ctx.stroke();
      ctx.fillStyle = canStart ? (startHover ? '#8cf3ff' : 'rgba(255,255,255,0.6)') : 'rgba(255,255,255,0.2)';
      ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('START GAME', startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);
    }

    // Bottom hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const localDone  = this._localIdxs.every(i => this._selections[i] !== null);
    const remoteDone = this._remoteIdxs.every(i => this._selections[i] !== null);
    const hint = isClient
      ? 'Select a class for each of your players'
      : canStart
        ? 'Click START or press Enter'
        : (!localDone ? 'All local players must select a class' : 'Waiting for other players to choose…');
    ctx.fillText(hint, W / 2, H - 16);
  }

  _drawClassCard(ctx, card, cls, playerColor, selected, hovered, locked = false) {
    const { x, y, w, h } = card;

    ctx.fillStyle = locked
      ? 'rgba(255,255,255,0.02)'
      : selected ? 'rgba(140,243,255,0.13)'
      : hovered  ? 'rgba(140,243,255,0.07)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();

    ctx.strokeStyle = locked
      ? 'rgba(255,255,255,0.06)'
      : selected ? playerColor : hovered ? 'rgba(140,243,255,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = (!locked && (selected || hovered)) ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    ctx.save();
    if (locked) ctx.globalAlpha = 0.25;

    ctx.fillStyle = selected ? playerColor : hovered ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cls.name.toUpperCase(), x + w / 2, y + 36);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    cls.lines.forEach((line, i) => {
      ctx.fillText(line, x + w / 2, y + 80 + i * 20);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('ATTACK', x + w / 2, y + h - 36);
    ctx.fillStyle = selected ? playerColor : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.fillText(cls.key, x + w / 2, y + h - 20);

    ctx.restore();

    if (locked) {
      ctx.fillStyle = 'rgba(255,80,80,0.65)';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TAKEN', x + w / 2, y + h / 2);
    }
  }
}
