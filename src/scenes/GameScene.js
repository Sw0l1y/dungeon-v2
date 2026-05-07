import { Scene } from './Scene.js';
import { Camera } from '../systems/Camera.js';
import { Level1 } from '../levels/Level1.js';
import { WaveManager } from '../systems/WaveManager.js';
import { DeathScene } from './DeathScene.js';
import { PauseScene } from './PauseScene.js';
import { Portal } from '../entities/Portal.js';

export class GameScene extends Scene {
  onEnter() {
    this.level  = new Level1(this.game);
    this.camera = new Camera(this.game.canvas.width, this.game.canvas.height);
    this.level.onEnter();
    this.waves  = new WaveManager(this.level);
    this._portalSpawned = false;

    // Intro portal
    const { map, tileSize: ts } = this.level;
    this._introCX    = Math.floor(map[0].length / 2) * ts + ts / 2;
    this._introCY    = Math.floor(map.length    / 2) * ts + ts / 2;
    this._introPhase = 'opening';   // 'opening' | 'stable' | 'closing' | 'done'
    this._introT     = 0;
    this._introR     = 0;
    this._introAngle = 0;
    this._INTRO_MAX_R   = 58;
    this._INTRO_OPEN_S  = 1.1;
    this._INTRO_STABLE_S = 0.6;
    this._INTRO_CLOSE_S = 0.9;

    // Snap camera to player spawn (centre) immediately
    this.camera.snapTo(this._introCX, this._introCY);
    this.camera.clamp(this.level.worldWidth, this.level.worldHeight);

    // Init run stats (reset each new game)
    this.game.state.stats = { enemiesKilled: 0, timeElapsed: 0 };
  }

  onExit() {
    this.level.onExit();
  }

  update(dt) {
    // Pause (allowed even during intro)
    if (this.game.input.justPressed('Backquote')) {
      this.game.scenes.push(new PauseScene(this.game, this));
      return;
    }

    this.game.state.stats.timeElapsed += dt;

    // ── Intro portal sequence (players frozen until portal closes) ───────────
    if (this._introPhase !== 'done') {
      this._updateIntro(dt);
      // Keep camera centred on spawn while portal plays
      this.camera.follow(this._introCX, this._introCY, dt);
      this.camera.clamp(this.level.worldWidth, this.level.worldHeight);
      return;
    }

    // ── Normal gameplay ───────────────────────────────────────────────────────
    this.level.update(dt);
    this.waves.update(dt);

    // Spawn death portal at map centre after boss is defeated
    if (this.waves.bossDefeated && !this._portalSpawned) {
      this.level.addEntity(new Portal(this.level, this._introCX, this._introCY));
      this._portalSpawned = true;
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

  // ── Intro portal helpers ────────────────────────────────────────────────────

  _updateIntro(dt) {
    this._introT     += dt;
    this._introAngle += 1.1 * dt;

    if (this._introPhase === 'opening') {
      const p    = Math.min(1, this._introT / this._INTRO_OPEN_S);
      const ease = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      this._introR = ease * this._INTRO_MAX_R;
      if (this._introT >= this._INTRO_OPEN_S) {
        this._introPhase = 'stable';
        this._introT = 0;
      }

    } else if (this._introPhase === 'stable') {
      this._introR = this._INTRO_MAX_R;
      if (this._introT >= this._INTRO_STABLE_S) {
        this._introPhase = 'closing';
        this._introT = 0;
      }

    } else if (this._introPhase === 'closing') {
      const p    = Math.min(1, this._introT / this._INTRO_CLOSE_S);
      const ease = p * p * p;                        // easeInCubic
      this._introR = (1 - ease) * this._INTRO_MAX_R;
      if (this._introT >= this._INTRO_CLOSE_S) {
        this._introPhase = 'done';
        this._introR = 0;
        this.waves.startWave();   // first wave starts the moment portal seals
      }
    }
  }

  _drawIntroPortal(ctx) {
    const R = this._introR;
    if (R < 0.5) return;
    const x = this._introCX, y = this._introCY;
    const t = Date.now();

    // Rotating galaxy arms (3 outer)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this._introAngle);
    for (let arm = 0; arm < 3; arm++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.strokeStyle = 'rgba(140,100,255,0.32)';
      ctx.lineWidth   = 6;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.7, -0.55, 0.22);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,160,255,0.5)';
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.35, -0.45, 0.14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(220,200,255,0.22)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.1, -0.38, 0.08);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Solid void
    ctx.fillStyle = '#020008';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();

    // Crisp pulsing rim
    const rim = 0.75 + 0.2 * Math.sin(t / 260);
    ctx.strokeStyle = `rgba(190,130,255,${rim})`;
    ctx.lineWidth   = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.stroke();

    // Bright core glow (only during opening)
    if (this._introPhase === 'opening' || this._introPhase === 'stable') {
      const coreA = 0.55 + 0.3 * Math.sin(t / 180);
      const core  = ctx.createRadialGradient(x, y, 0, x, y, R * 0.45);
      core.addColorStop(0,   `rgba(255,245,255,${coreA})`);
      core.addColorStop(1,   'rgba(120,70,220,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, R * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(ctx) {
    const { width, height } = this.game.canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    this.camera.applyTransform(ctx);
    this.level.draw(ctx);
    if (this._introPhase !== 'done') this._drawIntroPortal(ctx);
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

    // Bottom-center: wave status / countdown
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    if (this._introPhase !== 'done') {
      // Nothing — portal is the visual cue
    } else if (this.waves.bossDefeated) {
      ctx.fillStyle = '#ffe566';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText('Boss Defeated!', W / 2, H - 16);
    } else if (this.waves.active) {
      const rem = this.waves.remaining;
      ctx.fillStyle = rem > 0 ? '#ff7070' : '#a8ff78';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText(
        rem > 0
          ? `Wave ${this.waves.wave}  •  ${rem} enem${rem === 1 ? 'y' : 'ies'} left`
          : `Wave ${this.waves.wave} cleared!`,
        W / 2, H - 16,
      );
    } else if (this.waves.countdown > 0) {
      // Inter-wave countdown
      const secs  = Math.ceil(this.waves.countdown);
      const alpha = 0.55 + 0.3 * Math.sin(Date.now() / 400);
      ctx.fillStyle = `rgba(200,160,255,${alpha})`;
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText(`Wave ${this.waves.wave + 1}  in  ${secs}s`, W / 2, H - 16);
    }
  }
}
