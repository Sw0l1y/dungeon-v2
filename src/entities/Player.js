import { SwordSwing } from './SwordSwing.js';
import { Projectile  } from './Projectile.js';
import { HomingArrow } from './HomingArrow.js';

const ABILITY_COOLDOWNS = {
  sword:  6.0,
  rogue:  10.0,
  archer: 7.5,
};

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
    this.speed  = classId === 'sword' ? 205 : 180;
    this.maxHp  = classId === 'sword' ? 180 : 100;
    this.hp     = this.maxHp;
    this.alive  = true;
    this._devMode = name === 'dev_1';
    if (this._devMode) { this.speed *= 2; this.maxHp = 99999; this.hp = 99999; }
    this._facingX    = 0;
    this._facingY    = 1;
    // Last movement input direction — drives the facing arrow independently of auto-aim
    this._moveDirX   = 0;
    this._moveDirY   = 1;
    this._atkCooldown = 0;
    this._weaponSpeedMult = 1.0;   // multiplied by weapon-speed upgrade tier
    this._abilityCooldown = 0;
    this._abilityMaxCooldown = ABILITY_COOLDOWNS[classId] ?? 1;
    this._iframes     = 0;
    this._damageShield = 0;
    // Sword ability
    this._lunging = false;
    this._lungeTimer = 0;
    this._lungeDuration = 0.18;
    this._lungeDirX = 0;
    this._lungeDirY = 1;
    this._lungeHit = new Set();
    this._lungeArc = 0;
    // Rogue
    this._dashing   = false;
    this._dashTimer = 0;
    this._dashDirX  = 0;
    this._dashDirY  = 0;
    this._dashHit   = new Set();
    this._dashTrail = [];
    this._ricochetTrail = [];
    // Archer / rogue targeting
    this._aimTarget = null;
    // Knockback impulse (set externally, decays each frame)
    this._knockbackVx = 0;
    this._knockbackVy = 0;
    // Downed / revive state
    this._downed = false;
    // Spawn-in scale (0 → 1 during intro portal; 1 = normal)
    this.spawnScale = 1;
    // Stats
    this.dmgDealt = 0;
    this.dmgTaken = 0;
    // Upgrades state (set once per room)
    this._momentumTimer    = 0;      // +40% speed for 1.5s after ability
    this._chargeTimer      = 0;      // overcharge: seconds held
    this._wasHoldingAttack = false;  // previous frame attack-held state (overcharge)
    this._wallBreakerUsed  = false;  // consumed when wall breaker item fires
  }

  takeDamage(amount) {
    if (this._devMode || this._iframes > 0 || !this.alive) return;
    if (this._damageShield > 0) amount *= 0.25;
    const dealt = Math.min(amount, this.hp);
    this.hp = Math.max(0, this.hp - amount);
    this.dmgTaken += dealt;
    this._iframes = this.classId === 'sword' ? 0.80 : 0.60;
    if (this.hp === 0) {
      this.alive   = false;
      this._downed = true;
    }
  }

  /** Revive this player — 60 % HP with Revive Boost upgrade, 40 % otherwise. */
  revive() {
    const pct    = this.game.state.upgrades?.reviveBoost ? 0.6 : 0.4;
    this.hp      = Math.floor(this.maxHp * pct);
    this.alive   = true;
    this._downed = false;
    this._iframes = 1.5;
  }

  update(dt) {
    if (!this.alive) return;
    const { x: ax, y: ay } = this.binding.axes;

    if (this.classId === 'archer' || this.classId === 'rogue' || this.classId === 'sword') {
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

    // Track last non-zero movement direction for the facing arrow
    if (ax !== 0 || ay !== 0) {
      const mlen = Math.hypot(ax, ay) || 1;
      this._moveDirX = ax / mlen;
      this._moveDirY = ay / mlen;
    }

    // Tick momentum timer
    if (this._momentumTimer > 0) this._momentumTimer = Math.max(0, this._momentumTimer - dt);

    // Movement — boost speed while momentum is active
    const momentumMult = (this._momentumTimer > 0 && this.game.state.upgrades?.momentum) ? 1.4 : 1;
    const dx = ax * this.speed * momentumMult * dt;
    const dy = ay * this.speed * momentumMult * dt;

    const nx = this.x + dx;
    if (!this._collidesAt(nx, this.y)) this.x = nx;

    const ny = this.y + dy;
    if (!this._collidesAt(this.x, ny)) this.y = ny;

    this._iframes     = Math.max(0, this._iframes - dt);
    this._atkCooldown = Math.max(0, this._atkCooldown - dt);
    this._abilityCooldown = Math.max(0, this._abilityCooldown - dt);
    this._damageShield = Math.max(0, this._damageShield - dt);

    // Knockback — decelerates at 1600 px/s²
    if (this._knockbackVx !== 0 || this._knockbackVy !== 0) {
      const kx = this.x + this._knockbackVx * dt;
      const ky = this.y + this._knockbackVy * dt;
      if (!this._collidesAt(kx, this.y)) this.x = kx; else this._knockbackVx = 0;
      if (!this._collidesAt(this.x, ky)) this.y = ky; else this._knockbackVy = 0;
      const mag   = Math.hypot(this._knockbackVx, this._knockbackVy);
      const slow  = Math.min(mag, 1600 * dt);
      if (mag > 0) {
        this._knockbackVx -= (this._knockbackVx / mag) * slow;
        this._knockbackVy -= (this._knockbackVy / mag) * slow;
      }
      if (Math.hypot(this._knockbackVx, this._knockbackVy) < 3) {
        this._knockbackVx = 0; this._knockbackVy = 0;
      }
    }

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
        if (e._shielded) continue; // Pulsar: only hittable once Relay is dead
        if (Math.hypot(e.x - this.x, e.y - this.y) < this.radius + e.radius + 2) {
          e.takeDamage(50, this, 'melee');
          this._dashHit.add(e);
        }
      }

      this._dashTimer -= dt;
      if (this._dashTimer <= 0) {
        this._dashing = false;
        this._dashHit.clear();
      }
    }

    if (this._lunging) this._updateLunge(dt);

    // Fade trail
    for (const t of this._dashTrail) t.a -= dt * 6;
    this._dashTrail = this._dashTrail.filter(t => t.a > 0);
    for (const t of this._ricochetTrail) {
      t.delay -= dt;
      if (t.delay <= 0) t.a -= dt * 1.35;
    }
    this._ricochetTrail = this._ricochetTrail.filter(t => t.a > 0);

    if (this.binding.justPressed('abilityA') && (this._abilityCooldown === 0 || this._devMode)) {
      this._abilityCooldown = 0;
      this._useAbility(ax, ay);
    }

    // ── Attack / Overcharge ────────────────────────────────────────────────────
    const overchargeTier = this.game.state.upgrades?.overchargeTier ?? 0;
    if (this.classId === 'sword' && overchargeTier > 0 && !this._devMode) {
      // Overcharge: hold attack to build charge; release to fire scaled swing
      const holding  = this.binding.isHeld('attack');
      const released = this._wasHoldingAttack && !holding;
      this._wasHoldingAttack = holding;

      if (this._atkCooldown === 0) {
        if (holding) {
          this._chargeTimer += dt;
          if (this._chargeTimer >= 1.8) {
            // Auto-fire at max charge
            this._fireOvercharge(1.0, overchargeTier);
            this._chargeTimer = 0;
          }
        } else if (released && this._chargeTimer > 0) {
          if (this._chargeTimer >= 0.25) {
            this._fireOvercharge(Math.min(1.0, this._chargeTimer / 1.8), overchargeTier);
          } else {
            // Quick tap — normal swing
            this._attack();
          }
          this._chargeTimer = 0;
        }
      } else {
        // On cooldown — reset so tap after cooldown triggers a new charge
        this._chargeTimer = 0;
        this._wasHoldingAttack = false;
      }
    } else if (this.binding.justPressed('attack') && (this._atkCooldown === 0 || this._devMode)) {
      this._atkCooldown = 0;
      this._attack();
    }
  }

  _useAbility(ax, ay) {
    if (this.classId === 'sword') {
      this._startLunge(ax, ay);
    } else if (this.classId === 'rogue') {
      this._ricochetDash();
    } else if (this.classId === 'archer') {
      this._homingVolley();
    }
  }

  _startLunge(_ax, _ay) {
    if (this._lunging) return;
    // Always lunge toward the nearest enemy (auto-aim), fall back to facing direction
    const target = this._nearestEnemy();
    if (target) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      this._lungeDirX = dx / len;
      this._lungeDirY = dy / len;
    } else {
      this._lungeDirX = this._facingX;
      this._lungeDirY = this._facingY;
    }
    this._lunging = true;
    this._lungeTimer = this._lungeDuration;
    this._lungeHit.clear();
    this._damageShield = 0.28;
    this._abilityCooldown = this._abilityMaxCooldown;
    if (this.game.state.upgrades?.momentum) this._momentumTimer = 1.5;
  }

  _updateLunge(dt) {
    const speed = 670;
    const nx = this.x + this._lungeDirX * speed * dt;
    const ny = this.y + this._lungeDirY * speed * dt;
    let blocked = false;
    if (!this._collidesAt(nx, this.y)) this.x = nx; else blocked = true;
    if (!this._collidesAt(this.x, ny)) this.y = ny; else blocked = true;

    const base = Math.atan2(this._lungeDirY, this._lungeDirX);
    const arc = Math.PI * 0.92;
    const half = arc / 2;
    const range = 72;
    this._lungeArc = base + Math.sin((1 - this._lungeTimer / this._lungeDuration) * Math.PI) * 0.45;
    for (const e of [...this.level.entities]) {
      if (!e.isEnemy || !e.alive || this._lungeHit.has(e)) continue;
      const dist = Math.hypot(e.x - this.x, e.y - this.y);
      if (dist > range + e.radius) continue;
      let diff = Math.atan2(e.y - this.y, e.x - this.x) - base;
      diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
      if (Math.abs(diff) <= half) {
        e.takeDamage(64, this, 'melee');
        this._lungeHit.add(e);
        if (dist > 0) {
          const push = 18;
          e.x += ((e.x - this.x) / dist) * push;
          e.y += ((e.y - this.y) / dist) * push;
        }
      }
    }

    this._lungeTimer -= dt;
    if (this._lungeTimer <= 0 || blocked) {
      this._lunging = false;
      this._lungeHit.clear();
    }
  }

  _ricochetDash() {
    const targets = this._ricochetTargets();
    if (targets.length === 0) return;

    const points = [{ x: this.x, y: this.y }];
    for (const target of targets) {
      if (!target.alive) continue;
      points.push({ x: target.x, y: target.y });
      // Ghost entities (client-side proxies) don't have takeDamage — the host
      // applies the actual kill when it receives the ability press in the input packet.
      target.takeDamage?.(target.hp ?? 9999, this, 'melee');
    }
    const end = points[points.length - 1];
    this.x = end.x;
    this.y = end.y;
    this._iframes = 0.20;
    this._abilityCooldown = this._abilityMaxCooldown;
    if (this.game.state.upgrades?.momentum) this._momentumTimer = 1.5;
    this._dashTrail.push({ x: this.x, y: this.y, a: 0.75 });

    for (let i = 1; i < points.length; i++) {
      this._ricochetTrail.push({
        x0: points[i - 1].x,
        y0: points[i - 1].y,
        x1: points[i].x,
        y1: points[i].y,
        delay: 0.06 * i,
        a: 1,
      });
    }
  }

  _ricochetTargets() {
    const maxRange = Math.min(this.level.worldWidth ?? 1000, this.level.worldHeight ?? 700) * 0.55;
    // On the client, real enemies live in ghostEntities (not level.entities).
    const candidates = this.level.entities.length > 0
      ? this.level.entities
      : (this.level.ghostEntities ?? []);
    const picked = [];
    let fromX = this.x, fromY = this.y;
    const maxChain = (this.game.state.upgrades?.shadowChain && this.classId === 'rogue') ? 6 : 3;
    for (let i = 0; i < maxChain; i++) {
      let best = null, bestScore = Infinity;
      for (const e of candidates) {
        if (!this._canRicochetKill(e) || picked.includes(e)) continue;
        const d = Math.hypot(e.x - fromX, e.y - fromY);
        if (d > maxRange) continue;
        const score = d / (e.isSprinter ? 1.35 : 1);
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (!best) break;
      picked.push(best);
      fromX = best.x;
      fromY = best.y;
    }
    return picked;
  }

  _canRicochetKill(e) {
    if (!e?.isEnemy || !e.alive) return false;
    if (e.isBoss || e.isElite || e.instantKillImmune) return false;
    // Ghost entity (client-side proxy) — identified by having typeIdx but no class name.
    // typeIdx: 3=Boss, 4=Pulsar.  Pulsars can't be ricochet-killed client-side because
    // their shield state isn't carried in the ghost proxy; the host handles it.
    if (e.typeIdx !== undefined && e.constructor?.name === 'Object') {
      return e.typeIdx !== 3 && e.typeIdx !== 4;
    }
    // Real entity — Pulsar only targetable when its relay is dead.
    if (e.constructor?.name === 'Pulsar') return !e._shielded;
    return true;
  }

  _homingVolley() {
    const count = 5;
    const speed = 360;
    const targets = this._volleyTargets(count);
    if (targets.length === 0) return;

    this._abilityCooldown = this._abilityMaxCooldown;
    for (let i = 0; i < count; i++) {
      const target = targets[i % targets.length];
      const spread = (i - (count - 1) / 2) * 0.16;
      let base = Math.atan2(this._facingY, this._facingX);
      if (target) base = Math.atan2(target.y - this.y, target.x - this.x);
      const angle = base + spread;
      const arrow = new HomingArrow(
        this.level,
        this.x + Math.cos(angle) * 12,
        this.y + Math.sin(angle) * 12,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        this,
        target,
      );
      if (this._devMode) arrow._noclip = true;
      this.level.addEntity(arrow);
    }
  }

  _volleyTargets(count) {
    const scored = [];
    for (const e of this.level.entities) {
      if (!e.isEnemy || !e.alive) continue;
      const dist = Math.hypot(e.x - this.x, e.y - this.y);
      if (dist > 520) continue;
      const los = this._hasLos(e);
      const threat = e.isSprinter ? 0.58 : e.speed ? 80 / e.speed : 1;
      const score = dist * (los ? 1 : 1.7) * threat;
      scored.push({ e, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, count).map(s => s.e);
  }

  _attack() {
    if (this.classId === 'sword') {
      this._atkCooldown = 0.38 / this._weaponSpeedMult;
      this.level.addEntity(
        new SwordSwing(this.level, this.x, this.y, this._facingX, this._facingY, this)
      );
    } else if (this.classId === 'rogue') {
      if (this._dashing) return;
      this._atkCooldown = 0.75 / this._weaponSpeedMult;
      this._dashing     = true;
      this._dashTimer   = 0.13;
      // _facingX/Y already updated this frame toward the target
      this._dashDirX    = this._facingX;
      this._dashDirY    = this._facingY;
      this._iframes     = 0.18; // invincible through the full dash + tiny buffer
    } else if (this.classId === 'archer') {
      this._atkCooldown = 0.3 / this._weaponSpeedMult;
      const speed  = 420 * this._weaponSpeedMult;
      const target = this._nearestEnemy();
      let dirX = this._facingX, dirY = this._facingY;
      if (target) {
        const dx = target.x - this.x, dy = target.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        dirX = dx / len;
        dirY = dy / len;
      }
      const proj = new Projectile(this.level, this.x, this.y, dirX * speed, dirY * speed, this);
      if (this.game.state.upgrades?.ricochet) proj._canRicochet = true;
      if (this._devMode) proj._noclip = true;
      this.level.addEntity(proj);
    }
  }

  /** Fire an overcharged sword swing — called by the overcharge hold-release logic. */
  _fireOvercharge(t, tier) {
    const dmgMult  = 1.0 + t * (tier >= 2 ? 2.0 : 1.5);   // up to 3× (t2) or 2.5× (t1) base dmg
    const sizeMult = 1.0 + t * (tier >= 2 ? 1.2 : 0.8);   // up to 2.2× (t2) or 1.8× (t1) size
    this._atkCooldown = (0.38 * (1 + t * 1.5)) / this._weaponSpeedMult;
    this.level.addEntity(
      new SwordSwing(this.level, this.x, this.y, this._facingX, this._facingY, this, dmgMult, sizeMult)
    );
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

  _nearestEnemy() {
    // Strict LoS-first: only lock onto enemies with a clear sightline.
    // If no LoS target exists, return null → crosshair hidden, free aim.
    // Only retarget if the new candidate is 30% closer (prevents jitter).
    const SWITCH_THRESHOLD = 0.70;

    // On the client enemies live in level.ghostEntities (not level.entities).
    const candidates = this.level.ghostEntities?.length
      ? this.level.ghostEntities
      : this.level.entities;

    let bestScore  = Infinity;
    let bestTarget = null;

    for (const e of candidates) {
      if (!e.isEnemy || !e.alive) continue;
      if (!this._hasLos(e)) continue;            // hard LoS gate — walls block entirely
      const edx = e.x - this.x, edy = e.y - this.y;
      const elen = Math.hypot(edx, edy) || 1;
      // Dot product: 1 = directly ahead, -1 = directly behind.
      // Bias multiplier: enemies in front of the player score 40% lower (preferred),
      // enemies behind score up to 40% higher.  Pure distance still dominates at range.
      const dot = (edx / elen) * this._facingX + (edy / elen) * this._facingY;
      const facingBias = 1.0 - 0.4 * dot;
      const score = (elen / (e.speed || 75)) * facingBias;
      if (score < bestScore) { bestScore = score; bestTarget = e; }
    }

    // No LoS targets → clear lock and return to free aim
    if (!bestTarget) {
      this._aimTarget = null;
      return null;
    }

    // Stickiness: keep current lock if still in LoS and not significantly worse.
    // Ghost proxies are replaced each frame by reference, so match by proximity.
    if (this._aimTarget?.alive && this._hasLos(this._aimTarget) &&
        candidates.some(e => e === this._aimTarget ||
          (e.isEnemy && Math.hypot(e.x - this._aimTarget.x, e.y - this._aimTarget.y) < 2))) {
      const cScore = Math.hypot(this._aimTarget.x - this.x, this._aimTarget.y - this.y)
                     / (this._aimTarget.speed || 75);
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
      const tile = map[row]?.[col];
      if (tile === 1) return false;
      if (tile === 2 && !this._devMode) return false; // dev walks through destructible walls
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
      const t = map[row][col];
      if (t === 1) return true;
      if (t === 2 && !this._devMode) return true; // dev phases through destructible walls
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

    // Rogue dash trail — glowing lightsaber streak between trail points
    const trail = this._dashTrail;
    for (let i = 1; i < trail.length; i++) {
      const p0 = trail[i - 1];
      const p1 = trail[i];
      const a  = (p0.a + p1.a) * 0.5;
      if (a < 0.01) continue;
      const color = this.color;
      ctx.save();
      ctx.lineCap = 'round';
      // Outer halo
      ctx.globalAlpha = a * 0.10;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 28;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      // Mid glow
      ctx.globalAlpha = a * 0.25;
      ctx.lineWidth   = 14;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      // Inner color
      ctx.globalAlpha = a * 0.65;
      ctx.lineWidth   = 6;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      // White core
      ctx.globalAlpha = a * 0.90;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      ctx.restore();
    }

    for (const seg of this._ricochetTrail) {
      if (seg.delay > 0) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = seg.a * 0.14;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 34;
      ctx.beginPath(); ctx.moveTo(seg.x0, seg.y0); ctx.lineTo(seg.x1, seg.y1); ctx.stroke();
      ctx.globalAlpha = seg.a * 0.42;
      ctx.lineWidth = 13;
      ctx.beginPath(); ctx.moveTo(seg.x0, seg.y0); ctx.lineTo(seg.x1, seg.y1); ctx.stroke();
      ctx.globalAlpha = seg.a * 0.92;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(seg.x0, seg.y0); ctx.lineTo(seg.x1, seg.y1); ctx.stroke();
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

    // Movement arrow — shows which way the player is moving/facing,
    // independent of auto-aim.  Uses _moveDirX/Y (last input direction).
    const flen = Math.hypot(this._moveDirX, this._moveDirY) || 1;
    const fdx = this._moveDirX / flen, fdy = this._moveDirY / flen;
    // perpendicular for arrowhead wings
    const fpx = -fdy, fpy = fdx;
    const arBase = this.radius + 5;
    const arTip  = this.radius + 17;
    const wingW  = 5;
    const bx = this.x + fdx * arBase, by = this.y + fdy * arBase;
    const tx = this.x + fdx * arTip,  ty = this.y + fdy * arTip;
    // soft outer glow
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 5;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    // solid shaft
    ctx.globalAlpha = 0.80;
    ctx.lineWidth   = 1.8;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    // arrowhead
    ctx.globalAlpha = 0.90;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx + fpx * wingW - fdx * wingW, ty + fpy * wingW - fdy * wingW);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - fpx * wingW - fdx * wingW, ty - fpy * wingW - fdy * wingW);
    ctx.stroke();
    ctx.lineCap     = 'butt';
    ctx.globalAlpha = 1;

    ctx.restore();

    if (this._lunging) this._drawLungeArc(ctx);

    // Crosshair over aim target (archer + rogue + sword)
    if ((this.classId === 'archer' || this.classId === 'rogue' || this.classId === 'sword') && this._aimTarget?.alive) {
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

    if (this._abilityMaxCooldown > 0) {
      const ready = this._abilityCooldown <= 0;
      const aw = 30, ah = 3;
      const pctA = ready ? 1 : 1 - this._abilityCooldown / this._abilityMaxCooldown;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(this.x - aw / 2, barY + 6, aw, ah);
      ctx.fillStyle = ready ? this.color : 'rgba(255,255,255,0.45)';
      ctx.fillRect(this.x - aw / 2, barY + 6, aw * Math.max(0, Math.min(1, pctA)), ah);
    }

    // Nametag
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const nameLabel = this._devMode ? `${this.name} ⚡` : this.name;
    const tw  = ctx.measureText(nameLabel).width;
    const pad = 5;
    const tagY = this.y - this.radius - 6;
    ctx.fillStyle = this._devMode ? 'rgba(255,220,0,0.18)' : 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(this.x - tw / 2 - pad, tagY - 13, tw + pad * 2, 13, 3);
    ctx.fill();
    ctx.fillStyle = this._devMode ? '#ffe066' : this.color;
    ctx.fillText(nameLabel, this.x, tagY);

    // ── Upgrade visuals ────────────────────────────────────────────────────────
    this._drawUpgradeVisuals(ctx);

    if (scaled) ctx.restore();
  }

  /** Visual overlays driven by upgrade state — drawn after the main body. */
  _drawUpgradeVisuals(ctx) {
    const upg = this.game.state.upgrades;
    if (!upg) return;

    // ── Overcharge: glow ring + charge bar below health bar ─────────────────
    const ocTier = upg.overchargeTier ?? 0;
    if (this.classId === 'sword' && ocTier > 0 && this._chargeTimer > 0.05) {
      const pct = Math.min(1, this._chargeTimer / 1.8);
      ctx.save();
      // Pulsing charge aura
      ctx.globalAlpha  = pct * 0.45;
      ctx.strokeStyle  = this.color;
      ctx.lineWidth    = 2.5 + pct * 7;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 5 + pct * 20, 0, Math.PI * 2);
      ctx.stroke();
      // Extra flash when fully charged
      if (pct >= 1) {
        ctx.globalAlpha  = 0.20 + 0.10 * Math.sin(Date.now() / 80);
        ctx.lineWidth    = 16;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius + 28, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      // Charge bar — below ability bar
      const barW = 32, barH = 3;
      const barX = this.x - barW / 2;
      const barY = this.y - this.radius - 10;   // just above the health bar row
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = pct >= 1 ? '#ff8844' : pct > 0.5 ? '#ffdd44' : '#e8e8ff';
      ctx.fillRect(barX, barY, barW * pct, barH);
    }

    // ── Momentum: soft speed-aura when active ───────────────────────────────
    if (upg.momentum && this._momentumTimer > 0) {
      const ma = (this._momentumTimer / 1.5) * 0.32;
      ctx.save();
      ctx.globalAlpha  = ma;
      ctx.strokeStyle  = '#aaffaa';
      ctx.lineWidth    = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Wall Breaker: item charge indicator above the nametag ───────────────
    if (upg.wallBreaker) {
      const ready = !this._wallBreakerUsed;
      const tagY = this.y - this.radius - 30;
      ctx.save();
      ctx.globalAlpha  = ready ? 0.82 : 0.28;
      ctx.fillStyle    = ready ? '#ffd166' : 'rgba(255,209,102,0.5)';
      ctx.font         = '9px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ready ? '◈ BLAST [E]' : '◈ used', this.x, tagY);
      ctx.restore();
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
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t.x - r - arm, t.y); ctx.lineTo(t.x - r, t.y);
    ctx.moveTo(t.x + r,       t.y); ctx.lineTo(t.x + r + arm, t.y);
    ctx.moveTo(t.x, t.y - r - arm); ctx.lineTo(t.x, t.y - r);
    ctx.moveTo(t.x, t.y + r);       ctx.lineTo(t.x, t.y + r + arm);
    ctx.stroke();
    ctx.restore();
  }

  _drawLungeArc(ctx) {
    const p = 1 - this._lungeTimer / this._lungeDuration;
    const alpha = Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
    const base = Math.atan2(this._lungeDirY, this._lungeDirX);
    const arc = Math.PI * 0.92;
    const start = base - arc / 2;
    const end = base + arc / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha * 0.18;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 34;
    ctx.beginPath(); ctx.arc(this.x, this.y, 58, start, end); ctx.stroke();
    ctx.globalAlpha = alpha * 0.52;
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(this.x, this.y, 64, start, end); ctx.stroke();
    ctx.globalAlpha = alpha * 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(this.x, this.y, 69, start, end); ctx.stroke();
    ctx.restore();
  }
}
