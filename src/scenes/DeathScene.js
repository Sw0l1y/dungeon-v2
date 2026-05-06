import { Scene } from './Scene.js';
import { TitleScene } from './TitleScene.js';

export class DeathScene extends Scene {
  onEnter() {
    this._pendingClick = null;
    this._onMouseDown = (e) => {
      const rect = this.game.canvas.getBoundingClientRect();
      const sx = this.game.canvas.width  / rect.width;
      const sy = this.game.canvas.height / rect.height;
      this._pendingClick = {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top)  * sy,
      };
    };
    this.game.canvas.addEventListener('mousedown', this._onMouseDown);
  }

  onExit() {
    this.game.canvas.removeEventListener('mousedown', this._onMouseDown);
  }

  update(_dt) {
    if (!this._pendingClick) return;
    const { x, y } = this._pendingClick;
    this._pendingClick = null;

    if (this._hit(this._retryBtn(), x, y)) {
      import('./GameScene.js').then(({ GameScene }) => {
        this.game.scenes.switch(new GameScene(this.game));
      });
    } else if (this._hit(this._menuBtn(), x, y)) {
      this.game.state = {};
      this.game.scenes.switch(new TitleScene(this.game));
    }
  }

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

    this._drawBtn(ctx, this._retryBtn(), 'Play Again');
    this._drawBtn(ctx, this._menuBtn(), 'Main Menu');
  }

  _retryBtn() {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    return { x: W / 2 - 110, y: H / 2 + 10, w: 220, h: 48 };
  }

  _menuBtn() {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    return { x: W / 2 - 110, y: H / 2 + 74, w: 220, h: 48 };
  }

  _drawBtn(ctx, { x, y, w, h }, label) {
    const hover = this._pendingClick === null && this._isHovering({ x, y, w, h });
    ctx.fillStyle = hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  _hit({ x, y, w, h }, px, py) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  _isHovering({ x, y, w, h }) {
    const m = this._mouse;
    if (!m) return false;
    return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
  }
}
