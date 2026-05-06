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

    if (ax !== 0 || ay !== 0) {
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
    } else if (this.classId === 'archer') {
      this._atkCooldown = 0.3;
      const speed = 420;
      const len   = Math.hypot(this._facingX, this._facingY) || 1;
      this.level.addEntity(
        new Projectile(this.level, this.x, this.y, (this._facingX / len) * speed, (this._facingY / len) * speed, this)
      );
    }
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
    ctx.save();

    // Damage flash: blink body during iframes
    if (this._iframes > 0) {
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
