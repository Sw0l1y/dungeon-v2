import { Scene } from './Scene.js';
import { ClassScene } from './ClassScene.js';

const COLORS      = ['#8cf3ff', '#ff8c42', '#a8ff78', '#ff6b9d', '#c77dff', '#ffd166'];
const COLOR_NAMES = ['Cyan',    'Orange',  'Green',   'Pink',    'Purple',  'Gold'   ];
const MAX_NAME    = 12;

const CARD_W = 300;
const CARD_H = 340;
const GAP    = 80;

export class LobbyScene extends Scene {

  // ── lifecycle ──────────────────────────────────────────────────────────────

  onEnter() {
    this._slots = [
      { active: true,  name: 'Player 1', colorIdx: 0 },
      { active: false, name: 'Player 2', colorIdx: 1 },
    ];
    this._editingSlot  = null; // 0 | 1 | null
    this._mouse        = { x: 0, y: 0 };
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

  // ── layout helpers ─────────────────────────────────────────────────────────

  _cardX(slotIdx) {
    const W      = this.game.canvas.width;
    const totalW = CARD_W * 2 + GAP;
    const x1     = (W - totalW) / 2;
    return slotIdx === 0 ? x1 : x1 + CARD_W + GAP;
  }

  get _cardY() { return 110; }

  _hit({ x, y, w, h }, pt) {
    return pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
  }

  // ── regions (computed fresh each query) ───────────────────────────────────

  _nameField(slotIdx) {
    return { x: this._cardX(slotIdx) + 20, y: this._cardY + 68, w: CARD_W - 40, h: 38 };
  }

  _colorLeft(slotIdx) {
    return { x: this._cardX(slotIdx) + 20, y: this._cardY + 165, w: 44, h: 52 };
  }

  _colorRight(slotIdx) {
    return { x: this._cardX(slotIdx) + CARD_W - 64, y: this._cardY + 165, w: 44, h: 52 };
  }

  _addP2Btn() {
    const x = this._cardX(1);
    return { x: x + 30, y: this._cardY + CARD_H / 2 - 26, w: CARD_W - 60, h: 52 };
  }

  _removeP2Btn() {
    const x = this._cardX(1);
    return { x: x + CARD_W / 2 - 52, y: this._cardY + CARD_H - 46, w: 104, h: 30 };
  }

  _startBtn() {
    const W = this.game.canvas.width;
    return { x: W / 2 - 110, y: this._cardY + CARD_H + 28, w: 220, h: 48 };
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(_dt) {
    const input = this.game.input;
    const click = this._pendingClick;
    this._pendingClick = null;

    // V always toggles P2
    if (input.justPressed('KeyV')) {
      this._slots[1].active = !this._slots[1].active;
      if (!this._slots[1].active && this._editingSlot === 1) this._editingSlot = null;
    }

    // Name typing
    if (this._editingSlot !== null) {
      for (const ch of input.chars) {
        const s = this._slots[this._editingSlot];
        if (s.name.length < MAX_NAME) s.name += ch;
      }
      if (input.justPressed('Backspace')) {
        const s = this._slots[this._editingSlot];
        s.name = s.name.slice(0, -1);
      }
      if (input.justPressed('Escape') || input.justPressed('Enter')) {
        this._editingSlot = null;
        return;
      }
    }

    // Enter starts game when not editing
    if (this._editingSlot === null && input.justPressed('Enter')) {
      this._startGame();
      return;
    }

    if (click) this._handleClick(click);
  }

  _handleClick(pt) {
    // START
    if (this._hit(this._startBtn(), pt)) { this._startGame(); return; }

    // Add P2 button (inactive card)
    if (!this._slots[1].active && this._hit(this._addP2Btn(), pt)) {
      this._slots[1].active = true;
      return;
    }

    // Per-slot interactions
    for (const i of [0, 1]) {
      if (!this._slots[i].active) continue;

      if (this._hit(this._nameField(i), pt))  { this._editingSlot = i; return; }
      if (this._hit(this._colorLeft(i), pt))  { this._slots[i].colorIdx = (this._slots[i].colorIdx - 1 + COLORS.length) % COLORS.length; return; }
      if (this._hit(this._colorRight(i), pt)) { this._slots[i].colorIdx = (this._slots[i].colorIdx + 1) % COLORS.length; return; }

      if (i === 1 && this._hit(this._removeP2Btn(), pt)) {
        this._slots[1].active = false;
        if (this._editingSlot === 1) this._editingSlot = null;
        return;
      }
    }

    // Click outside any field → stop editing
    this._editingSlot = null;
  }

  _startGame() {
    this.game.state.players = this._slots
      .filter(s => s.active)
      .map((s, i) => ({
        name:    s.name,
        color:   COLORS[s.colorIdx],
        binding: i === 0 ? this.game.bindings.player1 : this.game.bindings.player2,
      }));
    this.game.scenes.switch(new ClassScene(this.game));
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
    ctx.fillText('PREGAME LOBBY', W / 2, 56);

    this._drawCard(ctx, 0);
    this._drawCard(ctx, 1);
    this._drawStartBtn(ctx);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      this._editingSlot !== null
        ? 'Type name  •  Enter or Esc to confirm'
        : 'Click to edit  •  V to add/remove Player 2  •  Enter to start',
      W / 2, H - 16,
    );
  }

  _drawCard(ctx, i) {
    const slot  = this._slots[i];
    const x     = this._cardX(i);
    const y     = this._cardY;
    const color = COLORS[slot.colorIdx];

    // Card bg
    ctx.fillStyle = slot.active ? 'rgba(140,243,255,0.07)' : 'rgba(140,243,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, 14); ctx.fill();
    ctx.strokeStyle = slot.active ? 'rgba(140,243,255,0.22)' : 'rgba(140,243,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, CARD_W, CARD_H, 14); ctx.stroke();

    // Header
    ctx.fillStyle = slot.active ? color : 'rgba(255,255,255,0.25)';
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`PLAYER ${i + 1}`, x + 20, y + 28);

    const hint = i === 0 ? 'WASD + Q/E' : 'IJKL + U/P';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(hint, x + CARD_W - 20, y + 28);

    if (!slot.active) {
      this._drawAddP2Card(ctx, x, y);
      return;
    }

    this._drawNameField(ctx, i, color);
    this._drawColorField(ctx, i, color);

    if (i === 1) this._drawRemoveBtn(ctx);
  }

  _drawAddP2Card(ctx, x, y) {
    const btn    = this._addP2Btn();
    const hovered = this._hit(btn, this._mouse);

    ctx.fillStyle = hovered ? 'rgba(140,243,255,0.14)' : 'rgba(140,243,255,0.06)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10); ctx.fill();
    ctx.strokeStyle = hovered ? '#8cf3ff' : 'rgba(140,243,255,0.2)';
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 10); ctx.stroke();

    ctx.fillStyle = hovered ? '#8cf3ff' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+ Add Player 2', x + CARD_W / 2, btn.y + btn.h / 2 - 8);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillText('or press  V', x + CARD_W / 2, btn.y + btn.h / 2 + 12);
  }

  _drawNameField(ctx, i, color) {
    const f       = this._nameField(i);
    const editing = this._editingSlot === i;
    const hovered = this._hit(f, this._mouse);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('NAME', f.x, f.y - 12);

    ctx.fillStyle = editing ? 'rgba(140,243,255,0.12)' : hovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(f.x, f.y, f.w, f.h, 6); ctx.fill();
    ctx.strokeStyle = editing ? '#8cf3ff' : hovered ? 'rgba(140,243,255,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = editing ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(f.x, f.y, f.w, f.h, 6); ctx.stroke();

    const cursor = editing && Math.floor(Date.now() / 500) % 2 === 0 ? '│' : '';
    ctx.fillStyle = '#fff';
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(this._slots[i].name + cursor, f.x + 10, f.y + f.h / 2);
  }

  _drawColorField(ctx, i, color) {
    const cY      = this._cardY + 165;
    const cH      = 52;
    const sx      = this._cardX(i);
    const lBtn    = this._colorLeft(i);
    const rBtn    = this._colorRight(i);
    const lHover  = this._hit(lBtn, this._mouse);
    const rHover  = this._hit(rBtn, this._mouse);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('COLOR', sx + 20, cY - 12);

    // Field bg
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.roundRect(sx + 20, cY, CARD_W - 40, cH, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(sx + 20, cY, CARD_W - 40, cH, 6); ctx.stroke();

    // Swatch
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(sx + CARD_W / 2 - 16, cY + 10, 32, 32, 5); ctx.fill();

    // Color name
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(COLOR_NAMES[this._slots[i].colorIdx], sx + CARD_W / 2, cY + cH + 10);

    // Arrow buttons
    ctx.font = 'bold 22px monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillStyle = lHover ? '#8cf3ff' : 'rgba(255,255,255,0.35)';
    ctx.fillText('‹', lBtn.x + lBtn.w / 2, cY + cH / 2);
    ctx.fillStyle = rHover ? '#8cf3ff' : 'rgba(255,255,255,0.35)';
    ctx.fillText('›', rBtn.x + rBtn.w / 2, cY + cH / 2);
  }

  _drawRemoveBtn(ctx) {
    const btn    = this._removeP2Btn();
    const hovered = this._hit(btn, this._mouse);
    ctx.fillStyle = hovered ? '#ff8080' : 'rgba(255,100,100,0.4)';
    ctx.font = `${hovered ? 'bold ' : ''}12px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('[ Remove P2 ]', btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  _drawStartBtn(ctx) {
    const btn    = this._startBtn();
    const hovered = this._hit(btn, this._mouse);
    ctx.fillStyle = hovered ? 'rgba(140,243,255,0.2)' : 'rgba(140,243,255,0.08)';
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.fill();
    ctx.strokeStyle = hovered ? '#8cf3ff' : 'rgba(140,243,255,0.22)';
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 8); ctx.stroke();
    ctx.fillStyle = hovered ? '#8cf3ff' : 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START GAME', btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
}
