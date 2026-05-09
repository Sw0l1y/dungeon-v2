import { Scene          } from './Scene.js';
import { Camera         } from '../systems/Camera.js';
import { Level1         } from '../levels/Level1.js';
import { DynamicLevel   } from '../levels/DynamicLevel.js';
import { WaveManager    } from '../systems/WaveManager.js';
import { DeathScene     } from './DeathScene.js';
import { PauseScene     } from './PauseScene.js';
import { TitleScene     } from './TitleScene.js';
import { Portal         } from '../entities/Portal.js';
import { Projectile     } from '../entities/Projectile.js';
import { SwordSwing     } from '../entities/SwordSwing.js';
import { EnemyProjectile} from '../entities/EnemyProjectile.js';

export class GameScene extends Scene {
  onEnter() {
    // Load the room for the current campaign index, fall back to built-in Level1
    const roomIdx = this.game.state.roomIndex ?? 0;
    const roomCfg = this.game.maps?.campaign?.[roomIdx];
    this.level = roomCfg ? new DynamicLevel(this.game, roomCfg) : new Level1(this.game);
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

    // Ghost enemies shown on client (map of netId → {typeIdx, x, y, hpPct})
    this._ghosts     = new Map();
    // Ghost projectiles (client only): player, sword swings, enemy
    this._ghostProjPl = [];
    this._ghostProjSw = [];
    this._ghostProjEp = [];
    // Authoritative wave state received from host (used for client HUD)
    this._remoteWave = { n: 0, act: false, rem: 0, bd: false, cd: 0 };
    // Send-rate timers
    this._sendTimer  = 0;
    // Disconnect overlay (client only — host continues when a single client drops)
    this._netDisconnected = false;
    // Buffered fx events to include in next state packet (host only)
    this._pendingEvents = [];
    // Delta-send cache: last broadcast position per enemy netId (host only)
    this._lastSentEnemyPos = new Map();
    // Interpolation delay for ghost rendering (ms behind real-time)
    this._INTERP_DELAY = 80;

    // Multi-client input routing (host only):
    //   Map<peerId, {offset, count}> — which remoteBindings slice each client owns
    this._peerInputMap = this.game.state.peerInputMap ?? new Map();
    // Multi-client: which player-array indices are locally controlled on this device.
    // Host: [] (all host players use local bindings, no applyRemote needed).
    // Client: e.g. [1] or [2,3] — used in _buildInputPacket and _applyHostState.
    this._myPlayerIdxs      = this.game.state.myPlayerIdxs ?? [];
    this._localPlayerIdxSet = new Set(this._myPlayerIdxs);

    if (this._net) {
      this._net.onMessage      = (data, peerId) => this._onNetMsg(data, peerId);
      // Only the CLIENT shows the disconnect overlay — if a single client drops
      // mid-game on the host side, the remaining players continue unaffected.
      this._net.onDisconnected = () => {
        if (this._netRole === 'client') this._netDisconnected = true;
      };
    }

    // Intercept death particle spawns so the host can relay them to the client
    if (this._netRole === 'host') {
      const origSpawn = this.level.spawnDeathParticles.bind(this.level);
      this.level.spawnDeathParticles = (x, y, color, count) => {
        origSpawn(x, y, color, count);
        this._pendingEvents.push({ k: 'd', x: Math.round(x), y: Math.round(y), c: color, n: count });
      };
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
      const portal = new Portal(this.level, this._introCX, this._introCY);
      // Callback to advance rooms — avoids circular import between Portal and GameScene
      portal.onEnter = () => {
        const game     = this.game;
        const campaign = game.maps?.campaign;
        const nextIdx  = (game.state.roomIndex ?? 0) + 1;
        if (campaign && nextIdx < campaign.length) {
          game.state.roomIndex = nextIdx;
          game.scenes.switch(new GameScene(game));
        } else {
          // Campaign complete — reset and return to title
          game.state.roomIndex = 0;
          game.scenes.switch(new TitleScene(game));
        }
      };
      this.level.addEntity(portal);
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
      // Notify client before switching — the return below skips the normal
      // network-send block, so without this explicit message the client never
      // receives the final "all dead" state and stays stuck in GameScene.
      if (this._netRole === 'host') {
        this._net?.send({ t: 'gameover' });
      }
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
    const ps   = this.level.players;
    const ents = this.level.entities;
    const hc   = this._hostPlayerCount;

    // Only relay projectiles/swings from HOST-LOCAL players.
    // Client-local players already render their own attacks locally, so we
    // skip them here to avoid doubled visuals.
    const isHostPlayerProj = (e) => {
      const ownerIdx = ps.indexOf(e.owner);
      return ownerIdx >= 0 && ownerIdx < hc;
    };

    return {
      t: 'gs',
      p: ps.map(pl => ({
        x:  pl.x,
        y:  pl.y,
        hp: pl.hp,
        d:  pl._downed ? 1 : 0,
        fx: pl._facingX,
        fy: pl._facingY,
        // Movement axes so client can extrapolate host-player positions between snaps
        ax: +(pl.binding?.axes?.x ?? 0).toFixed(3),
        ay: +(pl.binding?.axes?.y ?? 0).toFixed(3),
        // Rogue trail sync — omitted when empty to save bandwidth
        dt: pl._dashTrail?.length
          ? pl._dashTrail.map(t => [Math.round(t.x), Math.round(t.y), +t.a.toFixed(2)])
          : undefined,
        rt: pl._ricochetTrail?.length
          ? pl._ricochetTrail.map(s => [Math.round(s.x0), Math.round(s.y0), Math.round(s.x1), Math.round(s.y1), +s.delay.toFixed(3), +s.a.toFixed(2)])
          : undefined,
      })),
      // Enemies: full [netId, typeIdx, x, y, hpPct0-255] OR compact [netId] (alive, pos unchanged).
      // Compact entries save bandwidth when enemies are stationary; client keeps last known pos.
      // A full entry is always sent when the enemy moved ≥1px or hasn't been sent in 200ms.
      en: (() => {
        const nowMs  = performance.now();
        const result = [];
        for (const e of ents) {
          if (!e.isEnemy || !e.alive) continue;
          const ex   = Math.round(e.x), ey = Math.round(e.y);
          const last = this._lastSentEnemyPos.get(e._netId);
          const moved = !last || Math.hypot(ex - last.x, ey - last.y) >= 1.0;
          const stale = !last || (nowMs - last.t) >= 200;
          if (moved || stale) {
            this._lastSentEnemyPos.set(e._netId, { x: ex, y: ey, t: nowMs });
            result.push([e._netId, e._typeIdx, ex, ey, Math.round(e.hp / e.maxHp * 255)]);
          } else {
            result.push([e._netId]); // compact: still alive, position unchanged
          }
        }
        // Purge dead enemies from position cache
        for (const id of this._lastSentEnemyPos.keys()) {
          if (!ents.some(e => e._netId === id && e.alive)) this._lastSentEnemyPos.delete(id);
        }
        return result;
      })(),
      // Projectiles from host-local players and enemies
      proj: {
        pl: ents
          .filter(e => e instanceof Projectile && isHostPlayerProj(e))
          .map(e => [Math.round(e.x), Math.round(e.y), Math.round(e.vx), Math.round(e.vy), e.owner?.color ?? '#fff']),
        sw: ents
          .filter(e => e instanceof SwordSwing && isHostPlayerProj(e))
          .map(e => [
            Math.round(e.x), Math.round(e.y),
            +e.dirX.toFixed(3), +e.dirY.toFixed(3),
            +(1 - e._timer / e._duration).toFixed(3),
            e.owner?.color ?? '#fff',
          ]),
        ep: ents
          .filter(e => e instanceof EnemyProjectile)
          .map(e => [Math.round(e.x), Math.round(e.y), Math.round(e.vx), Math.round(e.vy)]),
      },
      wv: {
        n:   this.waves.wave,
        act: this.waves.active       ? 1 : 0,
        rem: this.waves.remaining,
        bd:  this.waves.bossDefeated ? 1 : 0,
        cd:  this.waves.countdown,
      },
      // Buffered events (death particles, etc.) since last packet
      ev: this._pendingEvents.splice(0),
    };
  }

  /** Build input packet (client → host, 30 hz).
   *  Only sends inputs for this device's locally-controlled players. */
  _buildInputPacket() {
    const snap = (pl) => {
      if (!pl) return { x: 0, y: 0, ak: 0, it: 0 };
      const { x, y } = pl.binding.axes;
      return { x, y, ak: pl.binding.isHeld('attack') ? 1 : 0, it: pl.binding.isHeld('interact') ? 1 : 0 };
    };
    const ps = this.level.players;
    return { t: 'in', p: this._myPlayerIdxs.map(i => snap(ps[i])) };
  }

  /** Handle an incoming network message. */
  _onNetMsg(data, peerId) {
    if (this._netRole === 'host') {
      // Client sends { t:'in', p:[...inputs for this client's local players] }
      if (data.t === 'in' && data.p) {
        // Route to the correct RemoteBinding slice via the peerInputMap.
        // With a single client and no peerInputMap entry, fall back to the old
        // behaviour (apply sequentially from offset 0) for backward compat.
        const mapping = this._peerInputMap.get(peerId);
        if (mapping) {
          for (let i = 0; i < Math.min(data.p.length, mapping.count); i++) {
            this._remoteBindings[mapping.offset + i]?.applyRemote(data.p[i] ?? {});
          }
        } else {
          // Fallback: single-client path (peerInputMap not populated)
          for (let i = 0; i < this._remoteBindings.length; i++) {
            this._remoteBindings[i]?.applyRemote(data.p[i] ?? {});
          }
        }
      }
    } else {
      if (data.t === 'gs') this._applyHostState(data);

      // Host explicitly signals game-over before switching to DeathScene.
      // The normal "all players dead" check in update() runs BEFORE the network
      // send block, so the host scene-switches without sending a final gs packet.
      // This message ensures the client always follows the host to DeathScene.
      if (data.t === 'gameover') {
        this.game.scenes.switch(new DeathScene(this.game));
      }
    }
  }

  /** Client: apply authoritative state snapshot from host. */
  _applyHostState(state) {
    const ps = this.level.players;

    // Update player states — host is fully authoritative for ALL positions
    if (state.p) {
      state.p.forEach((pd, i) => {
        const pl = ps[i];
        if (!pl) return;

        pl._facingX = pd.fx ?? pl._facingX;
        pl._facingY = pd.fy ?? pl._facingY;

        // Position authority:
        //   Local players  → hard snap (server correction keeps them honest)
        //   Remote players → axes-driven movement at full frame rate; only snap
        //                    when error exceeds 80px (wall clip, teleport, etc.)
        //                    This eliminates the 20hz jitter on opponent screens.
        const isRemote = !this._localPlayerIdxSet.has(i) && this._localPlayerIdxSet.size > 0;
        if (isRemote) {
          const err = Math.hypot(pd.x - pl.x, pd.y - pl.y);
          if (err > 80) { pl.x = pd.x; pl.y = pd.y; }
          // Push axes so player.update() extrapolates at 60fps between 20hz packets
          if (pd.ax !== undefined) {
            pl.binding.applyRemote?.({ x: pd.ax, y: pd.ay ?? 0, ak: 0, it: 0 });
          }
        } else {
          pl.x = pd.x;
          pl.y = pd.y;
        }

        // Authoritative HP + downed state for all players
        pl.hp = Math.max(0, pd.hp);
        if (pd.d && !pl._downed) { pl._downed = true;  pl.alive = false; }
        if (!pd.d && pl._downed) { pl._downed = false; pl.alive = true;  }

        // Rogue trail sync — apply received trail arrays so the visual plays on both screens
        if (pd.dt !== undefined) {
          pl._dashTrail = pd.dt.map(([x, y, a]) => ({ x, y, a }));
        } else if (!isRemote) {
          // no trail data in packet means it's empty on host — clear it
          if (pl._dashTrail?.length) pl._dashTrail = [];
        }
        if (pd.rt !== undefined) {
          pl._ricochetTrail = pd.rt.map(([x0, y0, x1, y1, delay, a]) => ({ x0, y0, x1, y1, delay, a }));
        } else if (!isRemote) {
          if (pl._ricochetTrail?.length) pl._ricochetTrail = [];
        }
      });
    }

    // Update ghost enemies (purely visual — client renders, host does all AI/damage)
    if (state.en) {
      const seen = new Set();
      const nowMs = performance.now();
      for (const entry of state.en) {
        const id = entry[0];
        seen.add(id);
        if (entry.length === 1) {
          // Compact entry: ghost is still alive but position didn't change — no update needed.
          // If somehow the ghost doesn't exist yet (e.g. mid-wave join), skip until full arrives.
          continue;
        }
        const [, typeIdx, x, y, hpPct255] = entry;
        const hpPct = (hpPct255 ?? 255) / 255;
        const g = this._ghosts.get(id);
        if (g) {
          g.x = x; g.y = y; g.hpPct = hpPct; // latest authoritative pos (used for aim proxies)
          g.snaps.push({ t: nowMs, x, y });
          if (g.snaps.length > 6) g.snaps.shift();
        } else {
          this._ghosts.set(id, { id, typeIdx, x, y, hpPct, snaps: [{ t: nowMs, x, y }] });
        }
      }
      for (const id of this._ghosts.keys()) {
        if (!seen.has(id)) this._ghosts.delete(id);
      }

      // Expose ghost positions as lightweight aim proxies so Player._nearestEnemy()
      // produces correct auto-aim directions on the client (enemies aren't in
      // level.entities on the client, so without this the facing is always null).
      // Use the latest received position (g.x/g.y) for aim accuracy, not the render-delayed one.
      const RADIUS_BY_TYPE = [12, 9, 13, 38, 14, 8];
      const SPEED_BY_TYPE  = [75, 238, 55, 60, 50, 115];
      this.level.ghostEntities = Array.from(this._ghosts.values()).map(g => ({
        isEnemy: true,
        alive:   true,
        x:       g.x,
        y:       g.y,
        radius:  RADIUS_BY_TYPE[g.typeIdx] ?? 12,
        speed:   SPEED_BY_TYPE[g.typeIdx]  ?? 75,
      }));
    }

    // Ghost projectiles
    if (state.proj) {
      this._ghostProjPl = state.proj.pl ?? [];
      this._ghostProjSw = state.proj.sw ?? [];
      this._ghostProjEp = state.proj.ep ?? [];
    }

    // FX events: spawn death particles on client's level for visual parity
    if (state.ev) {
      for (const ev of state.ev) {
        if (ev.k === 'd') this.level.spawnDeathParticles(ev.x, ev.y, ev.c, ev.n);
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
        const portal = new Portal(this.level, this._introCX, this._introCY);
        portal.onEnter = () => {
          const game    = this.game;
          const campaign = game.maps?.campaign;
          const nextIdx  = (game.state.roomIndex ?? 0) + 1;
          if (campaign && nextIdx < campaign.length) {
            game.state.roomIndex = nextIdx;
            game.scenes.switch(new GameScene(game));
          } else {
            game.state.roomIndex = 0;
            game.scenes.switch(new TitleScene(game));
          }
        };
        this.level.addEntity(portal);
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

    // Ghost enemies + projectiles (client only)
    if (this._netRole === 'client') {
      this._drawGhosts(ctx);
      this._drawGhostProjectiles(ctx);
    }

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

  /**
   * Returns the interpolated render position for a ghost at `now - _INTERP_DELAY`.
   * Falls back to the latest snapshot if the buffer is too thin, and extrapolates
   * (capped to 2 steps) when the render time is ahead of all known snapshots.
   */
  _ghostInterp(g) {
    const snaps = g.snaps;
    if (!snaps || snaps.length === 0) return { x: g.x, y: g.y };
    const renderT = performance.now() - this._INTERP_DELAY;

    if (snaps.length === 1 || renderT <= snaps[0].t) {
      return { x: snaps[0].x, y: snaps[0].y };
    }

    // Find the two snapshots that bracket renderT and lerp between them
    for (let i = 1; i < snaps.length; i++) {
      if (renderT <= snaps[i].t) {
        const a = snaps[i - 1], b = snaps[i];
        const frac = (renderT - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
      }
    }

    // renderT is beyond all snapshots — extrapolate from the last two (capped to 2× interval)
    const n = snaps.length;
    if (n < 2) return { x: snaps[n - 1].x, y: snaps[n - 1].y };
    const a = snaps[n - 2], b = snaps[n - 1];
    const dt = b.t - a.t;
    if (dt < 1) return { x: b.x, y: b.y };
    const frac = Math.min((renderT - b.t) / dt, 2.0);
    return { x: b.x + (b.x - a.x) * frac, y: b.y + (b.y - a.y) * frac };
  }

  /** Draw ghost enemies on the client, matching each type's actual visuals. */
  _drawGhosts(ctx) {
    for (const g of this._ghosts.values()) {
      // Use interpolated position so remote enemies glide smoothly between 20 hz snapshots
      const { x, y } = this._ghostInterp(g);
      const gv = { ...g, x, y };
      switch (gv.typeIdx) {
        case 0: this._drawGhostEnemy(ctx, gv);    break;
        case 1: this._drawGhostSprinter(ctx, gv); break;
        case 2: this._drawGhostRanger(ctx, gv);   break;
        case 3: this._drawGhostBoss(ctx, gv);     break;
        case 4: this._drawGhostPulsar(ctx, gv);   break;
        case 5: this._drawGhostRelay(ctx, gv);    break;
      }
    }
  }

  _drawGhostHealthBar(ctx, x, y, offsetY, barW, barH, hpPct) {
    const barX = x - barW / 2;
    const barY = y + offsetY;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#4cff72' : hpPct > 0.25 ? '#ffd24c' : '#ff4c4c';
    ctx.fillRect(barX, barY, barW * hpPct, barH);
  }

  _drawGhostEnemy(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    ctx.strokeStyle = 'rgba(255,60,60,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e03030';
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    this._drawGhostHealthBar(ctx, x, y, -21, 28, 3, hpPct);
  }

  _drawGhostSprinter(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    ctx.strokeStyle = 'rgba(255,220,0,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffe033';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    this._drawGhostHealthBar(ctx, x, y, -19, 24, 3, hpPct);
  }

  _drawGhostRanger(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    ctx.strokeStyle = 'rgba(255,130,0,0.4)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff8c00';
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    this._drawGhostHealthBar(ctx, x, y, -25, 28, 3, hpPct);
  }

  _drawGhostBoss(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    const RADIUS  = 38;
    const phase   = hpPct > 0.60 ? 1 : hpPct > 0.35 ? 2 : 3;
    const t       = Date.now();
    const angle   = (t / 500) * 2.0;   // approximate spiral angle
    const flicker = phase === 3 && Math.floor(t / 110) % 3 === 0;

    const bodyColor   = phase === 1 ? '#6b0018' : phase === 2 ? '#7a2200' : '#990000';
    const accentColor = phase === 3 ? '#ff3333' : phase === 2 ? '#ff7733' : '#ff2244';

    ctx.strokeStyle = flicker ? 'rgba(255,200,200,0.75)' : accentColor + '66';
    ctx.lineWidth   = 10;
    ctx.beginPath(); ctx.arc(x, y, RADIUS + 14, 0, Math.PI * 2); ctx.stroke();

    if (phase >= 2) {
      const pulse = 0.35 + 0.2 * Math.sin(t / 190);
      ctx.strokeStyle = `rgba(255,130,0,${pulse})`;
      ctx.lineWidth   = 4;
      ctx.beginPath(); ctx.arc(x, y, RADIUS + 26, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.fillStyle = flicker ? '#cc2200' : bodyColor;
    ctx.beginPath(); ctx.arc(x, y, RADIUS, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = flicker ? 'rgba(255,255,255,0.6)' : accentColor + '99';
    ctx.lineWidth   = 2.5;
    ctx.beginPath(); ctx.arc(x, y, RADIUS * 0.58, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = accentColor + '55';
    ctx.lineWidth   = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = angle + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * RADIUS * 0.52, y + Math.sin(a) * RADIUS * 0.52);
      ctx.stroke();
    }

    ctx.fillStyle = flicker ? '#ffffff' : '#ffbbbb';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#330000';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();

    // Health bar
    const barW = 96, barH = 9;
    const barX = x - barW / 2;
    const barY = y - RADIUS - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath(); ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 3); ctx.fill();
    ctx.fillStyle = hpPct > 0.60 ? '#e03030' : hpPct > 0.35 ? '#e07020' : '#ff2020';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * hpPct, barH, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
    for (const m of [0.60, 0.35]) {
      const mx = barX + barW * m;
      ctx.beginPath(); ctx.moveTo(mx, barY - 1); ctx.lineTo(mx, barY + barH + 1); ctx.stroke();
    }
    ctx.fillStyle = '#ff8888';
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`BOSS  •  Phase ${phase}`, x, barY - 3);
  }

  _drawGhostPulsar(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    const COLOR = '#22ff55';
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle   = COLOR;
    ctx.beginPath(); ctx.arc(x, y, 21, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Shield ring
    ctx.strokeStyle = 'rgba(34,255,85,0.5)';
    ctx.lineWidth   = 4;
    ctx.beginPath(); ctx.arc(x, y, 23, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COLOR;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this._drawGhostHealthBar(ctx, x, y, -24, 28, 3, hpPct);
  }

  _drawGhostRelay(ctx, g) {
    const { x, y, hpPct = 1 } = g;
    const COLOR = '#22ff55';
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle   = COLOR;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = COLOR;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this._drawGhostHealthBar(ctx, x, y, -17, 20, 3, hpPct);
  }

  /** Draw ghost projectiles on the client (host-local player attacks + enemies). */
  _drawGhostProjectiles(ctx) {
    // Player projectiles
    for (const [x, y, vx, vy, color] of this._ghostProjPl) {
      const tx = x - (vx / 420) * 14;
      const ty = y - (vy / 420) * 14;
      ctx.fillStyle = color + '55';
      ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }

    // Sword swings
    for (const [ox, oy, dirX, dirY, progress, color] of this._ghostProjSw) {
      const baseAngle = Math.atan2(dirY, dirX);
      const half      = Math.PI * 0.39;   // arcAngle/2 = 0.78π/2
      const sweepEnd  = baseAngle - half + Math.PI * 0.78 * progress;
      ctx.save();
      ctx.globalAlpha = 0.75 * (1 - progress * 0.6);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 8;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.arc(ox, oy, 52, baseAngle - half, sweepEnd); ctx.stroke();
      ctx.restore();
    }

    // Enemy projectiles
    for (const [x, y, vx, vy] of this._ghostProjEp) {
      const speed = Math.hypot(vx, vy) || 1;
      const tx    = x - (vx / speed) * 18;
      const ty    = y - (vy / speed) * 18;

      const grad = ctx.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, 'rgba(255,140,0,0)');
      grad.addColorStop(1, 'rgba(255,140,0,0.45)');
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 9.8;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();

      const pulse = 0.35 + 0.15 * Math.sin(Date.now() / 120);
      ctx.strokeStyle = `rgba(255,160,0,${pulse})`;
      ctx.lineWidth   = 3;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffb833';
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.arc(x, y, 3.15, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'butt';
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
