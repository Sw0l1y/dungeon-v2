import { Scene } from './Scene.js';
import { Camera } from '../systems/Camera.js';
import { Level1 } from '../levels/Level1.js';
import { WaveManager } from '../systems/WaveManager.js';
import { DeathScene } from './DeathScene.js';
import { PauseScene } from './PauseScene.js';

export class GameScene extends Scene {
  onEnter() {
    this.level  = new Level1(this.game);
    this.camera = new Camera(this.game.canvas.width, this.game.canvas.height);
    this.level.onEnter();
    this.waves  = new WaveManager(this.level);

    // Init run stats (reset each new game)
    this.game.state.stats = { enemiesKilled: 0, timeElapsed: 0 };
  }

  onExit() {
    this.level.onExit();
  }

  update(dt) {
    // Pause
    if (this.game.input.justPressed('Escape')) {
      this.game.scenes.push(new PauseScene(this.game, this));
      return;
    }

    this.game.state.stats.timeElapsed += dt;
    this.level.update(dt);
    this.waves.update();

    if (this.game.input.justPressed('KeyV') && !this.waves.active && !this.waves.bossDefeated) {
      this.waves.startWave();
    }

    const ps = this.level.players;

    // Revive interactions — each alive player checks their interact key
    for (const reviver of ps) {
      if (!reviver.alive) continue;
      if (!reviver.binding.justPressed('interact')) continue;
      for (const downed of ps) {
        if (!downed._downed || downed === reviver) continue;
        if (Math.hypot(downed.x - reviver.x, downed.y - reviver.y) <= 70) {
          downed.revive();
          break;
        }
      }
    }

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

    // Top-center: revive prompt for alive players near a downed ally
    const REVIVE_RANGE = 70;
    let revivePrompt = null;
    for (const reviver of this.level.players) {
      if (!reviver.alive) continue;
      for (const downed of this.level.players) {
        if (!downed._downed || downed === reviver) continue;
        if (Math.hypot(downed.x - reviver.x, downed.y - reviver.y) <= REVIVE_RANGE) {
          const code  = reviver.binding._bindings?.interact ?? '';
          const label = code === 'KeyE' ? 'E' : code === 'KeyO' ? 'O' : '?';
          revivePrompt = { label, name: downed.name, color: reviver.color };
        }
      }
    }
    if (revivePrompt) {
      const pa = 0.75 + 0.2 * Math.sin(Date.now() / 180);
      ctx.save();
      ctx.globalAlpha = pa;
      ctx.fillStyle = revivePrompt.color;
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`[ ${revivePrompt.label} ]  Revive ${revivePrompt.name}`, W / 2, 42);
      ctx.restore();
    }

    // Bottom-center: wave prompt or status
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    if (!this.waves.active) {
      // Pulsing prompt
      const alpha = 0.45 + 0.25 * Math.sin(Date.now() / 500);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.font = '15px "Trebuchet MS", sans-serif';
      ctx.fillText('V  —  start wave', W / 2, H - 16);
    } else if (this.waves.bossDefeated) {
      ctx.fillStyle = '#ffe566';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText('Boss Defeated!', W / 2, H - 16);
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
