import { Scene       } from './Scene.js';
import { Camera      } from '../systems/Camera.js';
import { Level1      } from '../levels/Level1.js';
import { WaveManager } from '../systems/WaveManager.js';
import { DeathScene  } from './DeathScene.js';
import { PauseScene  } from './PauseScene.js';
import { TitleScene  } from './TitleScene.js';
import { Portal      } from '../entities/Portal.js';

// Ghost-enemy type colours (client-side only, index matches _typeIdx)
const GHOST_COLORS = ['#ff6b6b', '#ff4040', '#ff9040', '#dd0044'];

export class GameScene extends Scene {
  onEnter() {
    this.level  = new Level1(this.game);
    this.camera = new Camera(this.game.canvas.width, this.game.canvas.height);
    this.level.onEnter();
    this.waves  = new WaveManager(this.level);
    this._portalSpawned = false;

    // ── Network state (null = local play) ─────────────────────────────────────
    this._net             = this.game.state.netSession     ?? null;
    this._netRole         = this.game.state.netRole        ?? null; // 'host'|'client'|null
    this._remoteBindings  = this.game.state.remoteBindings ?? [];
    // How many local players each side has (set by OnlineLobbyScene)
    this._hostPlayerCount  = this.game.state.hostPlayerCount  ?? 2;
    this._clientPlayerCount = this.game.state.clientPlayerCount ?? 2;

    // Ghost enemies shown on client (map of netId → {typeIdx, x, y})
    this._ghosts     = new Map();
    // Authoritative wave state received from host (used for client HUD)
    this._remoteWave = { n: 0, act: false, rem: 0, bd: false, cd: 0 };
    // Send-rate timers
    this._sendTimer  = 0;
    // Disconnect overlay
    this._netDisconnected = false;

    if (this._net) {
      this._net.onMessage      = (data) => this._onNetMsg(data);
      this._net.onDisconnected = ()     => { this._netDisconnected = true; };
    }

    // ── Intro portal ──────────────────────────────────────────────────────────
    const { map, tileSize: ts } = this.level;
    this._introCX    = Math.floor(map[0].length / 2) * ts + ts / 2;
    this._introCY    = Math.floor(map.length    / 2) * ts + ts / 2;
    this._introPhase = 'opening';   // 'opening' | 'stable' | 'closing' | 'done'
    this._introT     = 0;
    this._introR     = 0;
    this._introAngle = 0;
    this._INTRO_MAX_R    = 58;
    this._INTRO_OPEN_S   = 1.1;
    this._INTRO_STABLE_S = 0.6;
    this._INTRO_CLOSE_S  = 0.9;

    // Snap camera to player spawn (centre) immediately
    this.camera.snapTo(this._introCX, this._introCY);
    this.camera.clamp(this.level.worldWidth, this.level.worldHeight);

    // Intro ambient particles (stream toward the opening portal)
    this._introParticles      = [];
    this._introParticleShrink = 0;  // > 0 = shrinking out after portal closes
    this._initIntroParticles();

    // Players start invisible (grow in with the portal)
    for (const pl of this.level.players) pl.spawnScale = 0;

    // Init run stats (reset each new game)
    this.game.state.stats = { enemiesKilled: 0, timeElapsed: 0 };
  }

  onExit() {
    this.level.onExit();
    // Leave net session open (DeathScene / next scene may inspect stats)
    // Caller is responsible for calling net.close() if needed
  }

  update(dt) {
    // ── Disconnect overlay ─────────────────────────────────────────────────────
    if (this._netDisconnected) {
      if (this.game.input.justPressed('Enter') || this.game.input.justPressed('Space')
          || this.game.input.justPressed('Escape')) {
        this._net?.close();
        this.game.state.netSession = null;
        this.game.scenes.switch(new TitleScene(this.game));
      }
      return;
    }

    // Pause (allowed even during intro)
    if (this.game.input.justPressed('Backquote')) {
      this.game.scenes.push(new PauseScene(this.game, this));
      return;
    }

    this.game.state.stats.timeElapsed += dt;

    // ── Intro portal sequence (players frozen until portal closes) ────────────
    if (this._introPhase !== 'done') {
      this._updateIntro(dt);
      // Keep camera centred on spawn while portal plays
      this.camera.follow(this._introCX, this._introCY, dt);
      this.camera.clamp(this.level.worldWidth, this.level.worldHeight);
      return;
    }

    // ── Normal gameplay ────────────────────────────────────────────────────────
    // Tick down intro particle shrink-out even after portal is gone
    if (this._introParticleShrink > 0 || this._introParticles.length > 0) {
      this._updateIntroParticles(dt);
    }

    this.level.update(dt);

    // Wave manager: only the host (or solo player) runs waves / spawns enemies
    if (this._netRole !== 'client') {
      this.waves.update(dt);
    }

    // Spawn death portal at map centre after boss is defeated
    const bossDefeated = this._netRole === 'client'
      ? this._remoteWave.bd
      : this.waves.bossDefeated;

    if (bossDefeated && !this._portalSpawned) {
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

    // Camera follows the mean position of alive players
    const alive = ps.filter(p => p.alive);
    if (alive.length > 0) {
      const cx = alive.reduce((s, p) => s + p.x, 0) / alive.length;
      const cy = alive.reduce((s, p) => s + p.y, 0) / alive.length;
      this.camera.follow(cx, cy, dt);
      this.camera.clamp(this.level.worldWidth, this.level.worldHeight);
    }

    // ── Network sync ──────────────────────────────────────────────────────────
    if (this._net?.status === 'connected') {
      this._sendTimer += dt;
      if (this._netRole === 'host') {
        if (this._sendTimer >= 0.05) {     // 20 hz state
          this._sendTimer = 0;
          this._net.send(this._buildStatePacket());
        }
      } else {
        if (this._sendTimer >= 0.033) {   // 30 hz input
          this._sendTimer = 0;
          this._net.send(this._buildInputPacket());
        }
        // Flush remote bindings (clears justPressed after level.update reads them)
        for (const rb of this._remoteBindings) rb.flush();
      }
    }
  }

  // ── Intro portal helpers ────────────────────────────────────────────────────

  _updateIntro(dt) {
    this._introT     += dt;
    this._introAngle += 1.1 * dt;

    this._updateIntroParticles(dt);

    if (this._introPhase === 'opening') {
      const p    = Math.min(1, this._introT / this._INTRO_OPEN_S);
      const ease = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      this._introR = ease * this._INTRO_MAX_R;
      // Player model grows with the portal
      for (const pl of this.level.players) pl.spawnScale = ease;
      if (this._introT >= this._INTRO_OPEN_S) {
        this._introPhase = 'stable';
        this._introT = 0;
      }

    } else if (this._introPhase === 'stable') {
      this._introR = this._INTRO_MAX_R;
      for (const pl of this.level.players) pl.spawnScale = 1;
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
        for (const pl of this.level.players) pl.spawnScale = 1;
        this._introParticleShrink = 0.001;  // kick off shrink (> 0 activates it)
        // Host / solo only — client's first wave is triggered by host state
        if (this._netRole !== 'client') this.waves.startWave();
      }
    }
  }

  // ── Intro particle helpers ──────────────────────────────────────────────────

  _makeIntroParticle(anywhere) {
    const { worldWidth: ww, worldHeight: wh } = this.level;
    const COLORS = ['#8cf3ff', '#c77dff', '#b4a0ff', '#ffffff', '#a0d4ff'];
    let x, y;
    if (anywhere) {
      x = 60 + Math.random() * (ww - 120);
      y = 60 + Math.random() * (wh - 120);
    } else {
      const edge = Math.floor(Math.random() * 4);
      x = edge === 2 ? 50 : edge === 3 ? ww - 50 : 50 + Math.random() * (ww - 100);
      y = edge === 0 ? 50 : edge === 1 ? wh - 50 : 50 + Math.random() * (wh - 100);
    }
    return {
      x, y,
      size:  0.7 + Math.random() * 1.8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.25 + Math.random() * 0.55,
    };
  }

  _initIntroParticles() {
    for (let i = 0; i < 110; i++) {
      this._introParticles.push(this._makeIntroParticle(true));
    }
  }

  _updateIntroParticles(dt) {
    const SHRINK_DUR = 0.65;

    // Shrink-out phase: particles drift but aren't replaced; cleared when done
    if (this._introParticleShrink > 0) {
      this._introParticleShrink += dt;
      if (this._introParticleShrink >= SHRINK_DUR) {
        this._introParticles      = [];
        this._introParticleShrink = 0;
        return;
      }
      // Keep drifting toward where the portal was
      const cx = this._introCX, cy = this._introCY;
      const SWIRL = 0.42;
      for (const p of this._introParticles) {
        const dx = cx - p.x, dy = cy - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        const radial = (28000 / (dist + 80)) * dt;
        const tx = dy / dist, ty = -dx / dist;
        p.x += (dx / dist) * radial + tx * SWIRL * (5500 / (dist + 120)) * dt;
        p.y += (dy / dist) * radial + ty * SWIRL * (5500 / (dist + 120)) * dt;
      }
      return;
    }

    // Normal phase: pull toward portal + respawn when absorbed
    const cx = this._introCX, cy = this._introCY;
    const R  = this._introR;
    const SWIRL = 0.42;
    for (let i = 0; i < this._introParticles.length; i++) {
      const p    = this._introParticles[i];
      const dx   = cx - p.x;
      const dy   = cy - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < Math.max(R * 0.45, 5)) {
        this._introParticles[i] = this._makeIntroParticle(false);
        continue;
      }
      const radial     = (28000 / (dist + 80) + 8000 / (dist * dist + 300)) * dt;
      const tx = dy / dist, ty = -dx / dist;
      const tangential = SWIRL * (5500 / (dist + 120)) * dt;
      p.x += (dx / dist) * radial + tx * tangential;
      p.y += (dy / dist) * radial + ty * tangential;
    }
  }

  _drawIntroParticles(ctx) {
    const SHRINK_DUR = 0.65;
    const shrink = this._introParticleShrink > 0
      ? Math.max(0, 1 - this._introParticleShrink / SHRINK_DUR)
      : 1;

    const R = this._introR;
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this._introParticles) {
      const dx   = this._introCX - p.x;
      const dy   = this._introCY - p.y;
      const dist = Math.hypot(dx, dy);
      const fade = R > 0 ? Math.min(1, (dist - R * 0.5) / (R * 2.0)) : 1;
      const a    = p.alpha * Math.max(0, fade) * shrink;
      if (a < 0.01) continue;

      const sz       = p.size * shrink;
      const trailLen = Math.min(10, dist * 0.12) * shrink;
      if (trailLen > 1) {
        ctx.globalAlpha = a * 0.38;
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = sz * 0.65;
        ctx.beginPath();
        ctx.moveTo(p.x - (dx / dist) * trailLen, p.y - (dy / dist) * trailLen);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap     = 'butt';
    ctx.globalAlpha = 1;
    ctx.restore();
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

  // ── Network helpers ─────────────────────────────────────────────────────────

  /** Build game-state packet (host → client, 20 hz). */
  _buildStatePacket() {
    const ps = this.level.players;
    return {
      t: 'gs',
      p: ps.map(pl => ({
        x:  pl.x,
        y:  pl.y,
        hp: pl.hp,
        d:  pl._downed ? 1 : 0,
        fx: pl._facingX,
        fy: pl._facingY,
      })),
      en: this.level.entities
        .filter(e => e.isEnemy && e.alive)
        .map(e => [e._netId, e._typeIdx, Math.round(e.x), Math.round(e.y)]),
      wv: {
        n:   this.waves.wave,
        act: this.waves.active       ? 1 : 0,
        rem: this.waves.remaining,
        bd:  this.waves.bossDefeated ? 1 : 0,
        cd:  this.waves.countdown,
      },
    };
  }

  /** Build input packet (client → host, 30 hz).
   *  Client's local players start at index hostPlayerCount. */
  _buildInputPacket() {
    const snap = (pl) => {
      if (!pl) return { x: 0, y: 0, ak: 0, it: 0 };
      const { x, y } = pl.binding.axes;
      return { x, y, ak: pl.binding.isHeld('attack') ? 1 : 0, it: pl.binding.isHeld('interact') ? 1 : 0 };
    };
    const hc = this._hostPlayerCount;
    const cc = this._clientPlayerCount;
    const ps = this.level.players;
    const inputs = [];
    for (let i = 0; i < cc; i++) inputs.push(snap(ps[hc + i]));
    return { t: 'in', p: inputs };
  }

  /** Handle an incoming network message. */
  _onNetMsg(data) {
    if (this._netRole === 'host') {
      // Client sends { t:'in', p:[...inputs for each client-local player] }
      if (data.t === 'in' && data.p) {
        for (let i = 0; i < this._remoteBindings.length; i++) {
          this._remoteBindings[i]?.applyRemote(data.p[i] ?? {});
        }
      }
    } else {
      if (data.t === 'gs') this._applyHostState(data);
    }
  }

  /** Client: apply authoritative state snapshot from host. */
  _applyHostState(state) {
    const ps = this.level.players;

    // Update player states
    if (state.p) {
      state.p.forEach((pd, i) => {
        const pl = ps[i];
        if (!pl) return;

        // Host's local players (0..hostPlayerCount-1): snap positions from host state
        // Client's own players: accept HP / downed only
        if (i < this._hostPlayerCount) {
          pl.x = pd.x;
          pl.y = pd.y;
          pl._facingX = pd.fx ?? pl._facingX;
          pl._facingY = pd.fy ?? pl._facingY;
        }

        // Authoritative HP + downed state for all four players
        pl.hp = Math.max(0, pd.hp);
        if (pd.d && !pl._downed) { pl._downed = true;  pl.alive = false; }
        if (!pd.d && pl._downed) { pl._downed = false; pl.alive = true;  }
      });
    }

    // Update ghost enemies (purely visual — client renders, host does all AI/damage)
    if (state.en) {
      const seen = new Set();
      for (const [id, typeIdx, x, y] of state.en) {
        seen.add(id);
        const g = this._ghosts.get(id);
        if (g) { g.x = x; g.y = y; }
        else    this._ghosts.set(id, { id, typeIdx, x, y });
      }
      for (const id of this._ghosts.keys()) {
        if (!seen.has(id)) this._ghosts.delete(id);
      }
    }

    // Update remote wave state (used for HUD)
    if (state.wv) {
      this._remoteWave = {
        n:   state.wv.n,
        act: !!state.wv.act,
        rem: state.wv.rem,
        bd:  !!state.wv.bd,
        cd:  state.wv.cd,
      };
      // Spawn portal once host flags boss defeated
      if (this._remoteWave.bd && !this._portalSpawned) {
        this.level.addEntity(new Portal(this.level, this._introCX, this._introCY));
        this._portalSpawned = true;
      }
    }
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  draw(ctx) {
    const { width, height } = this.game.canvas;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    this.camera.applyTransform(ctx);

    this.level.draw(ctx);

    // Ghost enemies (client only)
    if (this._netRole === 'client') this._drawGhosts(ctx);

    if (this._introPhase !== 'done') {
      this._drawIntroParticles(ctx);  // particles on top of tiles/players
      this._drawIntroPortal(ctx);     // portal void drawn last (covers centre)
    } else if (this._introParticles.length > 0) {
      this._drawIntroParticles(ctx);  // shrinking out after portal seals
    }

    ctx.restore();

    this._drawHud(ctx);

    // Disconnect overlay
    if (this._netDisconnected) this._drawDisconnect(ctx);
  }

  /** Draw simple ghost representations of enemies on the client. */
  _drawGhosts(ctx) {
    for (const g of this._ghosts.values()) {
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.fillStyle   = GHOST_COLORS[g.typeIdx] ?? '#ff6b6b';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.typeIdx === 3 ? 38 : 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawDisconnect(ctx) {
    const { width: W, height: H } = this.game.canvas;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff7070';
    ctx.font = 'bold 28px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Connection Lost', W / 2, H / 2 - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '16px "Trebuchet MS", sans-serif';
    ctx.fillText('Press  Enter  to return to title', W / 2, H / 2 + 20);
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

    // Top-left (second line): net role badge
    if (this._netRole) {
      ctx.fillStyle = 'rgba(140,243,255,0.45)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillText(this._netRole === 'host' ? '⬡ host' : '⬡ client', 16, 34);
    }

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

    // Use remote wave state for client; local for host / solo
    const wv = (this._netRole === 'client') ? this._remoteWave : null;
    const waveN    = wv ? wv.n   : this.waves.wave;
    const waveAct  = wv ? wv.act : this.waves.active;
    const waveRem  = wv ? wv.rem : this.waves.remaining;
    const waveBD   = wv ? wv.bd  : this.waves.bossDefeated;
    const waveCD   = wv ? wv.cd  : this.waves.countdown;

    if (this._introPhase !== 'done') {
      // Nothing — portal is the visual cue
    } else if (waveBD) {
      ctx.fillStyle = '#ffe566';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText('Boss Defeated!', W / 2, H - 16);
    } else if (waveAct) {
      const rem = waveRem;
      ctx.fillStyle = rem > 0 ? '#ff7070' : '#a8ff78';
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText(
        rem > 0
          ? `Wave ${waveN}  •  ${rem} enem${rem === 1 ? 'y' : 'ies'} left`
          : `Wave ${waveN} cleared!`,
        W / 2, H - 16,
      );
    } else if (waveCD > 0) {
      const secs  = Math.ceil(waveCD);
      const alpha = 0.55 + 0.3 * Math.sin(Date.now() / 400);
      ctx.fillStyle = `rgba(200,160,255,${alpha})`;
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.fillText(`Wave ${waveN + 1}  in  ${secs}s`, W / 2, H - 16);
    }
  }
}
