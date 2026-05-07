import { Level } from './Level.js';
import { Player } from '../entities/Player.js';

const TILE = 40;
// 0 = floor, 1 = wall  (30 cols × 17 rows = 1200×680 world)
// 0 = floor, 1 = permanent wall (border), 2 = destructible wall (interior)
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,0,2,2,2,0,0,0,0,2,2,2,0,0,0,0,0,2,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,1],
  [1,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

export class Level1 extends Level {
  constructor(game) {
    super(game, 'Level 1');
    this.map = MAP;
    this.tileSize = TILE;
    this.worldWidth  = MAP[0].length * TILE;
    this.worldHeight = MAP.length    * TILE;
  }

  onEnter() {
    const configs = this.game.state.players ?? [
      { name: 'Player 1', color: '#8cf3ff', binding: this.game.bindings.player1 },
    ];
    configs.forEach((cfg, i) => {
      this.addPlayer(new Player(
        this.game, this,
        (2.5 + i * 3) * TILE, 2.5 * TILE,
        cfg.binding, cfg.name, cfg.color, cfg.classId ?? 'sword',
      ));
    });
  }

  onExit() {
    this.entities = [];
    this.players  = [];
    this.player   = null;
  }

  draw(ctx) {
    const rows = this.map.length;
    const cols = this.map[0].length;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = this.map[r][c];
        if (tile === 0) {
          ctx.fillStyle = '#22304a';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        } else if (tile === 1) {
          // Permanent wall
          ctx.fillStyle = '#1a2340';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.strokeStyle = 'rgba(91,195,255,0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
        } else if (tile === 2) {
          // Destructible wall — warmer tint with subtle crack lines
          ctx.fillStyle = '#2a2e3d';
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.strokeStyle = 'rgba(180,130,60,0.22)';
          ctx.lineWidth = 1;
          ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
          // Crack mark
          ctx.strokeStyle = 'rgba(180,130,60,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(c * TILE + TILE * 0.3, r * TILE + TILE * 0.2);
          ctx.lineTo(c * TILE + TILE * 0.5, r * TILE + TILE * 0.6);
          ctx.lineTo(c * TILE + TILE * 0.7, r * TILE + TILE * 0.8);
          ctx.stroke();
        }
      }
    }

    this._drawDebris(ctx);
    super.draw(ctx);
  }
}
