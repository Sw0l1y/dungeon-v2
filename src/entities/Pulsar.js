import { astar } from '../systems/Pathfinding.js';

export const PULSAR_COLOR  = '#22ff55';
const PROX_RADIUS   = 46;    // player within this → explode
const BLAST_RANGE   = 120;   // shockwave damage radius
const BLAST_DMG     = 45;
const KNOCKBACK_SPD = 400;   // px/s impulse on players
const EXPLODE_CD    = 2.8;   // seconds between blasts
const WAVE_DUR      = 0.45;  // shockwave expands over this time

export class Pulsar {
  constructor(level, x, y, relay) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.relay    = relay;   // paired Relay (set at spawn time)
    this.radius   = 14;
    this.speed    = 50;
    this.maxHp    = 90;
    this.hp       = 90;
    this.alive    = true;
    this.isEnemy  = true;
    this.instantKillImmune = true;
    this.damage   = 0;       // damage dealt only via shockwave
    this._typeIdx = 4;
    this._netId   = 0;

    this._explodeCd  = 1.2;  // brief arm delay on spawn
    this._shockwaves = [];   // [{r, alpha}]
    this._shieldT    = 0;    // animation clock
    this._hitCooldown = 0;
    this._path        = [];
    this._pathTimer   = 0;
  }

  /** True while the Relay is alive and providing protection. */
  get _shielded() { return !!(this.relay?.alive); }

  takeDamage(amount, source, type = 'ranged') {
    if (!this.alive) return;

    // Any hit detonates (melee still triggers the blast, just deals 0 hp damage)
    this._triggerExplosion();

    if (this._shielded) {
      if (type === 'melee') return;             // fully immune
      amount = Math.round(amount * 0.35);       // ranged at 35%
    }
    if (amount <= 0) return;
    const dealt = Math.min(amount, this.hp);
    this.hp = Math.max(0, this.hp - amount);
    if (source) source.dmgDealt = (source.dmgDealt || 0) + dealt;
    if (this.hp <= 0) this.die();
  }

  _triggerExplosion() {
    if (!this._shielded) return;     // relay must be alive to detonate
    if (this._explodeCd > 0) return;
    this._explodeCd = EXPLODE_CD;
    this._shockwaves.push({ r: 0, alpha: 1 });

    // Damage + knockback players
    for (const p of this.level.players) {
      if (!p.alive) continue;
      const dx   = p.x - this.x;
      const dy   = p.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < BLAST_RANGE) {
        p.takeDamage(BLAST_DMG);
        const len = dist || 1;
        p._knockbackVx = (dx / len) * KNOCKBACK_SPD;
        p._knockbackVy = (dy / len) * KNOCKBACK_SPD;
      }
    }

    // Shove nearby alive enemies outward (visible chaos)
    for (const e of this.level.entities) {
      if (e === this || !e.isEnemy || !e.alive) continue;
      const dx   = e.x - this.x;
      const dy   = e.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < BLAST_RANGE * 0.65) {
        const push = (1 - dist / (BLAST_RANGE * 0.65)) * 40;
        e.x += (dx / dist) * push;
        e.y += (dy / dist) * push;
      }
    }
  }

  die() {
    this.alive = false;
    this.level.spawnDeathParticles(this.x, this.y, PULSAR_COLOR, 14);
    this.level.removeEntity(this);
    if (this.level.game?.state?.stats) this.level.game.state.stats.enemiesKilled++;
  }

  update(dt) {
    if (!this.alive) return;

    this._explodeCd  = Math.max(0, this._explodeCd - dt);
    this._shieldT   += dt;
    this._hitCooldown = Math.max(0, this._hitCooldown - dt);

    // Expand shockwaves
    const wavePxPerSec = BLAST_RANGE / WAVE_DUR;
    for (const w of this._shockwaves) {
      w.r    += wavePxPerSec * dt;
      w.alpha = Math.max(0, 1 - w.r / BLAST_RANGE);
    }
    this._shockwaves = this._shockwaves.filter(w => w.r < BLAST_RANGE);

    // Proximity check — explode if a player wanders too close
    for (const p of this.level.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - this.x, p.y - this.y) < PROX_RADIUS + p.radius) {
        this._triggerExplosion();
        break;
      }
    }

    // Pathfind slowly toward nearest player
    const players = this.level.players.filter(p => p.alive);
    if (players.length === 0) return;

    let nearest = players[0];
    let nearD   = Math.hypot(nearest.x - this.x, nearest.y - this.y);
    for (const p of players) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < nearD) { nearD = d; nearest = p; }
    }

    this._pathTimer -= dt;
    if (this._pathTimer <= 0 || this._path.length === 0) {
      this._pathTimer = 0.9;
      this._recalcPath(nearest);
    }

    const ts = this.level.tileSize;
    if (this._path.length > 0) {
      const wp   = this._path[0];
      const tx   = (wp.c + 0.5) * ts;
      const ty   = (wp.r + 0.5) * ts;
      const dx   = tx - this.x;
      const dy   = ty - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < ts * 0.35) {
        this._path.shift();
      } else {
        const nx = this.x + (dx / dist) * this.speed * dt;
        const ny = this.y + (dy / dist) * this.speed * dt;
        if (!this._collidesAt(nx, this.y)) this.x = nx;
        if (!this._collidesAt(this.x, ny)) this.y = ny;
      }
    }
  }

  _recalcPath(target) {
    const ts = this.level.tileSize;
    this._path = astar(
      this.level.map,
      Math.floor(this.x / ts), Math.floor(this.y / ts),
      Math.floor(target.x / ts), Math.floor(target.y / ts),
    );
  }

  _collidesAt(x, y) {
    const r = this.radius - 2;
    const { map, tileSize: ts } = this.level;
    for (const [px, py] of [[x-r,y-r],[x+r,y-r],[x-r,y+r],[x+r,y+r]]) {
      const col = Math.floor(px / ts);
      const row = Math.floor(py / ts);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) return true;
      if (map[row][col] === 1 || map[row][col] === 2) return true;
    }
    return false;
  }

  draw(ctx) {
    const shielded = this._shielded;
    const t        = this._shieldT;

    // ── Shockwave rings (drawn first, behind body) ─────────────────────────
    for (const w of this._shockwaves) {
      const a = w.alpha;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = a * 0.14;  ctx.strokeStyle = PULSAR_COLOR; ctx.lineWidth = 22;
      ctx.beginPath(); ctx.arc(this.x, this.y, w.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = a * 0.35;  ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(this.x, this.y, w.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = a * 0.80;  ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, w.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = a * 0.92;  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, w.r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // ── Shield (while relay lives) ─────────────────────────────────────────
    if (shielded) {
      const pulse = 0.55 + 0.28 * Math.sin(t * 3.5);
      const sr    = this.radius + 9 + 3 * Math.sin(t * 2.2);

      ctx.save();
      // Halo
      ctx.globalAlpha = pulse * 0.16;
      ctx.strokeStyle = PULSAR_COLOR; ctx.lineWidth = 18;
      ctx.beginPath(); ctx.arc(this.x, this.y, sr, 0, Math.PI * 2); ctx.stroke();
      // Mid ring
      ctx.globalAlpha = pulse * 0.42;  ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(this.x, this.y, sr, 0, Math.PI * 2); ctx.stroke();
      // Sharp rim
      ctx.globalAlpha = pulse * 0.88;  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, sr, 0, Math.PI * 2); ctx.stroke();

      // 6 rotating tick marks on the shield ring
      ctx.globalAlpha = pulse * 0.55;
      ctx.strokeStyle = PULSAR_COLOR; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 0.9;
        const [cx, cy] = [Math.cos(a), Math.sin(a)];
        ctx.beginPath();
        ctx.moveTo(this.x + cx * (sr - 5), this.y + cy * (sr - 5));
        ctx.lineTo(this.x + cx * (sr + 5), this.y + cy * (sr + 5));
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── Recharge arc (shows when on cooldown) ─────────────────────────────
    if (this._explodeCd > 0) {
      const pct   = 1 - this._explodeCd / EXPLODE_CD;
      const arcR  = this.radius + (shielded ? 20 : 4);
      ctx.save();
      ctx.globalAlpha  = 0.55;
      ctx.strokeStyle  = PULSAR_COLOR;
      ctx.lineWidth    = 2;
      ctx.lineCap      = 'round';
      ctx.beginPath();
      ctx.arc(this.x, this.y, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.stroke();
      ctx.restore();
    }

    // ── Body ──────────────────────────────────────────────────────────────
    // Outer glow
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle   = PULSAR_COLOR;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Main body — bright when shielded, muted when exposed
    ctx.fillStyle = shielded ? PULSAR_COLOR : '#0e8833';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();

    // White core
    ctx.save();
    ctx.globalAlpha = shielded ? 0.55 : 0.25;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    this._drawHealthBar(ctx);
  }

  _drawHealthBar(ctx) {
    const bW = 28, bH = 3;
    const bX = this.x - bW / 2;
    const bY = this.y - this.radius - 9;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bX, bY, bW, bH);
    const pct = this.hp / this.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#4cff72' : pct > 0.25 ? '#ffd24c' : '#ff4c4c';
    ctx.fillRect(bX, bY, bW * pct, bH);
  }
}
