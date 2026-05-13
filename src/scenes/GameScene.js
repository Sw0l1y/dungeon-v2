import { Scene          } from './Scene.js';
import { Camera         } from '../systems/Camera.js';
import { Level1         } from '../levels/Level1.js';
import { DynamicLevel   } from '../levels/DynamicLevel.js';
import { WaveManager    } from '../systems/WaveManager.js';
import { DeathScene     } from './DeathScene.js';
import { PauseScene     } from './PauseScene.js';
import { TitleScene     } from './TitleScene.js';
import { ShopScene, defaultUpgrades } from './ShopScene.js';
import { Portal         } from '../entities/Portal.js';
import { Projectile     } from '../entities/Projectile.js';
import { SwordSwing     } from '../entities/SwordSwing.js';
import { EnemyProjectile} from '../entities/EnemyProjectile.js';

export class GameScene extends Scene {
  onEnter() {
    // Load the room for the current campaign index, fall back to built-in Level1.
    // Shop rooms (type:'shop') have no tile data — they route to ShopScene instead,
    // but guard here just in case the roomIndex lands on one unexpectedly.
    const roomIdx = this.game.state.roomIndex ?? 0;
    const roomCfg = this.game.maps?.campaign?.[roomIdx];
    this.level = (roomCfg && roomCfg.type !== 'shop') ? new DynamicLevel(this.game, roomCfg) : new Level1(this.game);
    this.camera = new Camera(this.game.canvas.width, this.game.canvas.height);
    this.level.onEnter();
    this.waves  = new WaveManager(this.level);
    this._portalSpawned = false;

    // ── Net overlay (Y to toggle) ─────────────────────────────────────────────
    this._netOverlayOn    = false;
    this._netPingRtt      = null;   // smoothed app-level RTT (ms)
    this._netPingTimer    = 0;      // counts up; ping sent every 1 s
    this._netPingSeq      = 0;
    this._netPingMap      = new Map();   // seq → performance.now() at send
    this._netRxPkts       = 0;      // raw counters for current 1 s window
    this._netRxBytes      = 0;
    this._netTxPkts       = 0;
    this._netTxBytes      = 0;
    this._netStatTimer    = 0;
    this._netDispRx       = { pkts: 0, kbps: 0 };   // display (updated each second)
    this._netDispTx       = { pkts: 0, kbps: 0 };
    // Packet-loss / jitter (CLIENT only — tracks gs sequence numbers)
    this._netStateSeq     = 0;      // HOST: outgoing counter stamped on every gs packet
    this._netExpSeq       = -1;     // CLIENT: next expected gs seq
    this._netGsRecv       = 0;      // gs packets received this window
    this._netGsLost       = 0;      // seq gaps detected this window
    this._netLossPct      = 0;      // display value (%)
    this._netLastGsTime   = 0;      // performance.now() of last gs packet (jitter)
    this._netJitter       = 0;      // mean-absolute-deviation of inter-packet gaps (ms)
    this._netJitterBuf    = [];     // rolling samples
    // WebRTC stack stats: polled every 3 s (async, non-blocking)
    this._netWrtcType     = '…';    // 'relay' | 'srflx' | 'host' | 'prflx' | '?'
    this._netWrtcRtt      = null;   // ms from WebRTC candidate-pair stats
    this._netWrtcTimer    = 0;      // fires immediately on first tick

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
    // Persistent smooth projectile lists — positions are advanced by velocity each frame
    // so they glide at 60fps rather than snapping every 20hz packet.
    this._smoothProjPl = [];   // { x,y,vx,vy,color,stale }
    this._smoothProjEp = [];   // { x,y,vx,vy,stale }
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
    // Timestamp of last received projectile packet (for velocity extrapolation)
    this._ghostProjPacketTime = performance.now();

    // Multi-client input routing (host only):
    //   Map<peerId, {offset, count}> — which remoteBindings slice each client owns
    this._peerInputMap = this.game.state.peerInputMap ?? new Map();
    // Multi-client: which player-array indices are locally controlled on this device.
    // Host: [] (all host players use local bindings, no applyRemote needed).
    // Client: e.g. [1] or [2,3] — used in _buildInputPacket and _applyHostState.
    this._myPlayerIdxs      = this.game.state.myPlayerIdxs ?? [];
    this._localPlayerIdxSet = new Set(this._myPlayerIdxs);
    // Per-local-player ability latch — set when abilityA is pressed, cleared after
    // the next input packet is sent so presses between 60hz frames aren't dropped.
    this._abilityLatch = [];

    if (this._net) {
      this._net.onMessage      = (data, peerId) => this._onNetMsg(data, peerId);
      // Only the CLIENT shows the disconnect overlay — if a single client drops
      // mid-game on the host side, the remaining players continue unaffected.
      this._net.onDisconnected = () => {
        if (this._netRole === 'client') this._netDisconnected = true;
      };
    }

    // Gold shards — world-space particles that get sucked into the exit portal.
    // HOST/solo: collecting them increments game.state.gold.
    // CLIENT:    visual-only; gold is synced via 'gd' field in state packets.
    this._goldShards = [];

    // ── Upgrade system hooks — only on HOST/solo (client is driven by packets) ─

    if (this._netRole !== 'client') {
      // ── Hook: spawnDeathParticles (gold shards + bounty multiplier + net relay) ─
      const origSpawn = this.level.spawnDeathParticles.bind(this.level);
      this.level.spawnDeathParticles = (x, y, color, count) => {
        origSpawn(x, y, color, count);
        if (this._netRole === 'host') {
          this._pendingEvents.push({ k: 'd', x: Math.round(x), y: Math.round(y), c: color, n: count });
        }
        const mult = this.level._pendingBountyMult ?? 1;
        this.level._pendingBountyMult = 1;
        this._spawnGoldShards(x, y, count, mult);
      };

      // ── Hook: addEntity — patch enemies for Bleed DoT and Bounty gold mark ──
      const origAdd = this.level.addEntity.bind(this.level);
      this.level.addEntity = (e) => {
        origAdd(e);
        if (!e.isEnemy) return e;

        const upg = this.game.state.upgrades;

        // Bounty: 20% chance to mark enemy — triple gold on death
        if (upg?.bounty && Math.random() < 0.2 && !e.isBoss) {
          e._bountyMarked = true;
          // Wrap draw() to add gold ring
          const origDraw = e.draw?.bind(e);
          if (origDraw) {
            e.draw = (ctx) => {
              origDraw(ctx);
              const pulse = 0.55 + 0.25 * Math.sin(Date.now() / 240);
              ctx.save();
              ctx.globalAlpha  = pulse;
              ctx.strokeStyle  = '#ffd166';
              ctx.lineWidth    = 2.5;
              ctx.shadowColor  = '#ffd166';
              ctx.shadowBlur   = 8;
              ctx.beginPath();
              ctx.arc(e.x, e.y, (e.radius ?? 12) + 6, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            };
          }
          // Wrap takeDamage to set bounty multiplier just before death
          const origTD = e.takeDamage?.bind(e);
          if (origTD) {
            e.takeDamage = (amt, src, tp) => {
              if (e.alive && e.hp > 0 && amt >= e.hp) {
                this.level._pendingBountyMult = 3;
              }
              origTD(amt, src, tp);
            };
          }
        }

        // Bleed: wrap takeDamage so player hits apply a 3s DoT
        if (upg?.bleed) {
          const origTDBleed = e.takeDamage?.bind(e);
          if (origTDBleed && !e._bleedWrapped) {
            e._bleedWrapped = true;
            const level = this.level;
            e.takeDamage = (amt, src, tp) => {
              origTDBleed(amt, src, tp);
              if (src && level.players.includes(src) && e.alive) {
                e._bleedTimer    = 3.0;
                e._bleedDmgTimer = (e._bleedDmgTimer ?? 0);
              }
            };
          }
        }

        return e;
      };

      // ── Hook: destroyWall — Salvage gold + network tile-destroy events ───────
      const origDestroy = this.level.destroyWall.bind(this.level);
      this.level.destroyWall = (col, row) => {
        origDestroy(col, row);
        if (this._netRole === 'host') {
          this._pendingEvents.push({ k: 'td', c: col, r: row });
        }
        if (this.game.state.upgrades?.salvage) {
          const ts = this.level.tileSize ?? 40;
          this._spawnGoldShards((col + 0.5) * ts, (row + 0.5) * ts, 4);
        }
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

    // Gold + upgrades — persist across rooms; initialize on first entry only
    this.game.state.gold     = this.game.state.gold     ?? 0;
    this.game.state.upgrades = this.game.state.upgrades ?? defaultUpgrades();

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

    // Y — toggle net overlay (only meaningful during online play)
    if (this.game.input.justPressed('KeyY') && this._netRole) {
      this._netOverlayOn = !this._netOverlayOn;
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

    // Capture ability presses BEFORE level.update so we catch the justPressed frame.
    // The latch is consumed when the next input packet is sent (30→60 hz).
    if (this._netRole === 'client') {
      for (let i = 0; i < this._myPlayerIdxs.length; i++) {
        const pl = this.level.players[this._myPlayerIdxs[i]];
        if (pl?.binding.justPressed('abilityA')) this._abilityLatch[i] = true;
      }
    }

    this.level.update(dt);

    // Gold shard physics — runs on all roles (client shards are visual-only)
    if (this._goldShards.length > 0) this._updateGoldShards(dt);

    // ── Upgrade ticks (HOST / solo only — client follows via packets) ─────────
    if (this._netRole !== 'client') {
      // Bleed DoT — tick on all enemies with _bleedTimer > 0
      if (this.game.state.upgrades?.bleed) {
        for (const e of [...this.level.entities]) {
          if (!e.isEnemy || !e.alive || !(e._bleedTimer > 0)) continue;
          e._bleedTimer    -= dt;
          e._bleedDmgTimer  = (e._bleedDmgTimer ?? 0) + dt;
          // 5 damage per 0.5s tick = 30 damage over 3s
          while (e._bleedDmgTimer >= 0.5 && e._bleedTimer > -0.5) {
            e._bleedDmgTimer -= 0.5;
            if (!e.alive) break;
            e.hp = Math.max(0, e.hp - 5);
            if (e.hp <= 0 && e.alive) {
              e.alive = false;
              e.takeDamage?.(0, null, 'bleed');   // triggers death/cleanup
            }
          }
          if (e._bleedTimer <= 0) e._bleedTimer = 0;
        }
      }

      // Wall Breaker item — interact key, HOST/solo authoritative
      if (this.game.state.upgrades?.wallBreaker) {
        for (const pl of this.level.players) {
          if (!pl.alive || pl._wallBreakerUsed) continue;
          if (!pl.binding.justPressed('interact')) continue;
          // Priority check: don't fire if near downed ally or portal
          const nearDowned = this.level.players.some(
            d => d._downed && d !== pl && Math.hypot(d.x - pl.x, d.y - pl.y) <= 70
          );
          if (nearDowned) continue;
          const nearPortal = this.level.entities.some(
            e => e.isPortal && Math.hypot(e.x - pl.x, e.y - pl.y) < 85
          );
          if (nearPortal) continue;
          // Destroy all tile-2 tiles within 120px
          const RADIUS = 120;
          const { map, tileSize: ts } = this.level;
          if (!map) continue;
          const c0 = Math.max(0, Math.floor((pl.x - RADIUS) / ts));
          const c1 = Math.min(map[0].length - 1, Math.ceil((pl.x + RADIUS) / ts));
          const r0 = Math.max(0, Math.floor((pl.y - RADIUS) / ts));
          const r1 = Math.min(map.length - 1, Math.ceil((pl.y + RADIUS) / ts));
          let broke = false;
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              if (map[r]?.[c] === 2) {
                const wx = (c + 0.5) * ts;
                const wy = (r + 0.5) * ts;
                if (Math.hypot(wx - pl.x, wy - pl.y) <= RADIUS) {
                  this.level.destroyWall(c, r);
                  broke = true;
                }
              }
            }
          }
          if (broke) pl._wallBreakerUsed = true;
        }
      }
    }

    // Flush remote bindings on the HOST after level.update so justPressed flags
    // (including the new ability latch) are cleared for the next frame.
    if (this._netRole === 'host') {
      for (const rb of this._remoteBindings) rb.flush();
    }

    // ── Client-side movement smoothing (all remote entities) ─────────────────
    if (this._netRole === 'client') {
      // Rate 22 ≈ 97% of the way to target within 150 ms — fast enough to feel
      // responsive but slow enough to swallow 20hz packet gaps without hopping.
      const smooth = 1 - Math.exp(-22 * dt);

      // Remote players — axes are zeroed in _applyHostState so physics won't
      // fight the lerp; we are the sole driver of position here.
      if (this._localPlayerIdxSet.size > 0) {
        for (let i = 0; i < this.level.players.length; i++) {
          if (this._localPlayerIdxSet.has(i)) continue;
          const pl = this.level.players[i];
          if (pl._remoteX === undefined) continue;
          const err = Math.hypot(pl._remoteX - pl.x, pl._remoteY - pl.y);
          if (err > 200) { pl.x = pl._remoteX; pl.y = pl._remoteY; }
          else { pl.x += (pl._remoteX - pl.x) * smooth; pl.y += (pl._remoteY - pl.y) * smooth; }
        }
      }

      // Ghost enemies — lerp render pos (g.sx/sy) toward the latest authoritative
      // position (g.x/g.y) directly.  Using the snapshot-interpolated target added
      // an 80ms compounded delay that amplified jitter; direct lerp is smoother.
      for (const g of this._ghosts.values()) {
        if (g.sx === undefined) { g.sx = g.x; g.sy = g.y; }
        else {
          const err = Math.hypot(g.x - g.sx, g.y - g.sy);
          if (err > 200) { g.sx = g.x; g.sy = g.y; }
          else { g.sx += (g.x - g.sx) * smooth; g.sy += (g.y - g.sy) * smooth; }
        }
      }

      // Smooth projectiles — advance by velocity each frame (60fps glide),
      // expire entries that weren't refreshed in the last two packet windows.
      for (const sp of this._smoothProjPl) { sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.stale += dt; }
      for (const sp of this._smoothProjEp) { sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.stale += dt; }
      this._smoothProjPl = this._smoothProjPl.filter(sp => sp.stale < 0.12);
      this._smoothProjEp = this._smoothProjEp.filter(sp => sp.stale < 0.12);
    }

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
        const nextRoom = campaign?.[nextIdx];

        // Tell client to follow (fixes existing bug where client stayed behind)
        if (this._net) {
          this._net.send({ t: 'roomNext', roomIdx: nextIdx });
        }

        if (campaign && nextIdx < campaign.length) {
          game.state.roomIndex = nextIdx;
          game.scenes.switch(nextRoom?.type === 'shop' ? new ShopScene(game) : new GameScene(game));
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
          const pkt = this._buildStatePacket();
          const raw = JSON.stringify(pkt);
          this._netTxPkts++;
          this._netTxBytes += raw.length;
          this._net.send(pkt);
        }
      } else {
        if (this._sendTimer >= 0.016) {   // ~60 hz input — matches frame rate
          this._sendTimer = 0;
          const pkt = this._buildInputPacket();
          const raw = JSON.stringify(pkt);
          this._netTxPkts++;
          this._netTxBytes += raw.length;
          this._net.send(pkt);
        }
        // Flush remote bindings (clears justPressed after level.update reads them)
        for (const rb of this._remoteBindings) rb.flush();
      }

      // ── Net-stat rolling window (1 s) ───────────────────────────────────────
      this._netStatTimer += dt;
      if (this._netStatTimer >= 1) {
        this._netDispRx = {
          pkts: this._netRxPkts,
          kbps: +(this._netRxBytes / 1024).toFixed(1),
        };
        this._netDispTx = {
          pkts: this._netTxPkts,
          kbps: +(this._netTxBytes / 1024).toFixed(1),
        };
        // Loss % over this window
        if (this._netGsRecv + this._netGsLost > 0) {
          this._netLossPct = +((this._netGsLost / (this._netGsRecv + this._netGsLost)) * 100).toFixed(1);
        }
        this._netRxPkts = this._netRxBytes = 0;
        this._netTxPkts = this._netTxBytes = 0;
        this._netGsRecv = this._netGsLost  = 0;
        this._netStatTimer = 0;
      }

      // ── Ping (app-level RTT) — sent every 1 s ───────────────────────────────
      this._netPingTimer += dt;
      if (this._netPingTimer >= 1) {
        this._netPingTimer = 0;
        const seq = this._netPingSeq++;
        this._netPingMap.set(seq, performance.now());
        // Prune stale pings (> 5 s old)
        for (const [k, t] of this._netPingMap) {
          if (performance.now() - t > 5000) this._netPingMap.delete(k);
        }
        this._net.send({ t: 'ping', sq: seq });
      }

      // ── WebRTC stats (polled every 3 s, non-blocking) ───────────────────────
      this._netWrtcTimer += dt;
      if (this._netWrtcTimer >= 3) {
        this._netWrtcTimer = 0;
        this._net.getWebRTCStats?.().then(s => {
          this._netWrtcType = s.type;
          this._netWrtcRtt  = s.rtt;
        });
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
      sq: this._netStateSeq++,
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
        // Wall Breaker used flag — so client shows correct indicator
        wb: pl._wallBreakerUsed ? 1 : undefined,
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
            // Relay (typeIdx 5): include linked Pulsar netId as 6th field for beam sync
            const link = (e._typeIdx === 5 && e._linkedPulsarNetId) ? e._linkedPulsarNetId : 0;
            result.push(link
              ? [e._netId, e._typeIdx, ex, ey, Math.round(e.hp / e.maxHp * 255), link]
              : [e._netId, e._typeIdx, ex, ey, Math.round(e.hp / e.maxHp * 255)]);
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
      // Gold — synced so client counter matches host in real-time
      gd: this.game.state.gold,
      // Bounty-marked enemy netIds (for client gold-ring visual)
      bm: (() => {
        const marked = [];
        for (const e of ents) {
          if (e.isEnemy && e.alive && e._bountyMarked) marked.push(e._netId);
        }
        return marked.length ? marked : undefined;
      })(),
    };
  }

  /** Build input packet (client → host, ~60 hz).
   *  Only sends inputs for this device's locally-controlled players. */
  _buildInputPacket() {
    const ps = this.level.players;
    const snap = (pl, localIdx) => {
      if (!pl) return { x: 0, y: 0, ak: 0, it: 0, ab: 0 };
      const { x, y } = pl.binding.axes;
      const ab = this._abilityLatch[localIdx] ? 1 : 0;
      this._abilityLatch[localIdx] = false;  // consume latch
      return { x, y, ak: pl.binding.isHeld('attack') ? 1 : 0, it: pl.binding.isHeld('interact') ? 1 : 0, ab };
    };
    return { t: 'in', p: this._myPlayerIdxs.map((i, li) => snap(ps[i], li)) };
  }

  /** Handle an incoming network message. */
  _onNetMsg(data, peerId) {
    // ── Net stats: count every incoming packet ───────────────────────────────
    this._netRxPkts++;
    this._netRxBytes += JSON.stringify(data).length;

    // ── Ping / pong ──────────────────────────────────────────────────────────
    if (data.t === 'ping') {
      // Echo immediately — don't go through the send timer
      this._net.send({ t: 'pong', sq: data.sq });
      return;
    }
    if (data.t === 'pong') {
      const sent = this._netPingMap.get(data.sq);
      if (sent !== undefined) {
        const sample = performance.now() - sent;
        this._netPingMap.delete(data.sq);
        // Exponential moving average (α = 0.25) — damps noise while tracking trend
        this._netPingRtt = this._netPingRtt === null
          ? sample
          : this._netPingRtt * 0.75 + sample * 0.25;
      }
      return;
    }

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
      if (data.t === 'gs') {
        this._applyHostState(data);

        // ── Packet-loss & jitter tracking (CLIENT) ─────────────────────────
        if (data.sq !== undefined) {
          const now = performance.now();
          // Loss: count gaps in sequence numbers
          if (this._netExpSeq === -1) {
            this._netExpSeq = data.sq + 1;
          } else {
            const gap = data.sq - this._netExpSeq;
            if (gap > 0) this._netGsLost += gap;   // missing packets
            this._netExpSeq = data.sq + 1;
          }
          this._netGsRecv++;
          // Jitter: track inter-arrival time variance
          if (this._netLastGsTime > 0) {
            const interval = now - this._netLastGsTime;
            this._netJitterBuf.push(interval);
            if (this._netJitterBuf.length > 20) this._netJitterBuf.shift();
            const mean = this._netJitterBuf.reduce((a, b) => a + b, 0) / this._netJitterBuf.length;
            this._netJitter = +(this._netJitterBuf.reduce((a, b) => a + Math.abs(b - mean), 0) / this._netJitterBuf.length).toFixed(1);
          }
          this._netLastGsTime = now;
        }
      }

      // Host explicitly signals game-over before switching to DeathScene.
      // The normal "all players dead" check in update() runs BEFORE the network
      // send block, so the host scene-switches without sending a final gs packet.
      // This message ensures the client always follows the host to DeathScene.
      if (data.t === 'gameover') {
        this.game.scenes.switch(new DeathScene(this.game));
      }

      // Host portal transition — client follows immediately (server-authoritative).
      // This fixes the pre-existing bug where the client never received the room-advance
      // signal and stayed frozen in the old GameScene after the host moved on.
      if (data.t === 'roomNext') {
        const g        = this.game;
        const campaign = g.maps?.campaign;
        const nextIdx  = data.roomIdx;
        if (!campaign || nextIdx >= campaign.length) {
          g.state.roomIndex = 0;
          g.scenes.switch(new TitleScene(g));
        } else {
          g.state.roomIndex = nextIdx;
          const nextRoom = campaign[nextIdx];
          g.scenes.switch(nextRoom?.type === 'shop' ? new ShopScene(g) : new GameScene(g));
        }
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
          // Store authoritative target — the update() loop lerps toward it each frame.
          // Zero out movement axes so player.update() physics doesn't fight the lerp
          // (facing is already handled via pd.fx/fy above).
          pl._remoteX = pd.x;
          pl._remoteY = pd.y;
          pl.binding.applyRemote?.({ x: 0, y: 0, ak: 0, it: 0 });
          // Sync facing arrow direction from the host's movement axes.
          // Player.update() only updates _moveDirX/Y when axes are non-zero,
          // but RemoteBinding always returns zero — so we drive it directly here.
          if (pd.ax !== 0 || pd.ay !== 0) {
            const mlen = Math.hypot(pd.ax, pd.ay) || 1;
            pl._moveDirX = pd.ax / mlen;
            pl._moveDirY = pd.ay / mlen;
          }
        } else {
          // Local player — client-side prediction.
          // The client's own physics runs at 60 fps from real keyboard input.
          // Only snap if the host disagrees by more than 60 px (wall correction,
          // teleport, etc.).  This eliminates the 20 hz hard-snap jumpiness.
          const err = Math.hypot(pd.x - pl.x, pd.y - pl.y);
          if (err > 60) { pl.x = pd.x; pl.y = pd.y; }
        }

        // Authoritative HP + downed state for all players
        pl.hp = Math.max(0, pd.hp);
        if (pd.d && !pl._downed) { pl._downed = true;  pl.alive = false; }
        if (!pd.d && pl._downed) { pl._downed = false; pl.alive = true;  }

        // Wall Breaker used state — keep indicator in sync on client
        if (pd.wb !== undefined) pl._wallBreakerUsed = !!pd.wb;

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
        const linkedNetId = entry.length >= 6 ? entry[5] : 0;
        if (g) {
          g.x = x; g.y = y; g.hpPct = hpPct; // latest authoritative pos (used for aim proxies)
          g.snaps.push({ t: nowMs, x, y });
          if (g.snaps.length > 6) g.snaps.shift();
          if (linkedNetId) g.linkedNetId = linkedNetId;
        } else {
          this._ghosts.set(id, { id, typeIdx, x, y, hpPct, linkedNetId, snaps: [{ t: nowMs, x, y }] });
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

    // Ghost projectiles — merge into persistent smooth lists so positions glide
    if (state.proj) {
      this._ghostProjSw = state.proj.sw ?? [];   // sword swings: short-lived, no smooth needed

      // Helper: match received entry to closest existing smooth entry (by color + proximity),
      // lerp its position 35% toward authoritative, reset stale timer; create new if unmatched.
      const mergeProj = (received, smoothList, useColor) => {
        const MATCH_D = 90, LERP = 0.35;
        const matched = new Set();
        for (const entry of received) {
          const [rx, ry, rvx, rvy, color] = entry;
          let best = null, bestD = MATCH_D;
          for (const sp of smoothList) {
            if (useColor && sp.color !== color) continue;
            const d = Math.hypot(rx - sp.x, ry - sp.y);
            if (d < bestD && !matched.has(sp)) { bestD = d; best = sp; }
          }
          if (best) {
            best.x  += (rx - best.x) * LERP;
            best.y  += (ry - best.y) * LERP;
            best.vx  = rvx; best.vy = rvy;
            best.stale = 0;
            matched.add(best);
          } else {
            const sp = { x: rx, y: ry, vx: rvx, vy: rvy, stale: 0 };
            if (useColor) sp.color = color;
            smoothList.push(sp);
          }
        }
      };

      mergeProj(state.proj.pl ?? [], this._smoothProjPl, true);
      mergeProj(state.proj.ep ?? [], this._smoothProjEp, false);
    }

    // FX events: spawn death particles + visual gold shards on client
    if (state.ev) {
      for (const ev of state.ev) {
        if (ev.k === 'd') {
          this.level.spawnDeathParticles(ev.x, ev.y, ev.c, ev.n);
          this._spawnGoldShards(ev.x, ev.y, ev.n);   // visual-only on client
        }
        // Tile destroy — apply to client's map (wall breaker / other destruction)
        if (ev.k === 'td') {
          this.level.destroyWall?.(ev.c, ev.r);
          // Salvage visual shards on client
          if (this.game.state.upgrades?.salvage) {
            const ts = this.level.tileSize ?? 40;
            this._spawnGoldShards((ev.c + 0.5) * ts, (ev.r + 0.5) * ts, 4);
          }
        }
      }
    }

    // Sync gold counter from host (authoritative)
    if (state.gd !== undefined) this.game.state.gold = state.gd;

    // Bounty marks — update ghost markers
    if (state.bm !== undefined) {
      const marked = new Set(state.bm);
      for (const g of this._ghosts.values()) {
        g.bountyMarked = marked.has(g.id);
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
      // Spawn portal once host flags boss defeated.
      // onEnter is left empty — the actual room transition is driven by the
      // 'roomNext' message from the host, making it server-authoritative.
      if (this._remoteWave.bd && !this._portalSpawned) {
        const portal = new Portal(this.level, this._introCX, this._introCY);
        portal.onEnter = () => {}; // visual beacon only; 'roomNext' drives the transition
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

    // Gold shards — drawn on top of the map in world space
    if (this._goldShards.length > 0) this._drawGoldShards(ctx);

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

    // Net overlay (Y to toggle, online only)
    if (this._netOverlayOn && this._netRole) this._drawNetOverlay(ctx);

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
      // Use lerp-smoothed render position (g.sx/sy updated in update())
      // Falls back to interpolated value on first frame before update() ran.
      const x = g.sx ?? g.x, y = g.sy ?? g.y;
      const gv = { ...g, x, y };
      switch (gv.typeIdx) {
        case 0: this._drawGhostEnemy(ctx, gv);    break;
        case 1: this._drawGhostSprinter(ctx, gv); break;
        case 2: this._drawGhostRanger(ctx, gv);   break;
        case 3: this._drawGhostBoss(ctx, gv);     break;
        case 4: this._drawGhostPulsar(ctx, gv);   break;
        case 5: this._drawGhostRelay(ctx, gv);    break;
      }
      // Bounty mark — gold ring on marked enemies
      if (gv.bountyMarked) {
        const RADII = [12, 9, 13, 38, 14, 8];
        const r   = (RADII[gv.typeIdx] ?? 12) + 6;
        const pa  = 0.55 + 0.25 * Math.sin(Date.now() / 240);
        ctx.save();
        ctx.globalAlpha  = pa;
        ctx.strokeStyle  = '#ffd166';
        ctx.lineWidth    = 2.5;
        ctx.shadowColor  = '#ffd166';
        ctx.shadowBlur   = 8;
        ctx.beginPath();
        ctx.arc(gv.x, gv.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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

    // Energy tether to paired Pulsar (mirrors Relay.draw)
    if (g.linkedNetId) {
      const pg = this._ghosts.get(g.linkedNetId);
      if (pg) {
        const { x: px, y: py } = this._ghostInterp(pg);
        const t = (performance.now() / 625) % 1; // matches Relay's _pulseT * 1.6
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.10; ctx.strokeStyle = COLOR; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
        ctx.globalAlpha = 0.28; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
        ctx.globalAlpha = 0.68; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
        ctx.globalAlpha = 0.82; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
        // Animated pulse dot
        const dotX = x + (px - x) * t;
        const dotY = y + (py - y) * t;
        ctx.globalAlpha = 0.9 * Math.sin(t * Math.PI);
        ctx.fillStyle   = '#ffffff';
        ctx.beginPath(); ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

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

  /**
   * Draw one arrow at (x,y) facing (dx,dy) with perpendicular (px,py) at given alpha.
   * Mirrors Projectile._drawArrow so ghost arrows match the real ones exactly.
   */
  _drawGhostArrow(ctx, x, y, dx, dy, px, py, alpha, color) {
    if (alpha < 0.01) return;
    const HEAD_FWD = 8, SHAFT_BK = 13, BASE_BK = 3, HEAD_WING = 4.5;
    const FLETCH_BK = 10, FLETCH_W = 4, FLETCH_FW = 3;

    const tipX  = x + dx * HEAD_FWD,   tipY  = y + dy * HEAD_FWD;
    const baseX = tipX - dx * BASE_BK,  baseY = tipY - dy * BASE_BK;
    const tailX = x - dx * SHAFT_BK,   tailY = y - dy * SHAFT_BK;
    const flBX  = x - dx * FLETCH_BK,  flBY  = y - dy * FLETCH_BK;

    ctx.save();
    ctx.lineCap = 'round';

    ctx.globalAlpha = alpha * 0.10; ctx.strokeStyle = color; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke();

    ctx.globalAlpha = alpha * 0.27; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke();

    ctx.globalAlpha = alpha * 0.78; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX, baseY); ctx.stroke();

    ctx.globalAlpha = alpha * 0.92; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX, baseY); ctx.stroke();

    ctx.globalAlpha = alpha * 0.92; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * HEAD_WING, baseY + py * HEAD_WING);
    ctx.lineTo(baseX - px * HEAD_WING, baseY - py * HEAD_WING);
    ctx.closePath(); ctx.fill();

    ctx.globalAlpha = alpha * 0.78; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * HEAD_WING * 0.38, baseY + py * HEAD_WING * 0.38);
    ctx.lineTo(baseX - px * HEAD_WING * 0.38, baseY - py * HEAD_WING * 0.38);
    ctx.closePath(); ctx.fill();

    ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(flBX + px * FLETCH_W, flBY + py * FLETCH_W);
    ctx.lineTo(flBX + dx * FLETCH_FW, flBY + dy * FLETCH_FW);
    ctx.lineTo(flBX - px * FLETCH_W, flBY - py * FLETCH_W);
    ctx.stroke();
    ctx.restore();
  }

  /** Draw ghost projectiles on the client (host-local player attacks + enemies). */
  _drawGhostProjectiles(ctx) {
    // Smooth lists are velocity-advanced every frame in update() — no extrapolDt needed here.

    // Player projectiles — full arrow + synthetic trail
    for (const sp of this._smoothProjPl) {
      const { x, y, vx, vy, color } = sp;
      const speed = Math.hypot(vx, vy) || 1;
      const dx = vx / speed, dy = vy / speed;
      const px = -dy, py = dx;
      const TRAIL = 8, DT = 1 / 60;
      for (let i = 0; i < TRAIL; i++) {
        const frac = (i + 1) / (TRAIL + 1);
        const tx   = x - dx * speed * DT * (TRAIL - i);
        const ty   = y - dy * speed * DT * (TRAIL - i);
        this._drawGhostArrow(ctx, tx, ty, dx, dy, px, py, frac * 0.44, color);
      }
      this._drawGhostArrow(ctx, x, y, dx, dy, px, py, 1, color);
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
    for (const sp of this._smoothProjEp) {
      const { x: ex, y: ey, vx, vy } = sp;
      const speed = Math.hypot(vx, vy) || 1;
      const tx    = ex - (vx / speed) * 18;
      const ty    = ey - (vy / speed) * 18;

      const grad = ctx.createLinearGradient(tx, ty, ex, ey);
      grad.addColorStop(0, 'rgba(255,140,0,0)');
      grad.addColorStop(1, 'rgba(255,140,0,0.45)');
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 9.8;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(ex, ey); ctx.stroke();

      const pulse = 0.35 + 0.15 * Math.sin(Date.now() / 120);
      ctx.strokeStyle = `rgba(255,160,0,${pulse})`;
      ctx.lineWidth   = 3;
      ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffb833';
      ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.arc(ex, ey, 3.15, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  // ── Gold shard system ────────────────────────────────────────────────────────

  /**
   * Spawn small gold diamond particles at the enemy death position.
   * count is the death-particle count — used to infer enemy tier.
   * mult is a gold-value multiplier (default 1; 3 for bounty-marked enemies).
   * Each shard carries a gold `value`; only counted on HOST/solo.
   */
  _spawnGoldShards(x, y, count, mult = 1) {
    // Infer enemy tier from particle count (boss ~30, elite ~22, normal ~15)
    const isBoss  = count >= 28;
    const isElite = !isBoss && count >= 20;
    const shards  = isBoss ? 12 : isElite ? 6 : 4;
    const value   = Math.round((isBoss ? 12 : isElite ? 5 : 3) * mult);  // per shard; totals: 144 / 30 / 12 (×mult for bounty)
    for (let i = 0; i < shards; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 80;
      this._goldShards.push({
        x, y,
        vx:    Math.cos(angle) * speed,
        vy:    Math.sin(angle) * speed,
        value,
        size:   isBoss ? 4.5 : 3.0,
        angle:  Math.random() * Math.PI * 2,
        spin:   (Math.random() - 0.5) * 6,
        life:   30 + Math.random() * 20,    // persists ~30-50 s
      });
    }
  }

  /** Advance gold shard physics each frame. */
  _updateGoldShards(dt) {
    const px = this._introCX;
    const py = this._introCY;
    const isClient = this._netRole === 'client';

    for (let i = this._goldShards.length - 1; i >= 0; i--) {
      const s = this._goldShards[i];
      s.angle += s.spin * dt;
      s.life  -= dt;

      if (this._portalSpawned) {
        // Suction: accelerate toward portal, speed proportional to inverse distance
        const dx   = px - s.x;
        const dy   = py - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = (300 / dist + 160) * dt;
        s.vx += (dx / dist) * pull;
        s.vy += (dy / dist) * pull;
        // Cap speed so they don't overshoot at close range
        const spd = Math.hypot(s.vx, s.vy);
        if (spd > 550) { s.vx = s.vx / spd * 550; s.vy = s.vy / spd * 550; }
        // Collect on arrival
        if (dist < 14) {
          if (!isClient) this.game.state.gold += s.value;
          this._goldShards.splice(i, 1);
          continue;
        }
      } else {
        // Free drift: rapid deceleration + very gentle upward float
        const fric = Math.pow(0.12, dt);   // ~12% velocity remaining after 1 s
        s.vx *= fric;
        s.vy  = s.vy * fric - 6 * dt;     // slight upward creep
      }

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Expire shards that somehow outlived even the fight (safety valve)
      if (s.life <= 0) this._goldShards.splice(i, 1);
    }
  }

  /** Draw gold diamond shards in world space. */
  _drawGoldShards(ctx) {
    const t = Date.now() * 0.001;
    ctx.save();
    for (const s of this._goldShards) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 5.2 + s.x * 0.08);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.globalAlpha  = pulse * 0.92;
      ctx.fillStyle    = '#ffd166';
      ctx.shadowColor  = 'rgba(255,209,102,0.9)';
      ctx.shadowBlur   = 7;
      const sz = s.size;
      ctx.beginPath();
      ctx.moveTo(0,   -sz);
      ctx.lineTo(sz * 0.55,  0);
      ctx.lineTo(0,    sz);
      ctx.lineTo(-sz * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      // White highlight facet
      ctx.globalAlpha  = pulse * 0.55;
      ctx.fillStyle    = '#fff8d0';
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.28, -sz * 0.35);
      ctx.lineTo(0,  sz * 0.2);
      ctx.lineTo(-sz * 0.28, -sz * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  _drawNetOverlay(ctx) {
    const W = this.game.canvas.width;
    const role = this._netRole === 'host' ? 'HOST' : 'CLIENT';

    // Build rows
    const rows = [];
    rows.push({ label: `NET  [${role}]`, value: 'Y to hide', dim: true });
    rows.push(null); // spacer

    // App-level ping
    const ping = this._netPingRtt !== null ? `${Math.round(this._netPingRtt)} ms` : '…';
    const pingColor = this._netPingRtt === null ? '#aaa'
      : this._netPingRtt < 60  ? '#7fff7f'
      : this._netPingRtt < 120 ? '#ffd166'
      : '#ff6b6b';
    rows.push({ label: 'Ping  (app)', value: ping, color: pingColor });

    // WebRTC stack RTT (more accurate, polled every 3 s)
    const wRtt = this._netWrtcRtt !== null ? `${this._netWrtcRtt} ms` : '…';
    rows.push({ label: 'RTT  (WebRTC)', value: wRtt });

    // Connection type — this is the KEY relay-vs-direct indicator
    const typeLabel = {
      relay:  'RELAY  ⚠ thru server',
      srflx:  'srflx  (P2P / NAT)',
      host:   'host   (LAN / direct)',
      prflx:  'prflx  (P2P)',
      '…':    '…',
      '?':    '?',
    }[this._netWrtcType] ?? this._netWrtcType;
    const typeColor = this._netWrtcType === 'relay' ? '#ff9944'
      : this._netWrtcType === '…' || this._netWrtcType === '?' ? '#aaa'
      : '#7fff7f';
    rows.push({ label: 'Conn type', value: typeLabel, color: typeColor });

    rows.push(null);

    // Packet loss + jitter (CLIENT only — measures incoming gs stream)
    if (this._netRole === 'client') {
      const lossColor = this._netLossPct === 0 ? '#7fff7f'
        : this._netLossPct < 3 ? '#ffd166' : '#ff6b6b';
      rows.push({ label: 'Pkt loss', value: `${this._netLossPct}%`, color: lossColor });
      rows.push({ label: 'Jitter', value: this._netJitter > 0 ? `${this._netJitter} ms` : '…' });
      rows.push(null);
    }

    // Throughput
    rows.push({ label: 'RX', value: `${this._netDispRx.pkts} pkt/s  ${this._netDispRx.kbps} KB/s` });
    rows.push({ label: 'TX', value: `${this._netDispTx.pkts} pkt/s  ${this._netDispTx.kbps} KB/s` });

    // DataChannel buffer (congestion indicator)
    const buf = this._net?.getBufferedAmount?.() ?? 0;
    const bufStr = buf < 1024 ? `${buf} B` : `${(buf / 1024).toFixed(1)} KB`;
    const bufColor = buf < 8192 ? '#7fff7f' : buf < 65536 ? '#ffd166' : '#ff6b6b';
    rows.push({ label: 'DC buffer', value: bufStr, color: bufColor });

    // ── Draw ──────────────────────────────────────────────────────────────────
    const PX = 10, PY = 10;
    const ROW_H = 17, PAD = 10;
    const totalH = rows.length * ROW_H + PAD * 2;
    const boxW   = 268;
    const bx = W - boxW - PX;
    const by = PY;

    ctx.save();
    ctx.fillStyle   = 'rgba(6,10,24,0.84)';
    ctx.strokeStyle = 'rgba(140,243,255,0.2)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, totalH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font      = '12px "Trebuchet MS", monospace';
    ctx.textBaseline = 'middle';

    let y = by + PAD + ROW_H / 2;
    for (const row of rows) {
      if (!row) { y += ROW_H; continue; }
      const { label, value, color, dim } = row;
      ctx.textAlign = 'left';
      ctx.fillStyle = dim ? 'rgba(140,243,255,0.5)' : 'rgba(255,255,255,0.45)';
      ctx.fillText(label, bx + PAD, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = color ?? 'rgba(255,255,255,0.9)';
      ctx.fillText(value, bx + boxW - PAD, y);
      y += ROW_H;
    }
    ctx.restore();
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

    // Top-right: gold counter — always visible
    const gold = this.game.state.gold ?? 0;
    ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    const goldText = `◈ ${gold}`;
    const goldTw   = ctx.measureText(goldText).width;
    ctx.fillStyle   = 'rgba(8,14,26,0.65)';
    ctx.beginPath(); ctx.roundRect(W - goldTw - 26, 10, goldTw + 16, 20, 4); ctx.fill();
    ctx.fillStyle   = gold > 0 ? '#ffd166' : 'rgba(255,209,102,0.32)';
    ctx.fillText(goldText, W - 16, 14);

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
