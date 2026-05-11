class MinHeap {
  constructor() { this._d = []; }
  push(item) { this._d.push(item); this._up(this._d.length - 1); }
  pop() {
    const top = this._d[0];
    const last = this._d.pop();
    if (this._d.length) { this._d[0] = last; this._down(0); }
    return top;
  }
  get size() { return this._d.length; }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].f <= this._d[i].f) break;
      [this._d[p], this._d[i]] = [this._d[i], this._d[p]];
      i = p;
    }
  }
  _down(i) {
    const n = this._d.length;
    for (;;) {
      let m = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._d[l].f < this._d[m].f) m = l;
      if (r < n && this._d[r].f < this._d[m].f) m = r;
      if (m === i) break;
      [this._d[m], this._d[i]] = [this._d[i], this._d[m]];
      i = m;
    }
  }
}

const DIRS = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

/**
 * A* on a 2-D tile grid. Returns array of {c, r} waypoints (not including start).
 * map[row][col] === 1 = wall.
 */
export function astar(map, sc, sr, ec, er) {
  const rows = map.length;
  const cols = map[0].length;

  if ((map[er]?.[ec] ?? 1) === 1 || (map[er]?.[ec] ?? 1) === 2) return [];

  const h = (c, r) => {
    const dx = Math.abs(c - ec), dy = Math.abs(r - er);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const key = (c, r) => r * cols + c;
  const gScore = new Map();
  const parent = new Map();
  const open   = new MinHeap();
  const closed = new Set();

  const sk = key(sc, sr);
  gScore.set(sk, 0);
  open.push({ f: h(sc, sr), c: sc, r: sr });

  while (open.size > 0) {
    const { c, r } = open.pop();
    const k = key(c, r);
    if (closed.has(k)) continue;
    closed.add(k);

    if (c === ec && r === er) {
      const path = [];
      let cur = k;
      while (parent.has(cur)) {
        path.unshift({ c: cur % cols, r: Math.floor(cur / cols) });
        cur = parent.get(cur);
      }
      return path;
    }

    const g = gScore.get(k);
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (map[nr][nc] === 1 || map[nr][nc] === 2) continue;
      if (dc !== 0 && dr !== 0 && ((map[r][nc] === 1 || map[r][nc] === 2) || (map[nr][c] === 1 || map[nr][c] === 2))) continue;

      const nk = key(nc, nr);
      if (closed.has(nk)) continue;

      const ng = g + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        parent.set(nk, k);
        open.push({ f: ng + h(nc, nr), c: nc, r: nr });
      }
    }
  }

  return [];
}
