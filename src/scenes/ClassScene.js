import { Scene } from './Scene.js';
import { GameScene } from './GameScene.js';

const CLASSES = [
  {
    id:   'sword',
    name: 'Sword',
    lines: ['Wide melee swing', 'High damage, short range'],
    key:  'Q  /  U',
  },
  {
    id:   'archer',
    name: 'Archer',
    lines: ['Fast projectile', 'Auto-aims nearest enemy'],
    key:  'Q  /  U',
  },
  {
    id:   'rogue',
    name: 'Rogue',
    lines: ['Dash through enemies', 'Invincible during dash'],
    key:  'Q  /  U',
  },
];

const CARD_W   = 180;
const CARD_H   = 200;
const CARD_GAP = 20;

export class ClassScene extends Scene {

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._selections  = this.game.state.players.map(() => null);
    this._mouse       = { x: 0, y: 0 };
    this._pendingClick = null;

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

  // ── layout ─────────────────────────────────────────────────────────────────

  _classCard(playerIdx, classIdx) {
    const W        = this.game.canvas.width;
    const n        = this.game.state.players.length;
    const sectionW = n === 1 ? W : W / 2;
    const sectionCX = playerIdx * sectionW + sectionW / 2;
    const nc  = CLASSES.length;
    // Shrink cards to fit section with 40px side padding; cap at CARD_W
    const cw  = Math.min(CARD_W, Math.floor((sectionW - 40 - CARD_GAP * (nc - 1)) / nc));
    const totalW = cw * nc + CARD_GAP * (nc - 1);
    const startX = sectionCX - totalW / 2;
    return { x: startX + classIdx * (cw + CARD_GAP), y: 190, w: cw, h: CARD_H };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    return { x: W / 2 - 110, y: 430, w: 220, h: 48 };
  }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  get _allSelected() {
    return this._selections.every(s => s !== null);
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(_dt) {
    const click = this._pendingClick;
    this._pendingClick = null;

    if (this._allSelected && this.game.input.justPressed('Enter')) {
      this._launch();
      return;
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    if (this._allSelected && this._hit(this._startBtn(), pt)) {
      this._launch();
      return;
    }

    this.game.state.players.forEach((_, pIdx) => {
      CLASSES.forEach((cls, cIdx) => {
        if (this._hit(this._classCard(pIdx, cIdx), pt)) {
          const takenByOther = this._selections.some((s, i) => i !== pIdx && s === cls.id);
          if (!takenByOther) this._selections[pIdx] = cls.id;
        }
      });
    });
  }

  _launch() {
    this.game.state.players = this.game.state.players.map((p, i) => ({
      ...p,
      classId: this._selections[i],
    }));
    this.game.scenes.switch(new GameScene(this.game));
  }

  // ── draw ──────────────────────────────────────────────────────────────────

  draw(ctx) {
    const W = this.game.canvas.width;
    const H = this.game.canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#8cf3ff';
    ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SELECT CLASS', W / 2, 56);

    const players = this.game.state.players;

    // Divider for 2-player layout
    if (players.length === 2) {
      ctx.strokeStyle = 'rgba(140,243,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2, 90); ctx.lineTo(W / 2, H - 60);
      ctx.stroke();
    }

    players.forEach((p, pIdx) => {
      const n        = players.length;
      const sectionW = n === 1 ? W : W / 2;
      const sectionCX = pIdx * sectionW + sectionW / 2;

      // Player label
      ctx.fillStyle = p.color;
      ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name, sectionCX, 130);

      // Hint for unselected
      if (this._selections[pIdx] === null) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '13px "Trebuchet MS", sans-serif';
        ctx.fillText('click to choose', sectionCX, 155);
      } else {
        const chosen = CLASSES.find(c => c.id === this._selections[pIdx]);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '13px "Trebuchet MS", sans-serif';
        ctx.fillText(`✓ ${chosen.name} selected`, sectionCX, 155);
      }

      // Class cards
      CLASSES.forEach((cls, cIdx) => {
        const card     = this._classCard(pIdx, cIdx);
        const selected = this._selections[pIdx] === cls.id;
        const locked   = this._selections.some((s, i) => i !== pIdx && s === cls.id);
        const hovered  = !locked && this._hit(card, this._mouse);
        this._drawClassCard(ctx, card, cls, p.color, selected, hovered, locked);
      });
    });

    // START button
    const canStart = this._allSelected;
    const startBtn = this._startBtn();
    const startHover = this._hit(startBtn, this._mouse);
    ctx.fillStyle = canStart
      ? (startHover ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.09)')
      : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(startBtn.x, startBtn.y, startBtn.w, startBtn.h, 8); ctx.fill();
    ctx.strokeStyle = canStart
      ? (startHover ? '#8cf3ff' : 'rgba(140,243,255,0.3)')
      : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = canStart && startHover ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(startBtn.x, startBtn.y, startBtn.w, startBtn.h, 8); ctx.stroke();
    ctx.fillStyle = canStart ? (startHover ? '#8cf3ff' : 'rgba(255,255,255,0.6)') : 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START GAME', startBtn.x + startBtn.w / 2, startBtn.y + startBtn.h / 2);

    // Hint
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(canStart ? 'Click START or press Enter' : 'All players must select a class', W / 2, H - 16);
  }

  _drawClassCard(ctx, card, cls, playerColor, selected, hovered, locked = false) {
    const { x, y, w, h } = card;

    ctx.fillStyle = locked
      ? 'rgba(255,255,255,0.02)'
      : selected ? 'rgba(140,243,255,0.13)'
      : hovered  ? 'rgba(140,243,255,0.07)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();

    ctx.strokeStyle = locked
      ? 'rgba(255,255,255,0.06)'
      : selected ? playerColor : hovered ? 'rgba(140,243,255,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = (!locked && (selected || hovered)) ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.stroke();

    ctx.save();
    if (locked) ctx.globalAlpha = 0.25;

    // Class name
    ctx.fillStyle = selected ? playerColor : hovered ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cls.name.toUpperCase(), x + w / 2, y + 36);

    // Description lines
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    cls.lines.forEach((line, i) => {
      ctx.fillText(line, x + w / 2, y + 80 + i * 20);
    });

    // Attack key
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('ATTACK', x + w / 2, y + h - 36);
    ctx.fillStyle = selected ? playerColor : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.fillText(cls.key, x + w / 2, y + h - 20);

    ctx.restore();

    // Locked overlay
    if (locked) {
      ctx.fillStyle = 'rgba(255,80,80,0.65)';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TAKEN', x + w / 2, y + h / 2);
    }
  }
}
