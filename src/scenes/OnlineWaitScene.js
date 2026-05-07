import { Scene         } from './Scene.js';
import { ClassScene    } from './ClassScene.js';
import { NetSession    } from '../systems/NetSession.js';
import { RemoteBinding } from '../systems/RemoteBinding.js';

// Charset with no ambiguous characters (0/O, 1/I/L)
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  return c;
}

export class OnlineWaitScene extends Scene {

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    // pick → hosting (connecting to server) → waiting_host (ready, showing code)
    //      → connected (peer joined) → [host presses ENTER] → launch
    // pick → joining (entering code) → hosting (connecting) → waiting_start → launch
    this._phase        = 'pick';
    this._code         = '';
    this._typed        = '';
    this._error        = '';
    this._net          = null;
    this._copyFeedback = 0;   // seconds remaining to show "Copied!" flash

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
    this._net?.close();
    this._net = null;
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _handleKey(ev) {
    if (ev.key === 'Escape' && this._phase !== 'pick') {
      this._reset(); return;
    }

    if (this._phase === 'joining') {
      if (ev.key === 'Backspace') { this._typed = this._typed.slice(0, -1); return; }
      const ch = ev.key.toUpperCase();
      if (CHARSET.includes(ch) && this._typed.length < 4) {
        this._typed += ch;
        if (this._typed.length === 4) this._startJoin(this._typed);
      }
    }

    if (this._phase === 'connected' && (ev.key === 'Enter' || ev.key === ' ')) {
      this._hostLaunch();
    }
  }

  update(dt) {
    if (this._copyFeedback > 0) this._copyFeedback -= dt;
    const click = this._pendingClick;
    this._pendingClick = null;
    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;

    if (this._phase === 'pick') {
      if (this._hit({ x: W / 2 - 210, y: H / 2 - 40, w: 190, h: 80 }, pt)) this._startHost();
      if (this._hit({ x: W / 2 + 20,  y: H / 2 - 40, w: 190, h: 80 }, pt)) {
        this._phase = 'joining'; this._typed = '';
      }
    }

    if (this._phase === 'connected' && this._net?.role === 'host') {
      if (this._hit({ x: W / 2 - 100, y: H / 2 + 60, w: 200, h: 48 }, pt)) this._hostLaunch();
    }

    // Copy code button (waiting_host phase)
    if (this._phase === 'waiting_host') {
      const btn = this._copyCodeBtn(W, H);
      if (this._hit(btn, pt)) {
        navigator.clipboard?.writeText(this._code).catch(() => {});
        this._copyFeedback = 1.6;
      }
    }

    // Back button — all non-pick phases except joining (ESC only there)
    if (this._phase !== 'pick' && this._phase !== 'joining') {
      if (this._hit({ x: W / 2 - 70, y: H - 70, w: 140, h: 36 }, pt)) this._reset();
    }
  }

  // Returns the bounding rect for the copy-code button
  _copyCodeBtn(W, H) {
    const boxH = 80;
    const by   = H / 2 - boxH / 2 - 10;
    return { x: W / 2 - 70, y: by + boxH + 50, w: 140, h: 34 };
  }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  // ── State transitions ──────────────────────────────────────────────────────

  _reset() {
    this._net?.close();
    this._net = null;
    this._phase = 'pick';
    this._typed = this._code = this._error = '';
  }

  _startHost() {
    this._code  = makeCode();
    this._phase = 'hosting';   // "Connecting to server..."
    this._net   = new NetSession();
    this._net.onWaiting      = () => { this._phase = 'waiting_host'; };   // server confirmed — now show code
    this._net.onConnected    = () => { this._phase = 'connected'; };
    this._net.onMessage      = (d) => { if (d.t === 'start') this._launch('client'); };
    this._net.onDisconnected = () => { this._error = 'Player disconnected'; this._phase = 'error'; };
    this._net.onError        = (m) => { this._error = m;                    this._phase = 'error'; };
    this._net.host(this._code);
  }

  _startJoin(code) {
    this._code  = code;
    this._phase = 'hosting';   // "Connecting to server..."
    this._net   = new NetSession();
    this._net.onConnected    = () => { this._phase = 'waiting_start'; };
    this._net.onMessage      = (d) => { if (d.t === 'start') this._launch('client'); };
    this._net.onDisconnected = () => { this._error = 'Host disconnected'; this._phase = 'error'; };
    this._net.onError        = (m) => { this._error = m;                  this._phase = 'error'; };
    this._net.join(code);
  }

  _hostLaunch() {
    this._net?.send({ t: 'start' });
    this._launch('host');
  }

  _launch(role) {
    const net = this._net;
    this._net = null;  // prevent onExit from closing it

    // Two remote bindings — one per remote player
    const rb1 = new RemoteBinding();
    const rb2 = new RemoteBinding();

    // Players 0-1 are the host's two local players.
    // Players 2-3 are the client's two local players.
    // remote:true marks the players driven by RemoteBinding — ClassScene skips them.
    if (role === 'host') {
      this.game.state.players = [
        { name: 'P1', color: '#8cf3ff', binding: this.game.bindings.player1 },
        { name: 'P2', color: '#ff8c42', binding: this.game.bindings.player2 },
        { name: 'P3', color: '#a8ff78', binding: rb1, remote: true, classId: 'sword' },
        { name: 'P4', color: '#ff6b9d', binding: rb2, remote: true, classId: 'sword' },
      ];
    } else {
      this.game.state.players = [
        { name: 'P1', color: '#8cf3ff', binding: rb1, remote: true, classId: 'sword' },
        { name: 'P2', color: '#ff8c42', binding: rb2, remote: true, classId: 'sword' },
        { name: 'P3', color: '#a8ff78', binding: this.game.bindings.player1 },
        { name: 'P4', color: '#ff6b9d', binding: this.game.bindings.player2 },
      ];
    }

    this.game.state.netSession      = net;
    this.game.state.netRole         = role;
    this.game.state.remoteBindings  = [rb1, rb2];

    // ClassScene handles class selection for local players only, then launches GameScene
    this.game.scenes.switch(new ClassScene(this.game));
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

    switch (this._phase) {
      case 'pick':         this._drawPick(ctx, W, H);            break;
      case 'hosting':      this._drawConnecting(ctx, W, H, t);   break;
      case 'waiting_host': this._drawWaitingHost(ctx, W, H, t);  break;
      case 'joining':      this._drawJoining(ctx, W, H, t);      break;
      case 'connected':    this._drawConnected(ctx, W, H, t);    break;
      case 'waiting_start':this._drawWaitStart(ctx, W, H, t);    break;
      case 'error':        this._drawError(ctx, W, H);           break;
    }

    if (this._phase !== 'pick' && this._phase !== 'joining') {
      this._drawBackBtn(ctx, W, H);
    }
  }

  _drawPick(ctx, W, H) {
    const btns = [
      { x: W / 2 - 210, label: 'HOST', sub: 'Create a room' },
      { x: W / 2 + 20,  label: 'JOIN', sub: 'Enter room code' },
    ];
    for (const b of btns) {
      const r = { x: b.x, y: H / 2 - 40, w: 190, h: 80 };
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
    ctx.fillText('2 players per device  ·  4 players total', W / 2, H / 2 + 68);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('ESC  ·  back', W / 2, H - 22);
  }

  // Briefly shown while the WebSocket is connecting (~<1s typically)
  _drawConnecting(ctx, W, H, t) {
    const spin = ((t / 1000) * Math.PI * 2) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,243,255,0.6)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 - 40, 20, spin, spin + Math.PI * 1.4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Connecting to server...', W / 2, H / 2 + 10);
  }

  // Shown once the signaling server confirms our host role — show the room code
  _drawWaitingHost(ctx, W, H, t) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for player...', W / 2, H / 2 - 80);

    // Big code display
    const code = this._code;
    const boxW = 64, boxH = 80, gap = 12;
    const totalW = boxW * 4 + gap * 3;
    const bx = W / 2 - totalW / 2;
    const by = H / 2 - boxH / 2 - 10;
    const pulse = 0.18 + 0.08 * Math.sin(t / 400);

    for (let i = 0; i < 4; i++) {
      const rx = bx + i * (boxW + gap);
      ctx.fillStyle = `rgba(140,243,255,${pulse})`;
      ctx.beginPath(); ctx.roundRect(rx, by, boxW, boxH, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(140,243,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(rx, by, boxW, boxH, 10); ctx.stroke();
      ctx.fillStyle = '#8cf3ff';
      ctx.font = 'bold 36px "Trebuchet MS", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(code[i] ?? '', rx + boxW / 2, by + boxH / 2);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Share this code with the other device', W / 2, by + boxH + 24);

    // Copy code button
    const cpBtn = this._copyCodeBtn(W, H);
    const copied = this._copyFeedback > 0;
    const cpHov  = !copied && this._hit(cpBtn, this._mouse);
    ctx.fillStyle = copied
      ? 'rgba(100,255,140,0.18)'
      : cpHov ? 'rgba(140,243,255,0.18)' : 'rgba(140,243,255,0.07)';
    ctx.beginPath(); ctx.roundRect(cpBtn.x, cpBtn.y, cpBtn.w, cpBtn.h, 7); ctx.fill();
    ctx.strokeStyle = copied
      ? 'rgba(100,255,140,0.55)'
      : cpHov ? '#8cf3ff' : 'rgba(140,243,255,0.3)';
    ctx.lineWidth = cpHov || copied ? 1.5 : 1;
    ctx.beginPath(); ctx.roundRect(cpBtn.x, cpBtn.y, cpBtn.w, cpBtn.h, 7); ctx.stroke();
    ctx.fillStyle = copied ? 'rgba(100,255,160,0.9)' : cpHov ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(copied ? '✓ Copied!' : 'COPY CODE', cpBtn.x + cpBtn.w / 2, cpBtn.y + cpBtn.h / 2);
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
      const rx = bx + i * (boxW + gap);
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

  _drawConnected(ctx, W, H, t) {
    const a = 0.7 + 0.25 * Math.sin(t / 220);
    ctx.fillStyle = `rgba(140,243,255,${a})`;
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('● Player connected', W / 2, H / 2 - 38);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.fillText('Room  ' + this._code, W / 2, H / 2 - 8);

    const btn = { x: W / 2 - 100, y: H / 2 + 40, w: 200, h: 48 };
    const hov = this._hit(btn, this._mouse);
    ctx.fillStyle = hov ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hov ? '#8cf3ff' : 'rgba(140,243,255,0.3)';
    ctx.lineWidth = hov ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = hov ? '#8cf3ff' : 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.fillText('START  →', btn.x + btn.w / 2, btn.y + btn.h / 2);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('or press  Enter', W / 2, btn.y + btn.h + 20);
  }

  _drawWaitStart(ctx, W, H, t) {
    const a = 0.6 + 0.28 * Math.sin(t / 300);
    ctx.fillStyle = `rgba(140,243,255,${a})`;
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('● Connected', W / 2, H / 2 - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.fillText('Waiting for host to start...', W / 2, H / 2 + 20);
  }

  _drawError(ctx, W, H) {
    ctx.fillStyle = '#ff7070';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Connection error', W / 2, H / 2 - 20);
    ctx.fillStyle = 'rgba(255,150,150,0.7)';
    ctx.font = '14px "Trebuchet MS", sans-serif';
    ctx.fillText(this._error, W / 2, H / 2 + 14);
  }

  _drawBackBtn(ctx, W, H) {
    const btn = { x: W / 2 - 70, y: H - 70, w: 140, h: 36 };
    const hov = this._hit(btn, this._mouse);
    ctx.fillStyle = hov ? 'rgba(255,255,255,0.1)' : 'transparent';
    ctx.strokeStyle = hov ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('← Back  (ESC)', btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
}
