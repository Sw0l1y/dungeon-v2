import { Scene } from './Scene.js';
import { Camera } from '../systems/Camera.js';
import { Level1 } from '../levels/Level1.js';
import { WaveManager } from '../systems/WaveManager.js';
import { DeathScene } from './DeathScene.js';

export class GameScene extends Scene {
  onEnter() {
    this.level  = new Level1(this.game);
    this.camera = new Camera(this.game.canvas.width, this.game.canvas.height);
    this.level.onEnter();
    this.waves  = new WaveManager(this.level);

    this._canvasMouse = { x: 0, y: 0 };
    this._onMouseMove = (e) => {
      const rect = this.game.canvas.getBoundingClientRect();
      const sx = this.game.canvas.width  / rect.width;
      const sy = this.game.canvas.height / rect.height;
      this._canvasMouse.x = (e.clientX - rect.left) * sx;
      this._canvasMouse.y = (e.clientY - rect.top)  * sy;
    };
    this.game.canvas.addEventListener('mousemove', this._onMouseMove);
  }

  onExit() {
    this.level.onExit();
    this.game.canvas.removeEventListener('mousemove', this._onMouseMove);
  }

  update(dt) {
    this.level.update(dt);
    this.waves.update();

    if (this.game.input.justPressed('KeyV') && !this.waves.active) {
      this.waves.startWave();
    }

    // Update world-space mouse position for archer aiming
    this.level.mouseWorld = this.camera.screenToWorld(
      this._canvasMouse.x, this._canvasMouse.y
    );

    const ps = this.level.players;
    if (ps.length > 0 && ps.every(p => !p.alive)) {
      this.game.scenes.switch(new DeathScene(this.game));
      return;
    }
    if (ps.length > 0) {
      const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
      const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      this.camera.follow(cx, cy, dt);
      this.camera.clamp(this.level.worldWidth, this.level.worldHeight);
    }
  }

  draw(ctx) {
    const { width, height } = this.game.canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    this.camera.applyTransform(ctx);
    this.level.draw(ctx);
    ctx.restore();

    this._drawHud(ctx);
  }

  _drawHud(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;

    // Top-left: level name
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.level.name, 16, 16);

    // Bottom-center: wave prompt or status
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    if (!this.waves.active) {
      // Pulsing prompt
      const alpha = 0.45 + 0.25 * Math.sin(Date.now() / 500);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = '15px "Trebuchet MS", sans-serif';
      ctx.fillText('V  —  start wave', W / 2, H - 16);
    } else {
      const rem = this.waves.remaining;
      ctx.fillStyle = rem > 0 ? '#ff7070' : '#a8ff78';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      const label = rem > 0
        ? `Wave ${this.waves.wave}  •  ${rem} enem${rem === 1 ? 'y' : 'ies'} left`
        : `Wave ${this.waves.wave} cleared!  —  V for next wave`;
      ctx.fillText(label, W / 2, H - 16);
    }
  }
}
