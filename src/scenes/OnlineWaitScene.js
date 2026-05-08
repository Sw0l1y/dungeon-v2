import { Scene            } from './Scene.js';
import { OnlineLobbyScene } from './OnlineLobbyScene.js';
import { TitleScene       } from './TitleScene.js';
import { NetSession       } from '../systems/NetSession.js';

// Letters only — no ambiguous 0/O, 1/I/L
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  return c;
}

export class OnlineWaitScene extends Scene {

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    // Only two phases: 'pick' (HOST / JOIN) and 'joining' (entering the 4-char code)
    this._phase = 'pick';
    this._typed = '';

    this._mouse        = { x: 0, y: 0 };
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
    this._onKeyDown = (ev) => this._handleKey(ev);

    this.game.canvas.addEventListener('mousemove', this._onMouseMove);
    this.game.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('keydown', this._onKeyDown);
  }

  onExit() {
    this.game.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.game.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _handleKey(ev) {
    if (ev.key === 'Escape') {
      if (this._phase === 'joining') { this._phase = 'pick'; this._typed = ''; }
      else { this.game.scenes.switch(new TitleScene(this.game)); }
      return;
    }
    if (this._phase === 'joining') {
      if (ev.key === 'Backspace') { this._typed = this._typed.slice(0, -1); return; }
      const ch = ev.key.toUpperCase();
      if (CHARSET.includes(ch) && this._typed.length < 4) {
        this._typed += ch;
        if (this._typed.length === 4) this._startJoin(this._typed);
      }
    }
  }

  update(_dt) {
    const click = this._pendingClick;
    this._pendingClick = null;
    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;

    if (this._phase === 'pick') {
      if (this._hit({ x: W / 2 - 210, y: H / 2 - 40, w: 190, h: 80 }, pt)) {
        this._startHost(); return;
      }
      if (this._hit({ x: W / 2 + 20, y: H / 2 - 40, w: 190, h: 80 }, pt)) {
        this._phase = 'joining'; this._typed = '';
      }
    }
  }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  // HOST: create session and go straight to the lobby grid
  _startHost() {
    const code = makeCode();
    const net  = new NetSession();
    this.game.state.netSession = net;
    this.game.state.netRole    = 'host';
    this.game.state.netCode    = code;
    net.host(code);
    this.game.scenes.switch(new OnlineLobbyScene(this.game));
  }

  // JOIN: create session and go straight to the lobby grid (connecting state shown there)
  _startJoin(code) {
    const net = new NetSession();
    this.game.state.netSession = net;
    this.game.state.netRole    = 'client';
    this.game.state.netCode    = code;
    net.join(code);
    this.game.scenes.switch(new OnlineLobbyScene(this.game));
  }

  // ── Draw ───────────────────────────────────────────────────────────────────

  draw(ctx) {
    const { width: W, height: H } = this.game.canvas;
    const t = Date.now();
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle    = '#8cf3ff';
    ctx.font         = 'bold 42px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ONLINE PLAY', W / 2, 66);

    if (this._phase === 'pick') this._drawPick(ctx, W, H);
    else                        this._drawJoining(ctx, W, H, t);
  }

  _drawPick(ctx, W, H) {
    const btns = [
      { x: W / 2 - 210, label: 'HOST', sub: 'Create a room' },
      { x: W / 2 + 20,  label: 'JOIN', sub: 'Enter room code' },
    ];
    for (const b of btns) {
      const r   = { x: b.x, y: H / 2 - 40, w: 190, h: 80 };
      const hov = this._hit(r, this._mouse);
      ctx.fillStyle = hov ? 'rgba(140,243,255,0.14)' : 'rgba(15,28,52,0.7)';
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.fill();
      ctx.strokeStyle = hov ? '#8cf3ff' : 'rgba(140,243,255,0.25)';
      ctx.lineWidth = hov ? 2 : 1.5;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.stroke();
      ctx.fillStyle = hov ? '#8cf3ff' : 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 22px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 - 10);
      ctx.fillStyle = 'rgba(200,200,220,0.45)';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.fillText(b.sub, r.x + r.w / 2, r.y + r.h / 2 + 14);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('1–2 players per device  ·  2–4 players total', W / 2, H / 2 + 68);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ESC  ·  back to title', W / 2, H - 22);
  }

  _drawJoining(ctx, W, H, t) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '16px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Enter room code', W / 2, H / 2 - 70);

    const boxW = 58, boxH = 72, gap = 16;
    const totalW = boxW * 4 + gap * 3;
    const bx = W / 2 - totalW / 2;
    const by = H / 2 - boxH / 2 - 10;

    for (let i = 0; i < 4; i++) {
      const rx     = bx + i * (boxW + gap);
      const filled = i < this._typed.length;
      const active = i === this._typed.length;
      const cursor = active && Math.floor(t / 500) % 2 === 0;
      ctx.fillStyle = filled ? 'rgba(140,243,255,0.12)' : active ? 'rgba(140,243,255,0.06)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.roundRect(rx, by, boxW, boxH, 8); ctx.fill();
      ctx.strokeStyle = active ? '#8cf3ff' : filled ? 'rgba(140,243,255,0.35)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(rx, by, boxW, boxH, 8); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px "Trebuchet MS", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(filled ? this._typed[i] : (cursor ? '|' : ''), rx + boxW / 2, by + boxH / 2);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('Type the 4-letter code  ·  ESC to go back', W / 2, H - 22);
  }
}
