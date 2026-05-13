export class Projectile {
  constructor(level, x, y, vx, vy, owner) {
    this.level        = level;
    this.x            = x;
    this.y            = y;
    this.vx           = vx;
    this.vy           = vy;
    this.owner        = owner;
    this.radius       = 5;
    this._lifetime    = 3;
    this._trail       = []; // actual past positions — grows as the arrow travels
    // Ricochet: set by GameScene when archer has the upgrade
    this._canRicochet = false;
    this._bounced     = false;
    this._prevX       = x;
    this._prevY       = y;
  }

  update(dt) {
    this._lifetime -= dt;
    if (this._lifetime <= 0) { this.level.removeEntity(this); return; }

    // Track previous position for ricochet wall-normal detection
    this._prevX = this.x;
    this._prevY = this.y;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Record position after moving so trail never overlaps the spawn point
    this._trail.push({ x: this.x, y: this.y });
    if (this._trail.length > 8) this._trail.shift();

    // Enemy hit
    for (const e of [...this.level.entities]) {
      if (!e.isEnemy || !e.alive) continue;
      if (Math.hypot(this.x - e.x, this.y - e.y) < this.radius + e.radius) {
        e.takeDamage(30, this.owner, 'ranged');
        this.level.removeEntity(this);
        return;
      }
    }

    // Wall hit
    const { map, tileSize: ts } = this.level;
    const col = Math.floor(this.x / ts);
    const row = Math.floor(this.y / ts);
    const hitWall = row < 0 || row >= map.length || col < 0 || col >= map[0].length || map[row][col] === 1 || map[row][col] === 2;
    if (hitWall && this._noclip) return;
    if (hitWall) {
      // ── Ricochet: bounce off wall once ────────────────────────────────────
      if (this._canRicochet && !this._bounced) {
        const prevCol = Math.floor(this._prevX / ts);
        const prevRow = Math.floor(this._prevY / ts);
        // Reflect velocity based on which boundary was crossed
        if (prevCol !== col) this.vx = -this.vx;   // vertical wall face
        if (prevRow !== row) this.vy = -this.vy;   // horizontal wall face
        // If neither changed (same tile, somehow inside wall) reflect both
        if (prevCol === col && prevRow === row) { this.vx = -this.vx; this.vy = -this.vy; }
        // Step back to pre-collision position so arrow doesn't get stuck
        this.x = this._prevX;
        this.y = this._prevY;
        this._bounced = true;
        return; // don't remove
      }
      this.level.removeEntity(this);
    }
  }

  // Draw one arrow instance at (x, y) facing (dx, dy) at a given alpha.
  // px/py is the perpendicular unit vector for the arrowhead wings.
  _drawArrow(ctx, x, y, dx, dy, px, py, alpha) {
    if (alpha < 0.01) return;
    const color = this.owner.color;

    // ── Arrow geometry ────────────────────────────────────────────────────────
    const HEAD_FWD  = 8;    // tip ahead of center
    const SHAFT_BK  = 13;   // shaft tail behind center
    const BASE_BK   = 3;    // arrowhead base behind tip
    const HEAD_WING = 4.5;  // arrowhead half-width
    const FLETCH_BK = 10;   // fletching V behind center
    const FLETCH_W  = 4;    // fletching half-width
    const FLETCH_FW = 3;    // fletching forward reach

    const tipX   = x + dx * HEAD_FWD;
    const tipY   = y + dy * HEAD_FWD;
    const baseX  = tipX - dx * BASE_BK;    // arrowhead base centre
    const baseY  = tipY - dy * BASE_BK;
    const tailX  = x - dx * SHAFT_BK;
    const tailY  = y - dy * SHAFT_BK;
    const flBX   = x - dx * FLETCH_BK;    // fletching root
    const flBY   = y - dy * FLETCH_BK;

    ctx.save();
    ctx.lineCap = 'round';

    // Layer 1 — wide outer halo (whole length)
    ctx.globalAlpha = alpha * 0.10;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 18;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke();

    // Layer 2 — mid glow
    ctx.globalAlpha = alpha * 0.27;
    ctx.lineWidth   = 9;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke();

    // Layer 3 — inner colored shaft (tail → arrowhead base only)
    ctx.globalAlpha = alpha * 0.78;
    ctx.lineWidth   = 3.5;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX, baseY); ctx.stroke();

    // Layer 4 — white shaft core
    ctx.globalAlpha = alpha * 0.92;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX, baseY); ctx.stroke();

    // Arrowhead — colored triangle
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * HEAD_WING, baseY + py * HEAD_WING);
    ctx.lineTo(baseX - px * HEAD_WING, baseY - py * HEAD_WING);
    ctx.closePath();
    ctx.fill();

    // Arrowhead — white highlight sliver
    ctx.globalAlpha = alpha * 0.78;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + px * HEAD_WING * 0.38, baseY + py * HEAD_WING * 0.38);
    ctx.lineTo(baseX - px * HEAD_WING * 0.38, baseY - py * HEAD_WING * 0.38);
    ctx.closePath();
    ctx.fill();

    // Fletching — V-shape at tail
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(flBX + px * FLETCH_W, flBY + py * FLETCH_W);
    ctx.lineTo(flBX + dx * FLETCH_FW, flBY + dy * FLETCH_FW);
    ctx.lineTo(flBX - px * FLETCH_W, flBY - py * FLETCH_W);
    ctx.stroke();

    ctx.restore();
  }

  draw(ctx) {
    const speed = Math.hypot(this.vx, this.vy);
    const dx    = this.vx / speed;
    const dy    = this.vy / speed;
    const px    = -dy;  // perpendicular (right-hand)
    const py    =  dx;

    // ── Trail: actual past positions recorded each frame ───────────────────
    // Starts empty on spawn and grows as the arrow travels — no clipping.
    const n = this._trail.length;
    for (let i = 0; i < n; i++) {
      const pos   = this._trail[i];
      const frac  = (i + 1) / (n + 1); // 0 = oldest/faintest → 1 = most recent
      const alpha = frac * 0.44;
      this._drawArrow(ctx, pos.x, pos.y, dx, dy, px, py, alpha);
    }

    // ── Main arrow head ────────────────────────────────────────────────────
    this._drawArrow(ctx, this.x, this.y, dx, dy, px, py, 1);
  }
}
