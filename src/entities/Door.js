// Door entity — guards a 3-tile passage on a room border wall.
// locked=true  → barrier drawn, tiles set to wall(1), blocks passage
// locked=false → tiles set to floor(0), onTraverse fires when player enters edge zone

export class Door {
  constructor(level, slot) {
    this.level   = level;
    this.slot    = slot;   // { id, col, row, dir:'N'|'S'|'E'|'W' }
    this.isDoor  = true;
    this.alive   = true;
    this._locked = false;
    this._unlockFlash = 0;
    this._triggered   = false;
    this.onTraverse   = null;   // cb(slot) when player walks through
  }

  get locked() { return this._locked; }

  lock() {
    if (this._locked) return;
    this._locked    = true;
    this._triggered = false;
    this._setTiles(1);
  }

  unlock() {
    if (!this._locked) return;
    this._locked      = false;
    this._unlockFlash = 0.55;
    this._triggered   = false;
    this._setTiles(0);
  }

  _passageTiles() {
    const { col, row, dir } = this.slot;
    if (dir === 'N' || dir === 'S')
      return [[ row, col - 1 ], [ row, col ], [ row, col + 1 ]];
    return [[ row - 1, col ], [ row, col ], [ row + 1, col ]];
  }

  _setTiles(v) {
    const map = this.level.map;
    for (const [ r, c ] of this._passageTiles()) {
      if (map[r]?.[c] !== undefined) map[r][c] = v;
    }
  }

  update(dt) {
    if (this._unlockFlash > 0) this._unlockFlash = Math.max(0, this._unlockFlash - dt);
    if (this._locked || this._triggered || !this.onTraverse) return;

    const ts   = this.level.tileSize;
    const { col, row, dir } = this.slot;
    const rows = this.level.map.length;
    const cols = this.level.map[0].length;

    for (const pl of this.level.players) {
      if (!pl.alive) continue;
      const pc = pl.x / ts;
      const pr = pl.y / ts;
      let hit = false;
      if (dir === 'N' && pr < 0.85  && pc >= col - 1 && pc < col + 2) hit = true;
      if (dir === 'S' && pr > rows - 1.15 && pc >= col - 1 && pc < col + 2) hit = true;
      if (dir === 'E' && pc > cols - 1.15 && pr >= row - 1 && pr < row + 2) hit = true;
      if (dir === 'W' && pc < 0.85  && pr >= row - 1 && pr < row + 2) hit = true;
      if (hit) { this._triggered = true; this.onTraverse(this.slot); return; }
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    const ts = this.level.tileSize;
    const { col, row, dir } = this.slot;

    // Unconnected door: red tile highlight + X
    if (this._connected === false) {
      const pulse = 0.55 + 0.3 * Math.sin(Date.now() / 350);
      ctx.save();
      ctx.globalAlpha = pulse * 0.55;
      ctx.fillStyle = '#ff2222';
      if (dir === 'N' || dir === 'S') {
        ctx.fillRect((col - 1) * ts, row * ts, 3 * ts, ts);
      } else {
        ctx.fillRect(col * ts, (row - 1) * ts, ts, 3 * ts);
      }
      ctx.globalAlpha = pulse * 0.9;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const cx = (col + 0.5) * ts, cy = (row + 0.5) * ts;
      const s = ts * 0.22;
      ctx.beginPath(); ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s); ctx.stroke();
      ctx.restore();
      return;
    }

    if (this._locked) {
      const t     = Date.now() / 1000;
      const pulse = 0.72 + 0.22 * Math.sin(t * 2.8);
      ctx.save();
      if (dir === 'N' || dir === 'S') {
        const x = (col - 1) * ts, y = row * ts, w = 3 * ts, h = ts;
        ctx.fillStyle   = `rgba(15,40,120,${pulse * 0.90})`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = `rgba(91,195,255,${pulse * 0.82})`;
        ctx.lineWidth   = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        this._drawLock(ctx, (col + 0.5) * ts, (row + 0.5) * ts, pulse);
      } else {
        const x = col * ts, y = (row - 1) * ts, w = ts, h = 3 * ts;
        ctx.fillStyle   = `rgba(15,40,120,${pulse * 0.90})`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = `rgba(91,195,255,${pulse * 0.82})`;
        ctx.lineWidth   = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        this._drawLock(ctx, (col + 0.5) * ts, (row + 0.5) * ts, pulse);
      }
      ctx.restore();
    } else if (this._unlockFlash > 0) {
      const a = this._unlockFlash / 0.55;
      ctx.save();
      ctx.globalAlpha = a * 0.50;
      ctx.fillStyle   = '#4cffb0';
      if (dir === 'N' || dir === 'S')
        ctx.fillRect((col - 1) * ts, row * ts, 3 * ts, ts);
      else
        ctx.fillRect(col * ts, (row - 1) * ts, ts, 3 * ts);
      ctx.restore();
    }
  }

  _drawLock(ctx, cx, cy, pulse) {
    const s = 9;
    ctx.strokeStyle = `rgba(160,210,255,${pulse * 0.90})`;
    ctx.fillStyle   = `rgba(100,170,255,${pulse * 0.70})`;
    ctx.lineWidth   = 2.2;
    // shackle arc
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.18, s * 0.46, Math.PI, 0);
    ctx.stroke();
    // body
    ctx.beginPath();
    ctx.rect(cx - s * 0.54, cy - s * 0.06, s * 1.08, s * 0.88);
    ctx.fill();
    ctx.stroke();
  }
}
