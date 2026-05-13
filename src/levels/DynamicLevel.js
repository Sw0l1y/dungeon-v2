import { Level  } from './Level.js';
import { Player } from '../entities/Player.js';

const DEFAULT_TILE = 40;

/**
 * A level built from a room-config object loaded from maps.json.
 * Drop-in replacement for Level1 — same interface, dynamic data.
 */
export class DynamicLevel extends Level {
  constructor(game, config) {
    super(game, config.name ?? 'Room');

    // Deep-copy tiles so wall destruction mutates our copy only
    this.map       = config.tiles.map(row => [...row]);
    this.tileSize  = config.tileSize  ?? DEFAULT_TILE;
    this.worldWidth  = (config.cols ?? this.map[0].length) * this.tileSize;
    this.worldHeight = (config.rows ?? this.map.length)    * this.tileSize;

    // Player spawn point (tile coords → world centre of that tile)
    const ts = this.tileSize;
    this._spawnX = ((config.playerSpawn?.col ?? Math.floor(this.map[0].length / 2)) + 0.5) * ts;
    this._spawnY = ((config.playerSpawn?.row ?? Math.floor(this.map.length    / 2)) + 0.5) * ts;

    // Custom tile colors (falls back to default dark palette)
    this.tileColors = {
      floor:        config.tileColors?.floor        ?? '#22304a',
      wall:         config.tileColors?.wall         ?? '#1a2340',
      destructible: config.tileColors?.destructible ?? '#1a2340',
    };

    // Per-room wave config — null means WaveManager uses its hardcoded formula
    this.waveConfig = config.waves ?? null;
  }

  onEnter() {
    const configs = this.game.state.players ?? [
      { name: 'Player 1', color: '#8cf3ff', binding: this.game.bindings.player1 },
    ];
    const cx = this._spawnX;
    const cy = this._spawnY;

    const OFFSETS  = [[0, 0], [-14, 0], [14, 0]];
    const OFFSETS4 = [[-21, -14], [21, -14], [-21, 14], [21, 14]];
    const n = configs.length;

    configs.forEach((cfg, i) => {
      const [ox, oy] = n >= 3
        ? (OFFSETS4[i] ?? [0, 0])
        : (OFFSETS[n === 1 ? 0 : i + 1] ?? [0, 0]);
      this.addPlayer(new Player(
        this.game, this,
        cx + ox, cy + oy,
        cfg.binding, cfg.name, cfg.color, cfg.classId ?? 'sword',
      ));
    });

    // Apply persistent shop upgrades (no-op when upgrades haven't been set yet)
    const upg = this.game.state.upgrades;
    if (upg) {
      for (const pl of this.players) {
        if (upg.speedTier       > 0) pl.speed           *= 1 + 0.15 * upg.speedTier;
        if (upg.weaponSpeedTier > 0) pl._weaponSpeedMult = 1 + 0.20 * upg.weaponSpeedTier;
        if (upg.maxHpTier       > 0) { pl.maxHp += 30 * upg.maxHpTier; pl.hp = pl.maxHp; }
        if (upg.pendingHeal)         pl.hp = pl.maxHp;
        // Glass Cannon: halve max HP, double weapon speed
        if (upg.glassCannon) {
          pl.maxHp = Math.max(1, Math.floor(pl.maxHp * 0.5));
          pl.hp    = pl.maxHp;
          pl._weaponSpeedMult *= 2.0;
        }
        // Wall Breaker: reset use each room
        pl._wallBreakerUsed = false;
      }
      upg.pendingHeal = false;   // consume — won't fire again until the next flask purchase
    }
  }

  onExit() {
    this.entities = [];
    this.players  = [];
    this.player   = null;
  }

  draw(ctx) {
    const ts   = this.tileSize;
    const rows = this.map.length;
    const cols = this.map[0].length;
    const { floor, wall, destructible } = this.tileColors;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = this.map[r][c];
        const x = c * ts, y = r * ts;

        if (tile === 0) {
          ctx.fillStyle = floor;
          ctx.fillRect(x, y, ts, ts);
        } else if (tile === 1) {
          // Permanent wall — solid fill + rim border
          ctx.fillStyle = wall;
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.10)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x, y, ts, ts);
        } else if (tile === 2) {
          // Destructible wall — custom color + dashed inner rect to stay visually distinct
          ctx.fillStyle = destructible;
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.10)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(91,195,255,0.32)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x + 4, y + 4, ts - 8, ts - 8);
          ctx.setLineDash([]);
        } else if (tile === 3) {
          // No-spawn floor — passable, visually identical to floor in-game
          // (the editor overlay is editor-only)
          ctx.fillStyle = floor;
          ctx.fillRect(x, y, ts, ts);
        }
      }
    }

    this._drawDebris(ctx);
    this._drawSoulDebris(ctx);
    super.draw(ctx);
  }
}
