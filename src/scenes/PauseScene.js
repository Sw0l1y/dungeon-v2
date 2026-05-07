import { Scene } from './Scene.js';
import { TitleScene } from './TitleScene.js';

// Planned upgrades — shown as locked slots until the upgrade system is built.
const PLANNED_UPGRADES = [
  { name: 'Attack Speed',    desc: 'Fire / swing faster'      },
  { name: 'Move Speed',      desc: 'Move faster'              },
  { name: 'Max HP',          desc: 'Increase max health'      },
  { name: 'Bonus Damage',    desc: 'Deal more damage'         },
  { name: 'Special Ability', desc: 'Unlock class ability'     },
];

const PANEL_W = 600;
const PANEL_H = 450;

export class PauseScene extends Scene {
  constructor(game, gameScene) {
    super(game);
    this._gs   = gameScene; // reference to live GameScene
    this._tab  = 'stats';   // 'stats' | 'upgrades'
    this._mouse = { x: 0, y: 0 };
    this._pendingClick = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._onMouseMove = (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this._mouse.x = (e.clientX - r.left) * (this.game.canvas.width  / r.width);
      this._mouse.y = (e.clientY - r.top)  * (this.game.canvas.height / r.height);
    };
    this._onMouseDown = (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this._pendingClick = {
        x: (e.clientX - r.left) * (this.game.canvas.width  / r.width),
        y: (e.clientY - r.top)  * (this.game.canvas.height / r.height),
      };
    };
    this.game.canvas.addEventListener('mousemove', this._onMouseMove);
    this.game.canvas.addEventListener('mousedown', this._onMouseDown);
  }

  onExit() {
    this.game.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.game.canvas.removeEventListener('mousedown', this._onMouseDown);
  }

  // ── layout helpers ─────────────────────────────────────────────────────────

  _panel() {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    return { x: (W - PANEL_W) / 2, y: (H - PANEL_H) / 2, w: PANEL_W, h: PANEL_H };
  }

  _tabBtn(idx) {
    const p = this._panel();
    const tw = 130, th = 34, gap = 10;
    const totalW = tw * 2 + gap;
    const startX = p.x + (PANEL_W - totalW) / 2;
    return { x: startX + idx * (tw + gap), y: p.y + 56, w: tw, h: th };
  }

  _footerBtn(idx) {
    const p = this._panel();
    const bw = 156, bh = 42, gap = 16;
    const totalW = bw * 3 + gap * 2;
    const startX = p.x + (PANEL_W - totalW) / 2;
    return { x: startX + idx * (bw + gap), y: p.y + PANEL_H - 60, w: bw, h: bh };
  }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  _hovered(rect) {
    return this._hit(rect, this._mouse);
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(_dt) {
    if (this.game.input.justPressed('Backquote')) {
      this.game.scenes.pop();
      return;
    }

    const click = this._pendingClick;
    this._pendingClick = null;
    if (!click) return;

    // Tab switching
    if (this._hit(this._tabBtn(0), click)) { this._tab = 'stats';    return; }
    if (this._hit(this._tabBtn(1), click)) { this._tab = 'upgrades'; return; }

    // Footer buttons: Resume | Restart | Main Menu
    if (this._hit(this._footerBtn(0), click)) {
      this.game.scenes.pop();
      return;
    }
    if (this._hit(this._footerBtn(1), click)) {
      import('./GameScene.js').then(({ GameScene }) => {
        this.game.scenes.switch(new GameScene(this.game));
      });
      return;
    }
    if (this._hit(this._footerBtn(2), click)) {
      this.game.state = {};
      this.game.scenes.switch(new TitleScene(this.game));
      return;
    }
  }

  // ── draw ──────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width, H = this.game.canvas.height;
    const p = this._panel();

    // Backdrop blur tint
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, H);

    // Panel background
    ctx.fillStyle = '#0d1828';
    ctx.strokeStyle = 'rgba(140,243,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 14); ctx.fill(); ctx.stroke();

    // Header bar
    ctx.fillStyle = 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, 50, [14, 14, 0, 0]); ctx.fill();
    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', p.x + p.w / 2, p.y + 25);

    // Tabs
    const tabs = ['STATS', 'UPGRADES'];
    tabs.forEach((label, i) => {
      const b      = this._tabBtn(i);
      const active = (i === 0 && this._tab === 'stats') || (i === 1 && this._tab === 'upgrades');
      const hov    = !active && this._hovered(b);
      ctx.fillStyle = active
        ? 'rgba(140,243,255,0.18)'
        : hov ? 'rgba(140,243,255,0.07)' : 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = active ? '#8cf3ff' : hov ? 'rgba(140,243,255,0.3)' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle  = active ? '#8cf3ff' : hov ? '#fff' : 'rgba(255,255,255,0.5)';
      ctx.font = `${active ? 'bold ' : ''}13px "Trebuchet MS", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
    });

    // Divider below tabs
    const divY = this._tabBtn(0).y + 34 + 8;
    ctx.strokeStyle = 'rgba(140,243,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x + 24, divY); ctx.lineTo(p.x + p.w - 24, divY); ctx.stroke();

    // Content area
    const contentY = divY + 12;
    const contentH = this._footerBtn(0).y - contentY - 12;
    if (this._tab === 'stats') {
      this._drawStats(ctx, p.x + 32, contentY, p.w - 64, contentH);
    } else {
      this._drawUpgrades(ctx, p.x + 32, contentY, p.w - 64, contentH);
    }

    // Footer divider
    const footerDivY = this._footerBtn(0).y - 12;
    ctx.strokeStyle = 'rgba(140,243,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x + 24, footerDivY); ctx.lineTo(p.x + p.w - 24, footerDivY); ctx.stroke();

    // Footer buttons
    const footerLabels = ['RESUME', 'RESTART', 'MAIN MENU'];
    const footerColors = ['#8cf3ff', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.7)'];
    footerLabels.forEach((label, i) => {
      const b   = this._footerBtn(i);
      const hov = this._hovered(b);
      ctx.fillStyle   = hov ? 'rgba(140,243,255,0.14)' : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = hov ? 'rgba(140,243,255,0.5)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = hov ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = hov ? '#fff' : footerColors[i];
      ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
    });

    // Esc hint
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('`  to resume', p.x + p.w / 2, p.y + p.h - 4);
  }

  // ── stats tab ─────────────────────────────────────────────────────────────

  _drawStats(ctx, x, y, w, _h) {
    const stats   = this.game.state.stats ?? {};
    const waves   = this._gs.waves;
    const players = this._gs.level.players;

    // Format time
    const secs  = Math.floor(stats.timeElapsed ?? 0);
    const timeStr = secs >= 60
      ? `${Math.floor(secs / 60)}m ${secs % 60}s`
      : `${secs}s`;

    // Run summary row
    const cols = [
      { label: 'WAVE',            value: String(waves.wave || 0) },
      { label: 'ENEMIES KILLED',  value: String(stats.enemiesKilled ?? 0) },
      { label: 'TIME',            value: timeStr },
    ];
    const cw = Math.floor(w / cols.length);
    cols.forEach(({ label, value }, i) => {
      const cx = x + i * cw + cw / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, y + 10);
      ctx.fillStyle = '#8cf3ff';
      ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
      ctx.fillText(value, cx, y + 36);
    });

    // Divider
    const py = y + 62;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();

    // Per-player rows
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('PLAYERS', x, py + 14);

    players.forEach((p, i) => {
      const rowY  = py + 32 + i * 72;
      const pct   = p.hp / p.maxHp;
      const clsLabel = p.classId ? p.classId[0].toUpperCase() + p.classId.slice(1) : '—';

      // Player name + class badge
      ctx.fillStyle = p.color;
      ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(p.name, x, rowY + 8);

      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillText(clsLabel, x, rowY + 24);

      // HP bar
      const barX = x + 110, barY = rowY, barW = w - 110, barH = 14;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 3); ctx.fill();
      ctx.fillStyle = p.alive
        ? (pct > 0.5 ? '#4cff72' : pct > 0.25 ? '#ffd24c' : '#ff4c4c')
        : '#555';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * Math.max(0, pct), barH, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${p.hp}/${p.maxHp} HP`, barX + barW, barY + barH + 10);

      // Dealt / Taken
      const statY = barY + barH + 10;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Dealt: ${p.dmgDealt ?? 0}`, barX, statY);
      ctx.textAlign = 'right';
      ctx.fillText(`Taken: ${p.dmgTaken ?? 0}`, barX + barW, statY);

      if (!p.alive) {
        ctx.fillStyle = 'rgba(255,80,80,0.6)';
        ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('DEAD', x + 60, rowY + 8);
      }
    });
  }

  // ── upgrades tab ──────────────────────────────────────────────────────────

  _drawUpgrades(ctx, x, y, w, _h) {
    // Header message
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No upgrades acquired yet.  Survive waves to unlock.', x + w / 2, y + 14);

    // Planned upgrade grid — 2 columns
    const cols    = 2;
    const cardW   = Math.floor((w - 16) / cols);
    const cardH   = 58;
    const gapY    = 10;
    const startY  = y + 36;

    PLANNED_UPGRADES.forEach((upg, i) => {
      const col  = i % cols;
      const row  = Math.floor(i / cols);
      const cx   = x + col * (cardW + 16);
      const cy   = startY + row * (cardH + gapY);

      // Card bg
      ctx.fillStyle   = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.roundRect(cx, cy, cardW, cardH, 7); ctx.fill(); ctx.stroke();

      // Lock icon area
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('🔒', cx + 12, cy + cardH / 2);

      // Name
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(upg.name, cx + 42, cy + 12);

      // Description
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(upg.desc, cx + 42, cy + 30);

      // Planned badge
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('PLANNED', cx + cardW - 10, cy + cardH - 8);
    });
  }
}
