import { Scene       } from './Scene.js';
import { TitleScene  } from './TitleScene.js';
import { ClassScene  } from './ClassScene.js';

export class DeathScene extends Scene {

  onEnter() {
    this._mouse        = { x: 0, y: 0 };
    this._pendingClick = null;

    const net  = this.game.state.netSession ?? null;
    const role = this.game.state.netRole    ?? null;
    this._isOnline  = !!net;
    this._isClient  = role === 'client';

    // Client waits for the host to choose an action
    if (net && this._isClient) {
      net.onMessage = (data) => {
        if (data.t === 'deathAction') {
          if (data.a === 'retry') this._doRetry();
          else if (data.a === 'menu') this._doMenu();
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

  update(_dt) {
    // Online client: discard clicks — actions come from the host via net messages
    if (this._isClient) { this._pendingClick = null; return; }

    if (!this._pendingClick) return;
    const { x, y } = this._pendingClick;
    this._pendingClick = null;

    if (this._hit(this._retryBtn(), x, y)) {
      this.game.state.netSession?.send({ t: 'deathAction', a: 'retry' });
      this._doRetry();
    } else if (this._hit(this._menuBtn(), x, y)) {
      this.game.state.netSession?.send({ t: 'deathAction', a: 'menu' });
      this._doMenu();
    }
  }

  _doRetry() {
    // Return to class selection so both devices re-pick
    this.game.scenes.switch(new ClassScene(this.game));
  }

  _doMenu() {
    this.game.state.netSession?.close();
    this.game.state = {};
    this.game.scenes.switch(new TitleScene(this.game));
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, W, H);

    // YOU DIED
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e03030';
    ctx.font = 'bold 72px "Trebuchet MS", sans-serif';
    ctx.fillText('YOU DIED', W / 2, H / 2 - 80);

    // Buttons — greyed out for client (host controls)
    ctx.globalAlpha = this._isClient ? 0.35 : 1;
    this._drawBtn(ctx, this._retryBtn(), 'Play Again');
    this._drawBtn(ctx, this._menuBtn(),  'Main Menu');
    ctx.globalAlpha = 1;

    // Client hint
    if (this._isClient) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for host…', W / 2, this._menuBtn().y + this._menuBtn().h + 26);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  _retryBtn() {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    return { x: W / 2 - 110, y: H / 2 + 10, w: 220, h: 48 };
  }

  _menuBtn() {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    return { x: W / 2 - 110, y: H / 2 + 74, w: 220, h: 48 };
  }

  _drawBtn(ctx, { x, y, w, h }, label) {
    const hov = !this._isClient && this._hit({ x, y, w, h }, this._mouse.x, this._mouse.y);
    ctx.fillStyle = hov ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  _hit({ x, y, w, h }, px, py) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }
}
