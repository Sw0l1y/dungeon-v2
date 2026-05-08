import { Scene           } from './Scene.js';
import { LobbyScene      } from './LobbyScene.js';
import { OnlineWaitScene } from './OnlineWaitScene.js';

const CARD_W = 300;
const CARD_H = 210;
const GAP    = 64;

export class ModeSelectScene extends Scene {

  onEnter() {
    this._selected = 0;          // 0 = Local, 1 = Online
    this._mouse    = { x: 0, y: 0 };
    this._pendingClick = null;

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

  // Returns the bounding rect for card at index i
  _cardRect(i) {
    const W  = this.game.canvas.width;
    const H  = this.game.canvas.height;
    const tx = (W - (CARD_W * 2 + GAP)) / 2;
    const ty = H / 2 - CARD_H / 2 + 24;
    return { x: tx + i * (CARD_W + GAP), y: ty, w: CARD_W, h: CARD_H };
  }

  update(_dt) {
    const inp = this.game.input;

    // Keyboard navigation
    if (inp.justPressed('ArrowLeft')  || inp.justPressed('KeyA')) this._selected = 0;
    if (inp.justPressed('ArrowRight') || inp.justPressed('KeyD')) this._selected = 1;

    // Mouse hover — update selected card
    for (let i = 0; i < 2; i++) {
      const r = this._cardRect(i);
      if (this._mouse.x >= r.x && this._mouse.x <= r.x + r.w &&
          this._mouse.y >= r.y && this._mouse.y <= r.y + r.h) {
        this._selected = i;
      }
    }

    // Mouse click
    if (this._pendingClick) {
      const { x, y } = this._pendingClick;
      this._pendingClick = null;
      for (let i = 0; i < 2; i++) {
        const r = this._cardRect(i);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this._confirm(i); return;
        }
      }
    }

    if (inp.justPressed('Enter') || inp.justPressed('Space')) {
      this._confirm(this._selected);
    }
  }

  _confirm(idx) {
    if (idx === 0) this.game.scenes.switch(new LobbyScene(this.game));
    if (idx === 1) this.game.scenes.switch(new OnlineWaitScene(this.game));
  }

  draw(ctx) {
    const { width: W, height: H } = this.game.canvas;
    const t = Date.now();

    ctx.clearRect(0, 0, W, H);

    // ── Title ──────────────────────────────────────────────────────────────────
    ctx.fillStyle    = '#8cf3ff';
    ctx.font         = 'bold 46px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DUNGEON V2', W / 2, H / 2 - 148);

    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font      = '15px "Trebuchet MS", sans-serif';
    ctx.fillText('SELECT MODE', W / 2, H / 2 - 100);

    // ── Mode cards ─────────────────────────────────────────────────────────────
    const modes = [
      {
        label:     'LOCAL PLAY',
        sublabel:  '1 – 2 Players',
        detail:    'Same keyboard · co-op',
        available: true,
      },
      {
        label:     'ONLINE PLAY',
        sublabel:  '2–4 Players',
        detail:    '1–2 per device · over network',
        available: true,
      },
    ];

    for (let i = 0; i < modes.length; i++) {
      const m   = modes[i];
      const r   = this._cardRect(i);
      const sel = this._selected === i && m.available;
      const cx  = r.x + r.w / 2;
      const cy  = r.y + r.h / 2;

      // Card fill
      ctx.fillStyle = sel
        ? 'rgba(140,243,255,0.07)'
        : m.available ? 'rgba(15,28,52,0.75)' : 'rgba(12,18,32,0.6)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 14);
      ctx.fill();

      // Border (pulsing when selected)
      const bAlpha = sel
        ? 0.7 + 0.22 * Math.sin(t / 260)
        : m.available ? 0.22 : 0.1;
      ctx.strokeStyle = sel
        ? `rgba(140,243,255,${bAlpha})`
        : m.available ? 'rgba(140,243,255,0.22)' : 'rgba(120,120,150,0.12)';
      ctx.lineWidth = sel ? 2 : 1.5;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 14);
      ctx.stroke();

      // Selection glow behind card
      if (sel) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, CARD_W * 0.75);
        glow.addColorStop(0,   'rgba(140,243,255,0.07)');
        glow.addColorStop(1,   'rgba(140,243,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(cx, cy, CARD_W * 0.75, CARD_H * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const textAlpha = m.available ? 1 : 0.3;
      ctx.globalAlpha = textAlpha;

      // Main label
      ctx.font         = 'bold 22px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = sel ? '#8cf3ff' : m.available ? 'rgba(255,255,255,0.9)' : 'rgba(180,180,200,0.5)';
      ctx.fillText(m.label, cx, cy - 28);

      // Divider line
      ctx.strokeStyle = sel ? 'rgba(140,243,255,0.35)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(r.x + 32, cy);
      ctx.lineTo(r.x + r.w - 32, cy);
      ctx.stroke();

      // Sublabel
      ctx.font      = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.fillStyle = sel ? 'rgba(200,245,255,0.85)' : 'rgba(200,200,220,0.55)';
      ctx.fillText(m.sublabel, cx, cy + 22);

      // Detail
      ctx.font      = '12px "Trebuchet MS", sans-serif';
      ctx.fillStyle = 'rgba(160,160,180,0.45)';
      ctx.fillText(m.detail, cx, cy + 46);

      ctx.globalAlpha = 1;
    }

    // ── Bottom hint ────────────────────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.2)';
    ctx.font         = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('← → to navigate  ·  ENTER to confirm', W / 2, H - 22);
  }
}
