import { SwordSwing } from './SwordSwing.js';
import { Projectile  } from './Projectile.js';

export class Player {
  constructor(game, level, x, y, binding, name = 'Player', color = '#8cf3ff', classId = 'sword') {
    this.game    = game;
    this.level   = level;
    this.binding = binding;
    this.name    = name;
    this.color   = color;
    this.classId = classId;
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.speed  = 180;
    this.maxHp  = 100;
    this.hp     = 100;
    this.alive  = true;
    this._facingX    = 0;
    this._facingY    = 1;
    this._atkCooldown = 0;
    this._iframes     = 0;
    // Rogue
    this._dashing   = false;
    this._dashTimer = 0;
    this._dashDirX  = 0;
    this._dashDirY  = 0;
    this._dashHit   = new Set();
    this._dashTrail = [];
    // Archer / rogue targeting
    this._aimTarget = null;
    // Downed / revive state
    this._downed = false;
    // Spawn-in scale (0 → 1 during intro portal; 1 = normal)
    this.spawnScale = 1;
    // Stats
    this.dmgDealt = 0;
    this.dmgTaken = 0;
  }

  takeDamage(amount) {
    if (this._iframes > 0 || !this.alive) return;
    const dealt = Math.min(amount, this.hp);
    this.hp = Math.max(0, this.hp - amount);
    this.dmgTaken += dealt;
    this._iframes = 0.6;
    if (this.hp === 0) {
      this.alive   = false;
      this._downed = true;
    }
  }

  /** Revive this player with 40 % HP and brief iframes. */
  revive() {
    this.hp      = Math.floor(this.maxHp * 0.4);
    this.alive   = true;
    this._downed = false;
    this._iframes = 1.5;
  }

  update(dt) {
    if (!this.alive) return;
    const { x: ax, y: ay } = this.binding.axes;

    if (this.classId === 'archer' || this.classId === 'rogue') {
      // Auto-aim: face the most threatening enemy
      const target = this._nearestEnemy();
      if (target) {
        const dx = target.x - this.x, dy = target.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        this._facingX = dx / len;
        this._facingY = dy / len;
      } else if (ax !== 0 || ay !== 0) {
        this._facingX = ax;
        this._facingY = ay;
      }
    } else if (ax !== 0 || ay !== 0) {
      this._facingX = ax;
      this._facingY = ay;
    }

    const dx = ax * this.speed * dt;
    const dy = ay * this.speed * dt;

    const nx = this.x + dx;
    if (!this._collidesAt(nx, this.y)) this.x = nx;

    const ny = this.y + dy;
    if (!this._collidesAt(this.x, ny)) this.y = ny;

    this._iframes     = Math.max(0, this._iframes - dt);
    this._atkCooldown = Math.max(0, this._atkCooldown - dt);

    // Rogue dash movement & hit detection
    if (this._dashing) {
      const dashSpeed = 1400;
      const nx = this.x + this._dashDirX * dashSpeed * dt;
      const ny = this.y + this._dashDirY * dashSpeed * dt;
      if (!this._collidesAt(nx, this.y)) this.x = nx; else this._dashTimer = 0;
      if (!this._collidesAt(this.x, ny)) this.y = ny; else this._dashTimer = 0;

      this._dashTrail.push({ x: this.x, y: this.y, a: 0.55 });

      for (const e of [...this.level.entities]) {
        if (!e.isEnemy || !e.alive || this._dashHit.has(e)) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) < this.radius + e.radius + 2) {
          e.takeDamage(50, this);
          this._dashHit.add(e);
        }
      }

      this._dashTimer -= dt;
      if (this._dashTimer <= 0) {
        this._dashing = false;
        this._dashHit.clear();
      }
    }

    // Fade trail
    for (const t of this._dashTrail) t.a -= dt * 6;
    this._dashTrail = this._dashTrail.filter(t => t.a > 0);

    if (this.binding.justPressed('attack') && this._atkCooldown === 0) {
      this._attack();
    }
  }

  _attack() {
    if (this.classId === 'sword') {
      this._atkCooldown = 0.45;
      this.level.addEntity(
        new SwordSwing(this.level, this.x, this.y, this._facingX, this._facingY, this)
      );
    } else if (this.classId === 'rogue') {
      if (this._dashing) return;
      this._atkCooldown = 0.75;
      this._dashing     = true;
      this._dashTimer   = 0.13;
      // _facingX/Y already updated this frame toward the target
      this._dashDirX    = this._facingX;
      this._dashDirY    = this._facingY;
      this._iframes     = 0.18; // invincible through the full dash + tiny buffer
    } else if (this.classId === 'archer') {
      this._atkCooldown = 0.3;
      const speed  = 420;
      const target = this._nearestEnemy();
      let dirX = this._facingX, dirY = this._facingY;
      if (target) {
        const dx = target.x - this.x, dy = target.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        dirX = dx / len;
        dirY = dy / len;
      }
      this.level.addEntity(
        new Projectile(this.level, this.x, this.y, dirX * speed, dirY * speed, this)
      );
    }
  }

  _drawDowned(ctx) {
    const t   = Date.now();
    const bob = Math.sin(t / 350);

    // Ghost body — faded, slowly pulsing
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.14 * bob;
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Expanding / contracting red warning ring
    const ringR   = this.radius + 8 + 4 * Math.sin(t / 280);
    const ringA   = 0.35 + 0.35 * Math.sin(t / 280);
    ctx.strokeStyle = `rgba(255,70,70,${ringA})`;
    ctx.lineWidth   = 3;
    ctx.beginPath(); ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2); ctx.stroke();

    // "DOWNED" label
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,90,90,0.9)';
    ctx.fillText('DOWNED', this.x, this.y - this.radius - 6);

    // Revive prompt — shown when an alive ally is within range
    const REVIVE_RANGE = 70;
    for (const other of this.level.players) {
      if (!other.alive || other === this) continue;
      if (Math.hypot(other.x - this.x, other.y - this.y) > REVIVE_RANGE) continue;
      const code  = other.binding._bindings?.interact ?? '';
      const label = code === 'KeyE' ? 'E' : code === 'KeyO' ? 'O' : '?';
      const pa    = 0.75 + 0.2 * Math.sin(t / 180);
      ctx.fillStyle = `rgba(255,220,80,${pa})`;
      ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.fillText(`[ ${label} ]  Revive`, this.x, this.y - this.radius - 20);
      break;
    }
  }

  _drawCrosshair(ctx) {
    const t   = this._aimTarget;
    const r   = (t.radius ?? 12) + 10;
    const arm = 9;
    const pulse = 0.65 + 0.2 * Math.sin(Date.now() / 220);
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = pulse;
    // Ring around target
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
    // 4 tick marks radiating outward
    ctx.beginPath();
    ctx.moveTo(t.x - r - arm, t.y); ctx.lineTo(t.x - r, t.y);
    ctx.moveTo(t.x + r,       t.y); ctx.lineTo(t.x + r + arm, t.y);
    ctx.moveTo(t.x, t.y - r - arm); ctx.lineTo(t.x, t.y - r);
    ctx.moveTo(t.x, t.y + r);       ctx.lineTo(t.x, t.y + r + arm);
    ctx.stroke();
    ctx.restore();
  }

  _nearestEnemy() {
    // Threat score = estimated seconds to reach player (lower = more dangerous).
    // Enemies behind walls get a 2.5x distance penalty since they must path around.
    const LOS_PENALTY  = 2.5;
    // Only retarget if the new candidate is 30% more threatening than the current lock.
    // Prevents jittery switching between equally-dangerous enemies.
    const SWITCH_THRESHOLD = 0.70;

    let bestScore  = Infinity;
    let bestTarget = null;

    // On the client enemies live in level.ghostEntities (not level.entities).
    // Merge both so auto-aim works correctly on both host and client.
    const candidates = this.level.ghostEntities?.length
      ? this.level.ghostEntities
      : this.level.entities;

    for (const e of candidates) {
      if (!e.isEnemy || !e.alive) continue;
      const dist        = Math.hypot(e.x - this.x, e.y - this.y);
      const los         = this._hasLos(e);
      const effDist     = los ? dist : dist * LOS_PENALTY;
      const score       = effDist / (e.speed || 75); // seconds to reach
      if (score < bestScore) { bestScore = score; bestTarget = e; }
    }

    // Stickiness: keep current lock unless the new target is significantly more threatening.
    // Also verify the locked target is still in the candidate list (ghost proxies are
    // replaced each frame by reference, so we match by position proximity instead).
    const lockStillValid = this._aimTarget?.alive &&
      candidates.some(e => e === this._aimTarget ||
        (e.isEnemy && Math.hypot(e.x - this._aimTarget.x, e.y - this._aimTarget.y) < 2));
    if (lockStillValid) {
      const cd      = Math.hypot(this._aimTarget.x - this.x, this._aimTarget.y - this.y);
      const cLos    = this._hasLos(this._aimTarget);
      const cScore  = (cLos ? cd : cd * LOS_PENALTY) / (this._aimTarget.speed || 75);
      if (bestScore >= cScore * SWITCH_THRESHOLD) return this._aimTarget;
    }

    this._aimTarget = bestTarget;
    return bestTarget;
  }

  _hasLos(target) {
    const { map, tileSize: ts } = this.level;
    const dx    = target.x - this.x;
    const dy    = target.y - this.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / (ts * 0.4));
    for (let i = 1; i < steps; i++) {
      const t   = i / steps;
      const col = Math.floor((this.x + dx * t) / ts);
      const row = Math.floor((this.y + dy * t) / ts);
      if (map[row]?.[col] > 0) return false;
    }
    return true;
  }

  _collidesAt(x, y) {
    const r = this.radius - 2;
    const { map, tileSize: ts } = this.level;
    const corners = [
      [x - r, y - r],
      [x + r, y - r],
      [x - r, y + r],
      [x + r, y + r],
    ];
    for (const [px, py] of corners) {
      const col = Math.floor(px / ts);
      const row = Math.floor(py / ts);
      if (row < 0 || row >= map.length || col < 0 || col >= map[0].length) return true;
      if (map[row][col] > 0) return true;
    }
    return false;
  }

  draw(ctx) {
    if (this._downed) { this._drawDowned(ctx); return; }

    // Spawn-in scale — grows from 0 during the intro portal sequence
    const scale = this.spawnScale;
    if (scale <= 0.01) return;
    const scaled = scale < 0.999;
    if (scaled) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(scale, scale);
      ctx.translate(-this.x, -this.y);
    }

    // Rogue dash trail
    for (const t of this._dashTrail) {
      ctx.save();
      ctx.globalAlpha = t.a;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.radius * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();

    // Damage flash: blink body during iframes (skip during rogue dash — trail sells it)
    if (this._iframes > 0 && !this._dashing) {
      ctx.globalAlpha = Math.floor(this._iframes / 0.1) % 2 === 0 ? 0.35 : 1;
    }

    // Body
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Facing dot
    const dotDist = this.radius + 5;
    const len = Math.hypot(this._facingX, this._facingY) || 1;
    const fx = (this._facingX / len) * dotDist;
    const fy = (this._facingY / len) * dotDist;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(this.x + fx, this.y + fy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Crosshair over aim target (archer + rogue)
    if ((this.classId === 'archer' || this.classId === 'rogue') && this._aimTarget?.alive) {
      this._drawCrosshair(ctx);
    }

    // Health bar
    const barW = 30, barH = 4;
    const barX = this.x - barW / 2;
    const barY = this.y - this.radius - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    const pct = this.hp / this.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#4cff72' : pct > 0.25 ? '#ffd24c' : '#ff4c4c';
    ctx.fillRect(barX, barY, barW * pct, barH);

    // Nametag
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw  = ctx.measureText(this.name).width;
    const pad = 5;
    const tagY = this.y - this.radius - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(this.x - tw / 2 - pad, tagY - 13, tw + pad * 2, 13, 3);
    ctx.fill();
    ctx.fillStyle = this.color;
    ctx.fillText(this.name, this.x, tagY);

    if (scaled) ctx.restore();
  }
}
