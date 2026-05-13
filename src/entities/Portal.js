// ── Tuning ──────────────────────────────────────────────────────────────────
const PORTAL_RADIUS   = 42;
const PULL_START      = 230;   // px — gravity begins
const PULL_STRONG     = 85;    // px — gravity increases sharply inside here
const PARTICLE_COUNT  = 115;   // ambient map particles
const SWIRL_STRENGTH  = 0.42;  // fraction of radial pull converted to tangential

const PARTICLE_COLORS = ['#8cf3ff', '#c77dff', '#b4a0ff', '#ffffff', '#a0d4ff'];

export class Portal {
  constructor(level, x, y) {
    this.level    = level;
    this.x        = x;
    this.y        = y;
    this.isPortal = true;
    this.alive    = true;

    // Rotation state for the galaxy arms
    this._armAngle   = 0;   // outer arms rotate CCW
    this._innerAngle = 0;   // inner arms rotate CW (counter)
    this._coreAngle  = 0;   // star-field inside the void

    // Closing sequence — runs after ALL players have entered (not on soul debris)
    this._closing    = false;
    this._closeT     = 0;
    this._closeScale = 1;   // 1 → 0 during close

    // Room-advance callback (injected by GameScene at spawn time)
    this.onEnter    = null;
    this._triggered = false;
    this._triggerT  = 0;
    // Multiplayer: track which player instances have pressed enter
    this._enteredSet = new Set();

    this._particles = [];
    this._initParticles();
  }

  // ── Particle helpers ───────────────────────────────────────────────────────

  _makeParticle(anywhere) {
    const { worldWidth: ww, worldHeight: wh } = this.level;
    let x, y;
    if (anywhere) {
      x = 50 + Math.random() * (ww - 100);
      y = 50 + Math.random() * (wh - 100);
    } else {
      // Respawn at a random map edge so the supply is always replenished
      const edge = Math.floor(Math.random() * 4);
      x = edge === 2 ? 50 : edge === 3 ? ww - 50 : 50 + Math.random() * (ww - 100);
      y = edge === 0 ? 50 : edge === 1 ? wh - 50 : 50 + Math.random() * (wh - 100);
    }
    return {
      x, y,
      size:  0.7 + Math.random() * 1.8,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      alpha: 0.25 + Math.random() * 0.55,
      speed: 22 + Math.random() * 44,   // base px/s
    };
  }

  _initParticles() {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._particles.push(this._makeParticle(true));
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt) {
    this._armAngle   += 0.55 * dt;
    this._innerAngle -= 0.95 * dt;
    this._coreAngle  += 0.25 * dt;

    // ── Closing sequence — only after all players have triggered entry ────────
    const CLOSE_DUR = 1.4;
    if (this._closing) {
      this._closeT     += dt;
      const p           = Math.min(1, this._closeT / CLOSE_DUR);
      this._closeScale  = 1 - p * p * p;   // easeInCubic
      if (this._closeT >= CLOSE_DUR) {
        this.alive = false;
        this.level.removeEntity(this);
        return;
      }
    }

    // ── Ambient particles ────────────────────────────────────────────────────
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p  = this._particles[i];
      const dx = this.x - p.x;
      const dy = this.y - p.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Radial pull — strong across the whole map so particles stream in quickly
      const radialSpeed = (28000 / (dist + 80) + 8000 / (dist * dist + 300)) * dt;

      // Tangential nudge — creates the spiral swirl (clockwise)
      // Perpendicular to (dx, dy): rotate 90° CW → (dy, -dx) normalised
      const tx = dy / dist, ty = -dx / dist;
      const tangentialSpeed = SWIRL_STRENGTH * (5500 / (dist + 120)) * dt;

      p.x += (dx / dist) * radialSpeed + tx * tangentialSpeed;
      p.y += (dy / dist) * radialSpeed + ty * tangentialSpeed;

      // Absorbed when reaching the void centre
      if (dist < PORTAL_RADIUS * this._closeScale * 0.45) {
        if (this._closing) {
          this._particles.splice(i, 1);  // drain without respawning during close
        } else {
          this._particles[i] = this._makeParticle(false);
        }
      }
    }

    // ── Entry trigger — ALL alive players must press interact near the portal ──
    if (!this._triggered && this.onEnter) {
      // Register any new player who steps up and presses interact
      for (const pl of this.level.players) {
        if (!pl.alive || this._enteredSet.has(pl)) continue;
        const dist = Math.hypot(this.x - pl.x, this.y - pl.y);
        if (dist < PULL_STRONG && pl.binding?.justPressed?.('interact')) {
          this._enteredSet.add(pl);
        }
      }
      // Fire once every alive player has committed
      const alive = this.level.players.filter(p => p.alive);
      if (alive.length > 0 && alive.every(p => this._enteredSet.has(p))) {
        this._triggered = true;
        this._triggerT  = 0;
      }
    }

    if (this._triggered) {
      this._triggerT += dt;
      if (this._triggerT >= 0.55) {
        this.onEnter?.();
        return;
      }
    }

    // ── Player gravity ───────────────────────────────────────────────────────
    for (const pl of this.level.players) {
      if (!pl.alive) continue;
      const dx   = this.x - pl.x;
      const dy   = this.y - pl.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist >= PULL_START) continue;

      // Quadratic ramp — almost nothing at edge, strong pull close in
      const t        = 1 - dist / PULL_START;
      const strength = (dist < PULL_STRONG ? 190 : 55) * t * t * dt;

      const nx = pl.x + (dx / dist) * strength;
      const ny = pl.y + (dy / dist) * strength;
      if (!pl._collidesAt(nx, pl.y)) pl.x = nx;
      if (!pl._collidesAt(pl.x, ny)) pl.y = ny;
    }

    // ── Soul fragment gravity (enemy death particles) ────────────────────────
    for (const d of this.level._soulDebris) {
      const dx   = this.x - d.x;
      const dy   = this.y - d.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Absorb when reaching the void
      if (dist < PORTAL_RADIUS * 0.45) { d.life = 0; continue; }

      // Position-based pull (like ambient particles — effective at all distances)
      const radialMove = (24000 / (dist + 80) + 8000 / (dist * dist + 300)) * dt;
      const tx = dy / dist, ty = -dx / dist;
      const tangentialMove = SWIRL_STRENGTH * 1.4 * (4500 / (dist + 110)) * dt;
      d.x += (dx / dist) * radialMove + tx * tangentialMove;
      d.y += (dy / dist) * radialMove + ty * tangentialMove;
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────────────

  draw(ctx) {
    if (!this.alive) return;
    const t = Date.now();
    const { x, y } = this;
    const R = PORTAL_RADIUS * this._closeScale;
    if (R < 0.5) return;

    // ── 1. Ambient map particles (drawn first, in world space) ───────────────
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this._particles) {
      const dx   = this.x - p.x;
      const dy   = this.y - p.y;
      const dist = Math.hypot(dx, dy);

      // Fade as they near the rim so they vanish into the void cleanly
      const fade = Math.min(1, (dist - R * 0.5) / (R * 2.0));
      const a    = p.alpha * Math.max(0, fade);
      if (a < 0.01) continue;

      // Short trail pointing away from the portal (behind the particle's travel direction)
      const trailLen = Math.min(10, dist * 0.12);
      if (trailLen > 1.5) {
        ctx.globalAlpha = a * 0.38;
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = p.size * 0.65;
        ctx.beginPath();
        ctx.moveTo(p.x - (dx / dist) * trailLen, p.y - (dy / dist) * trailLen);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      ctx.globalAlpha = a;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap     = 'butt';
    ctx.globalAlpha = 1;
    ctx.restore();

    // ── 2. Rotating outer galaxy arms ────────────────────────────────────────
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this._armAngle);
    for (let arm = 0; arm < 3; arm++) {
      ctx.rotate((Math.PI * 2) / 3);
      // Thick soft sweep
      ctx.strokeStyle = 'rgba(140,100,255,0.28)';
      ctx.lineWidth   = 7;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.75, -0.55, 0.22);
      ctx.stroke();
      // Brighter inner line
      ctx.strokeStyle = 'rgba(190,155,255,0.45)';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.45, -0.45, 0.14);
      ctx.stroke();
      // Dashed stellar stream
      ctx.strokeStyle = 'rgba(220,200,255,0.25)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.2, -0.38, 0.08);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // ── 3. Counter-rotating inner arms (cyan tint) ───────────────────────────
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this._innerAngle);
    for (let arm = 0; arm < 2; arm++) {
      ctx.rotate(Math.PI);
      ctx.strokeStyle = 'rgba(140,243,255,0.22)';
      ctx.lineWidth   = 3.5;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.0, -0.65, 0.55);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(180,255,255,0.14)';
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.75, -0.5, 0.4);
      ctx.stroke();
    }
    ctx.restore();

    // ── 4. Solid void circle ─────────────────────────────────────────────────
    ctx.fillStyle = '#020008';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();

    // Crisp rim — single thin pulse ring
    const rimPulse = 0.7 + 0.25 * Math.sin(t / 280);
    ctx.strokeStyle = `rgba(180,120,255,${rimPulse})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.stroke();

    // ── 5. Star field inside the void (slowly rotates) ───────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R * 0.88, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(this._coreAngle);
    const stars = [
      [0.38,-0.22],[-0.42, 0.31],[0.18, 0.52],[-0.30,-0.46],
      [0.56, 0.17],[-0.21, 0.62],[0.09,-0.58],[0.45,-0.52],
      [-0.55,-0.18],[0.26, 0.66],
    ];
    for (const [sx, sy] of stars) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(sx * R, sy * R, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ── 6. Pulsing bright core ────────────────────────────────────────────────
    const corePulse = 0.5 + 0.38 * Math.sin(t / 175);
    const core      = ctx.createRadialGradient(x, y, 0, x, y, 16);
    core.addColorStop(0,   `rgba(255,245,255,${corePulse})`);
    core.addColorStop(0.45,`rgba(210,170,255,${corePulse * 0.65})`);
    core.addColorStop(1,   'rgba(110,70,200,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();

    // ── 7. Proximity prompt ──────────────────────────────────────────────────
    const nearPlayer = this.level.players.some(
      p => p.alive && Math.hypot(p.x - x, p.y - y) < 150
    );
    if (nearPlayer) {
      const ta = 0.62 + 0.32 * Math.sin(t / 210);
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';

      if (this._triggered) {
        // Fade in "entering" text during the 0.55s transition delay
        const prog = Math.min(1, this._triggerT / 0.55);
        ctx.fillStyle = `rgba(255,245,255,${ta * prog})`;
        ctx.font      = 'bold 12px "Trebuchet MS", sans-serif';
        ctx.fillText('Entering the Void…', x, y - R - 14);

      } else if (this.onEnter) {
        const alive    = this.level.players.filter(p => p.alive);
        const entered  = alive.filter(p => this._enteredSet.has(p)).length;
        const waiting  = alive.length - entered;

        ctx.fillStyle = `rgba(200,160,255,${ta})`;
        ctx.font      = 'bold 11px "Trebuchet MS", sans-serif';
        ctx.fillText('— THE VOID AWAITS —', x, y - R - 26);

        if (entered > 0 && waiting > 0) {
          // Some players in, waiting for the rest
          ctx.font      = '10px "Trebuchet MS", sans-serif';
          ctx.fillStyle = `rgba(255,220,100,${ta * 0.9})`;
          ctx.fillText(`Waiting for ${waiting} player${waiting > 1 ? 's' : ''}…`, x, y - R - 12);
        } else {
          ctx.font      = '10px "Trebuchet MS", sans-serif';
          ctx.fillStyle = `rgba(180,140,255,${ta * 0.75})`;
          ctx.fillText('[ E / O ]  enter', x, y - R - 12);
        }

      } else {
        // CLIENT portal (onEnter is a no-op) — still show the prompt
        ctx.fillStyle = `rgba(200,160,255,${ta})`;
        ctx.font      = 'bold 11px "Trebuchet MS", sans-serif';
        ctx.fillText('— THE VOID AWAITS —', x, y - R - 14);
      }
    }
  }
}
