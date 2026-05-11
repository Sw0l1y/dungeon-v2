import { EnemyProjectile } from './EnemyProjectile.js';
import { Sprinter }         from './Sprinter.js';

const MAX_HP = 800;
const RADIUS = 38;

// Phase HP thresholds
const P2_PCT = 0.60;
const P3_PCT = 0.35;

// Spiral
const SPIRAL_RATE_P12  = 2.0;   // rad/s phases 1-2
const SPIRAL_RATE_P3   = 0.9;   // rad/s phase 3 (slower, more readable)
const SPIRAL_INTERVAL  = 0.14;  // seconds between spiral shots
const SPIRAL_SPEED     = 115;

// Aimed burst (phases 1 & 2 — phase 3 uses the state machine instead)
const BURST_COOLDOWN   = 4.5;
const BURST_TELEGRAPH  = 0.8;
const BURST_COUNT      = 4;
const BURST_SPREAD     = 0.22;  // half-spread in radians
const BURST_SPEED      = 155;

// Phase 2 sprinter spawning
const SPAWN_INTERVAL   = 7.0;
const SPRINTER_CAP     = 4;

// Phase 3 cycle durations (seconds)
const P3T = {
  IDLE:      1.8,
  TELEGRAPH: 0.85,
  LUNGE:     1.1,
  PAUSE:     0.65,  // vulnerability window
};
const LUNGE_SPEED = 230;

export class Boss {
  constructor(level, x, y, config = null) {
    this.level   = level;
    this.x       = x;
    this.y       = y;
    this.radius  = RADIUS;
    this.maxHp   = config?.bossHp    ?? MAX_HP;
    this.hp      = this.maxHp;
    this._p2Pct  = config?.bossP2Pct != null ? config.bossP2Pct / 100 : P2_PCT;
    this._p3Pct  = config?.bossP3Pct != null ? config.bossP3Pct / 100 : P3_PCT;
    this.alive   = true;
    this.isEnemy  = true;
    this.isBoss   = true;
    this.instantKillImmune = true;
    this._typeIdx = 3;   // for net serialization: 3=Boss
    this._netId   = 0;
    this.damage   = 20;

    // Spiral state
    this._spiralAngle   = 0;
    this._spiralTimer   = 0;

    // Burst state (phases 1 & 2)
    this._burstTimer     = BURST_COOLDOWN;
    this._burstTelegraph = 0;
    this._burstTarget    = null;

    // Phase 2 spawn timer
    this._spawnTimer = SPAWN_INTERVAL;

    // Phase 3 state machine
    this._p3State   = 'idle';
    this._p3Timer   = P3T.IDLE;
    this._p3Dir     = { x: 1, y: 0 };
    this._p3Target  = null;
    this._vulnerable = false;

    // Contact damage
    this._hitCooldown    = 0;
    // How long since the boss last landed a hit on a player.
    // Used to throttle the destructive lunge so the boss can't
    // spam wall-smashing while the player stays out of reach.
    this._noDamageTimer  = 0;
  }

  // ── phase helper ───────────────────────────────────────────────────────────

  get _phase() {
    const pct = this.hp / this.maxHp;
    return pct > this._p2Pct ? 1 : pct > this._p3Pct ? 2 : 3;
  }

  // ── damage / death ────────────────────────────────────────────────────────

  takeDamage(amount, source = null) {
    if (!this.alive) return;
    const mult   = this._vulnerable ? 1.5 : 1.0;
    const dmg    = amount * mult;
    const actual = Math.min(dmg, this.hp);
    this.hp      = Math.max(0, this.hp - dmg);
    if (source) source.dmgDealt = (source.dmgDealt || 0) + actual;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.level.spawnDeathParticles(this.x, this.y, '#cc2200', 40);
    this.level.removeEntity(this);
    const stats = this.level.game?.state?.stats;
    if (stats) stats.enemiesKilled++;
    const wm = this.level.game?.state?._waveManager;
    if (wm) wm.bossDefeated = true;
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(dt) {
    if (!this.alive) return;

    // Contact damage
    this._hitCooldown    = Math.max(0, this._hitCooldown - dt);
    this._noDamageTimer += dt;
    if (this._hitCooldown === 0) {
      for (const p of this.level.players) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius + 4) {
          p.takeDamage(this.damage);
          this._hitCooldown   = 1.2;
          this._noDamageTimer = 0;   // reset — boss just landed a hit
          break;
        }
      }
    }

    const phase = this._phase;
    if (phase <= 2) {
      this._updateSpiral(dt, SPIRAL_RATE_P12);
      this._updateBurst(dt);
      if (phase === 2) this._updateSpawnTimer(dt);
    } else {
      this._updatePhase3(dt);
    }
  }

  // ── spiral ────────────────────────────────────────────────────────────────

  _updateSpiral(dt, rate) {
    this._spiralAngle += rate * dt;
    this._spiralTimer -= dt;
    if (this._spiralTimer <= 0) {
      this._spiralTimer = SPIRAL_INTERVAL;
      const vx = Math.cos(this._spiralAngle) * SPIRAL_SPEED;
      const vy = Math.sin(this._spiralAngle) * SPIRAL_SPEED;
      this.level.addEntity(new EnemyProjectile(this.level, this.x, this.y, vx, vy));
    }
  }

  // ── aimed burst (phases 1 & 2) ────────────────────────────────────────────

  _updateBurst(dt) {
    if (this._burstTelegraph > 0) {
      this._burstTelegraph -= dt;
      if (this._burstTelegraph <= 0) this._fireBurst(this._burstTarget);
      return;
    }
    this._burstTimer -= dt;
    if (this._burstTimer <= 0) {
      this._burstTimer     = BURST_COOLDOWN;
      this._burstTarget    = this._nearestPlayer();
      this._burstTelegraph = BURST_TELEGRAPH;
    }
  }

  _fireBurst(target) {
    if (!target?.alive) return;
    const dx   = target.x - this.x, dy = target.y - this.y;
    const base = Math.atan2(dy, dx);
    const count = BURST_COUNT;
    for (let i = 0; i < count; i++) {
      const spread = count === 1 ? 0 : ((i / (count - 1)) - 0.5) * BURST_SPREAD * 2;
      const a = base + spread;
      this.level.addEntity(new EnemyProjectile(
        this.level, this.x, this.y,
        Math.cos(a) * BURST_SPEED, Math.sin(a) * BURST_SPEED,
      ));
    }
  }

  // ── sprinter spawning ─────────────────────────────────────────────────────

  _updateSpawnTimer(dt) {
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = SPAWN_INTERVAL;
      this._spawnSprinters(2);
    }
  }

  _spawnSprinters(count) {
    const active  = this.level.entities.filter(e => e.isSprinter && e.alive).length;
    const toSpawn = Math.min(count, SPRINTER_CAP - active);
    const { map, tileSize: ts } = this.level;
    for (let i = 0; i < toSpawn; i++) {
      // Try up to 12 candidate angles, pick first that lands on a floor tile
      let placed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const a    = (Math.random() + attempt / 12) * Math.PI * 2;
        const dist = this.radius + 70 + Math.random() * 50;
        const sx   = this.x + Math.cos(a) * dist;
        const sy   = this.y + Math.sin(a) * dist;
        const col  = Math.floor(sx / ts);
        const row  = Math.floor(sy / ts);
        if ((map[row]?.[col] ?? 1) === 0) {
          this.level.addEntity(new Sprinter(this.level, sx, sy));
          placed = true;
          break;
        }
      }
      // Skip this spawn if no clear tile found (prevents stuck-in-wall sprinters)
    }
  }

  // ── phase 3 state machine ─────────────────────────────────────────────────

  _updatePhase3(dt) {
    // Slow spiral runs during all p3 states except lunge
    if (this._p3State !== 'lunge') this._updateSpiral(dt, SPIRAL_RATE_P3);

    this._p3Timer   -= dt;
    this._vulnerable = this._p3State === 'pause';

    if (this._p3State === 'idle' && this._p3Timer <= 0) {
      // If the boss hasn't landed a hit in 6 s, it isn't close enough to the
      // player to make the destructive dash worth it — add a full extra idle
      // cycle before committing to the lunge.
      if (this._noDamageTimer > 6) {
        this._p3Timer = P3T.IDLE;   // wait another idle period
      } else {
        this._p3Target = this._nearestPlayer();
        if (this._p3Target) {
          const dx = this._p3Target.x - this.x, dy = this._p3Target.y - this.y;
          const len = Math.hypot(dx, dy) || 1;
          this._p3Dir = { x: dx / len, y: dy / len };
        }
        this._p3State = 'telegraph';
        this._p3Timer = P3T.TELEGRAPH;
      }

    } else if (this._p3State === 'telegraph' && this._p3Timer <= 0) {
      this._p3State = 'lunge';
      this._p3Timer = P3T.LUNGE;

    } else if (this._p3State === 'lunge') {
      const nx = this.x + this._p3Dir.x * LUNGE_SPEED * dt;
      const ny = this.y + this._p3Dir.y * LUNGE_SPEED * dt;
      if (!this._collidesAt(nx, this.y)) this.x = nx;
      if (!this._collidesAt(this.x, ny)) this.y = ny;
      this._destroyWallsAt();
      if (this._p3Timer <= 0) {
        this._p3State = 'pause';
        this._p3Timer = P3T.PAUSE;
      }

    } else if (this._p3State === 'pause' && this._p3Timer <= 0) {
      // Fire burst + spawn sprinters, then return to idle
      this._fireBurst(this._nearestPlayer());
      this._spawnSprinters(2);
      this._p3State = 'idle';
      this._p3Timer = P3T.IDLE;
    }

    // Phase 2 spawn timer continues in phase 3
    this._updateSpawnTimer(dt);
  }

  // ── wall destruction ──────────────────────────────────────────────────────

  _destroyWallsAt() {
    const { map, tileSize: ts } = this.level;
    const rows = map.length, cols = map[0].length;
    const r    = this.radius + 2;
    const minC = Math.floor((this.x - r) / ts);
    const maxC = Math.floor((this.x + r) / ts);
    const minR = Math.floor((this.y - r) / ts);
    const maxR = Math.floor((this.y + r) / ts);

    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) {
        if (row <= 0 || row >= rows - 1 || col <= 0 || col >= cols - 1) continue;
        if (map[row]?.[col] !== 2) continue;
        this.level.destroyWall(col, row);
      }
    }
  }

  // Boss only stops at permanent walls (=== 1), ignores destructible (=== 2)
  _collidesAt(x, y) {
    const r  = this.radius - 6;
    const { map, tileSize: ts } = this.level;
    for (const [px, py] of [[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r],[x,y]]) {
      const col = Math.floor(px / ts);
      const row = Math.floor(py / ts);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) return true;
      if (map[row][col] === 1) return true;
    }
    return false;
  }

  _nearestPlayer() {
    let nearest = null, best = Infinity;
    for (const p of this.level.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < best) { best = d; nearest = p; }
    }
    return nearest;
  }

  // ── draw ──────────────────────────────────────────────────────────────────

  draw(ctx) {
    const phase   = this._phase;
    const hpPct   = this.hp / this.maxHp;
    const t       = Date.now();
    const flicker = phase === 3 && Math.floor(t / 110) % 3 === 0;

    const bodyColor   = phase === 1 ? '#6b0018' : phase === 2 ? '#7a2200' : '#990000';
    const accentColor = phase === 3 ? '#ff3333' : phase === 2 ? '#ff7733' : '#ff2244';

    // Outer glow
    ctx.strokeStyle = flicker ? 'rgba(255,200,200,0.75)' : accentColor + '66';
    ctx.lineWidth   = 10;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 14, 0, Math.PI * 2); ctx.stroke();

    // Phase 2+ pulse ring
    if (phase >= 2) {
      const pulse = 0.35 + 0.2 * Math.sin(t / 190);
      ctx.strokeStyle = `rgba(255,130,0,${pulse})`;
      ctx.lineWidth   = 4;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 26, 0, Math.PI * 2); ctx.stroke();
    }

    // Body fill
    ctx.fillStyle = flicker ? '#cc2200' : bodyColor;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();

    // Inner rotating ring
    ctx.strokeStyle = flicker ? 'rgba(255,255,255,0.6)' : accentColor + '99';
    ctx.lineWidth   = 2.5;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 0.58, 0, Math.PI * 2); ctx.stroke();

    // Rotating spokes
    ctx.strokeStyle = accentColor + '55';
    ctx.lineWidth   = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = this._spiralAngle + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(a) * this.radius * 0.52, this.y + Math.sin(a) * this.radius * 0.52);
      ctx.stroke();
    }

    // Eye
    ctx.fillStyle = flicker ? '#ffffff' : '#ffbbbb';
    ctx.beginPath(); ctx.arc(this.x, this.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#330000';
    ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI * 2); ctx.fill();

    // Burst telegraph (phases 1 & 2)
    if (this._burstTelegraph > 0 && this._burstTarget?.alive) {
      const prog  = 1 - this._burstTelegraph / BURST_TELEGRAPH;
      const alpha = 0.3 + 0.45 * Math.sin(prog * Math.PI * 4);
      const dx    = this._burstTarget.x - this.x, dy = this._burstTarget.y - this.y;
      const len   = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = `rgba(255,200,0,${alpha})`;
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + (dx / len) * 90, this.y + (dy / len) * 90);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(255,200,0,${0.55 - prog * 0.3})`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 16 + prog * 28, 0, Math.PI * 2); ctx.stroke();
    }

    // Phase 3 telegraph (lunge direction indicator)
    if (this._p3State === 'telegraph') {
      const prog  = 1 - this._p3Timer / P3T.TELEGRAPH;
      const alpha = 0.5 + 0.35 * Math.sin(prog * Math.PI * 5);
      ctx.strokeStyle = `rgba(255,60,0,${alpha})`;
      ctx.lineWidth   = 4;
      ctx.setLineDash([14, 8]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this._p3Dir.x * 220, this.y + this._p3Dir.y * 220);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Vulnerability window indicator
    if (this._vulnerable) {
      const pulse = 0.4 + 0.35 * Math.sin(t / 75);
      ctx.strokeStyle = `rgba(80,255,120,${pulse})`;
      ctx.lineWidth   = 6;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(80,255,120,0.07)`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
    }

    this._drawHealthBar(ctx, phase);
  }

  _drawHealthBar(ctx, phase) {
    const barW = 96, barH = 9;
    const barX = this.x - barW / 2;
    const barY = this.y - this.radius - 24;

    // BG
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath(); ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 3); ctx.fill();

    // Fill
    const pct = this.hp / this.maxHp;
    ctx.fillStyle = pct > this._p2Pct ? '#e03030' : pct > this._p3Pct ? '#e07020' : '#ff2020';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * pct, barH, 2); ctx.fill();

    // Phase threshold markers
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = 1;
    for (const marker of [this._p2Pct, this._p3Pct]) {
      const mx = barX + barW * marker;
      ctx.beginPath(); ctx.moveTo(mx, barY - 1); ctx.lineTo(mx, barY + barH + 1); ctx.stroke();
    }

    // Label
    ctx.fillStyle   = '#ff8888';
    ctx.font        = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`BOSS  •  Phase ${phase}`, this.x, barY - 3);
  }
}
