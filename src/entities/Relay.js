import { PULSAR_COLOR } from './Pulsar.js';

const FLEE_DIST   = 190;  // preferred minimum distance from players
const PULSAR_MIN  = 110;  // preferred minimum distance from Pulsar
const PULSAR_PULL = 240;  // distance at which Pulsar pull becomes full strength

export class Relay {
  constructor(level, x, y) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.pulsar   = null;  // set by WaveManager after construction
    this.radius   = 8;
    this.speed    = 115;
    this.maxHp    = 40;
    this.hp       = 40;
    this.alive    = true;
    this.isEnemy  = true;
    this.damage   = 0;
    this._typeIdx = 5;
    this._netId   = 0;

    this._lastX        = x;
    this._lastY        = y;
    this._stuckTimer   = 0;
    this._escapeAngle  = Math.random() * Math.PI * 2;
    this._pulseT       = 0;  // animation clock

    // Frantic wander state (activates when pulsar dies)
    this._wanderAngle  = Math.random() * Math.PI * 2;
    this._wanderTimer  = 0;
  }

  takeDamage(amount, source) {
    if (!this.alive) return;
    const dealt = Math.min(amount, this.hp);
    this.hp = Math.max(0, this.hp - amount);
    if (source) source.dmgDealt = (source.dmgDealt || 0) + dealt;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.level.spawnDeathParticles(this.x, this.y, PULSAR_COLOR, 6);
    this.level.removeEntity(this);
    if (this.level.game?.state?.stats) this.level.game.state.stats.enemiesKilled++;
  }

  update(dt) {
    if (!this.alive) return;
    this._pulseT += dt;

    const players = this.level.players.filter(p => p.alive);

    // ── Movement ──────────────────────────────────────────────────────────
    let moveDx, moveDy;

    if (!this.pulsar?.alive) {
      // ── Frantic wander: pulsar is dead, relay panics ───────────────────
      this._wanderTimer -= dt;
      // Re-roll direction on timer expiry or when stuck against a wall
      const movedFrantic = Math.hypot(this.x - this._lastX, this.y - this._lastY);
      if (this._wanderTimer <= 0 || movedFrantic < 0.5) {
        this._wanderAngle = Math.random() * Math.PI * 2;
        this._wanderTimer = 0.3 + Math.random() * 0.35;
      }
      moveDx = Math.cos(this._wanderAngle);
      moveDy = Math.sin(this._wanderAngle);

    } else {
      // ── Normal behaviour: flee players + stay near Pulsar ──────────────
      let fleeDx = 0, fleeDy = 0;
      if (players.length > 0) {
        let nearestDist = Infinity, nearestP = null;
        for (const p of players) {
          const d = Math.hypot(p.x - this.x, p.y - this.y);
          if (d < nearestDist) { nearestDist = d; nearestP = p; }
        }
        const dx = this.x - nearestP.x;
        const dy = this.y - nearestP.y;
        const d  = Math.hypot(dx, dy) || 1;
        const weight = Math.max(0.25, 1 + (FLEE_DIST - nearestDist) / FLEE_DIST);
        fleeDx = (dx / d) * weight;
        fleeDy = (dy / d) * weight;
      }

      let pulsarDx = 0, pulsarDy = 0;
      const dx   = this.pulsar.x - this.x;
      const dy   = this.pulsar.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < PULSAR_MIN) {
        const push = (1 - dist / PULSAR_MIN) * 2.5;
        pulsarDx = -(dx / dist) * push;
        pulsarDy = -(dy / dist) * push;
      } else {
        const pull = Math.min(2.2, (dist - PULSAR_MIN) / (PULSAR_PULL * 0.4));
        pulsarDx = (dx / dist) * pull;
        pulsarDy = (dy / dist) * pull;
      }

      moveDx = fleeDx + pulsarDx * 0.65;
      moveDy = fleeDy + pulsarDy * 0.65;
      const mLen = Math.hypot(moveDx, moveDy) || 1;
      moveDx /= mLen; moveDy /= mLen;

      // Anti-corner: if stuck, escape toward Pulsar
      const movedDist = Math.hypot(this.x - this._lastX, this.y - this._lastY);
      this._stuckTimer = movedDist < 0.8 ? this._stuckTimer + dt : 0;
      if (this._stuckTimer > 0.45) {
        const dx2 = this.pulsar.x - this.x, dy2 = this.pulsar.y - this.y;
        const d2  = Math.hypot(dx2, dy2) || 1;
        moveDx = dx2 / d2; moveDy = dy2 / d2;
        if (this._stuckTimer > 1.1) this._stuckTimer = 0;
      }
    }

    this._lastX = this.x;
    this._lastY = this.y;

    // ── Apply movement ─────────────────────────────────────────────────────
    const nx = this.x + moveDx * this.speed * dt;
    const ny = this.y + moveDy * this.speed * dt;
    if (!this._collidesAt(nx, this.y)) this.x = nx;
    if (!this._collidesAt(this.x, ny)) this.y = ny;
  }

  _collidesAt(x, y) {
    const r = this.radius - 1;
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
    // ── Energy tether to Pulsar ─────────────────────────────────────────────
    if (this.pulsar?.alive) {
      const px = this.pulsar.x;
      const py = this.pulsar.y;
      const t  = this._pulseT;

      ctx.save();
      ctx.lineCap = 'round';

      // Outer halo
      ctx.globalAlpha = 0.10; ctx.strokeStyle = PULSAR_COLOR; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(px, py); ctx.stroke();
      // Mid
      ctx.globalAlpha = 0.28; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(px, py); ctx.stroke();
      // Core
      ctx.globalAlpha = 0.68; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(px, py); ctx.stroke();
      // White core
      ctx.globalAlpha = 0.82; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(px, py); ctx.stroke();

      // Animated energy pulse dot travelling relay → pulsar
      const pt = (t * 1.6) % 1;
      const dotX = this.x + (px - this.x) * pt;
      const dotY = this.y + (py - this.y) * pt;
      const dotA = 0.9 * Math.sin(pt * Math.PI); // fade in/out
      ctx.globalAlpha = dotA;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath(); ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }

    // ── Body ──────────────────────────────────────────────────────────────
    // Outer glow
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle   = PULSAR_COLOR;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = PULSAR_COLOR;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();

    // White core
    ctx.save();
    ctx.globalAlpha = 0.60;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 0.40, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    this._drawHealthBar(ctx);
  }

  _drawHealthBar(ctx) {
    const bW = 20, bH = 3;
    const bX = this.x - bW / 2;
    const bY = this.y - this.radius - 7;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bX, bY, bW, bH);
    const pct = this.hp / this.maxHp;
    ctx.fillStyle = pct > 0.5 ? '#4cff72' : pct > 0.25 ? '#ffd24c' : '#ff4c4c';
    ctx.fillRect(bX, bY, bW * pct, bH);
  }
}
