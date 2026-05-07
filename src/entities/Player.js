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
  }

  takeDamage(amount) {
    if (this._iframes > 0 || !this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this._iframes = 0.6;
    if (this.hp === 0) this.alive = false;
  }

  update(dt) {
    if (!this.alive) return;
    const { x: ax, y: ay } = this.binding.axes;

    if (this.classId === 'archer') {
      // Archer passively faces the nearest enemy
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
          e.takeDamage(50);
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

    if (this.binding.justPressed('actionA') && this._atkCooldown === 0) {
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

  _nearestEnemy() {
    let nearest = null, best = Infinity;
    for (const e of this.level.entities) {
      if (!e.isEnemy || !e.alive) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < best) { best = d; nearest = e; }
    }
    return nearest;
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
      if (map[row][col] === 1) return true;
    }
    return false;
  }

  draw(ctx) {
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
  }
}
