import { Scene      } from './Scene.js';
import { GameScene  } from './GameScene.js';
import { TitleScene } from './TitleScene.js';

// ── Column / category definitions ────────────────────────────────────────────
//  Q / A  ←  columns  →  E / D   (P2: U/J ← → O/L)
const COLUMNS = [
  { id: 'offense', label: 'Offense', color: '#ff9944' },
  { id: 'defense', label: 'Defense', color: '#7fff7f' },
  { id: 'utility', label: 'Utility', color: '#8cf3ff' },
  { id: 'class',   label: 'Class',   color: '#c77dff' },
];

// ── Item definitions ─────────────────────────────────────────────────────────
const ITEMS = [
  // ── Offense ──────────────────────────────────────────────────────────────
  {
    id: 'atkspd', cat: 'offense', classId: null, name: 'Combat Tempo',
    icon: 'atkspd', tiers: 3, costs: [100, 150, 200],
    desc: '+20% attack & projectile speed.', extra: 'Stacks ×3.',
  },
  {
    id: 'bleed', cat: 'offense', classId: null, name: 'Bleed',
    icon: 'bleed', tiers: 1, costs: [90],
    desc: 'Hits apply 30 dmg bleed over 3s.', extra: 'Refreshes on re-hit.',
  },
  {
    id: 'bounty', cat: 'offense', classId: null, name: 'Bounty',
    icon: 'bounty', tiers: 1, costs: [80],
    desc: '20% of enemies marked for 3× gold.', extra: 'Normal enemies only.',
  },
  {
    id: 'glassCannon', cat: 'offense', classId: null, name: 'Glass Cannon',
    icon: 'glass', tiers: 1, costs: [100],
    desc: 'Halve max HP. Double attack speed.', extra: 'High risk, high reward.',
  },
  // ── Defense ──────────────────────────────────────────────────────────────
  {
    id: 'flask', cat: 'defense', classId: null, name: 'Health Flask',
    icon: 'flask', tiers: 1, costs: [50],
    desc: 'Restore all players to full HP.', extra: 'One use per shop visit.',
  },
  {
    id: 'maxhp', cat: 'defense', classId: null, name: 'Vital Core',
    icon: 'maxhp', tiers: 3, costs: [80, 120, 160],
    desc: '+30 max HP for all players.', extra: 'Stacks ×3.',
  },
  {
    id: 'reviveBoost', cat: 'defense', classId: null, name: 'Revive Boost',
    icon: 'revive', tiers: 1, costs: [60],
    desc: 'Revive allies at 60% HP (was 40%).', extra: 'Applies to all players.',
  },
  // ── Utility ──────────────────────────────────────────────────────────────
  {
    id: 'speed', cat: 'utility', classId: null, name: 'Swiftness',
    icon: 'speed', tiers: 3, costs: [80, 120, 160],
    desc: '+15% move speed for all players.', extra: 'Stacks ×3.',
  },
  {
    id: 'momentum', cat: 'utility', classId: null, name: 'Momentum',
    icon: 'momentum', tiers: 1, costs: [70],
    desc: '+40% speed for 1.5s after ability.', extra: 'Works on all classes.',
  },
  {
    id: 'salvage', cat: 'utility', classId: null, name: 'Salvage',
    icon: 'salvage', tiers: 1, costs: [60],
    desc: 'Destroyed walls drop gold shards.', extra: 'Pairs well with Wall Breaker.',
  },
  {
    id: 'wallBreaker', cat: 'utility', classId: null, name: 'Wall Breaker',
    icon: 'wallbreak', tiers: 1, costs: [100],
    desc: '[E/O] shatters walls in 120px.', extra: '1 charge per room.',
  },
  // ── Class ────────────────────────────────────────────────────────────────
  {
    id: 'overcharge', cat: 'class', classId: 'sword', name: 'Overcharge',
    icon: 'overcharge', tiers: 2, costs: [100, 150],
    desc: 'Hold attack to charge swing. Full = 2.5–3× dmg.', extra: 'Sword only.',
  },
  {
    id: 'ricochet', cat: 'class', classId: 'archer', name: 'Ricochet',
    icon: 'ricochet', tiers: 1, costs: [80],
    desc: 'Arrows bounce off walls once.', extra: 'Archer only.',
  },
  {
    id: 'shadowChain', cat: 'class', classId: 'rogue', name: 'Shadow Chain',
    icon: 'shadow', tiers: 1, costs: [90],
    desc: 'Ricochet dash chains 6 enemies (was 3).', extra: 'Rogue only.',
  },
];

// ── Upgrade defaults ─────────────────────────────────────────────────────────
export function defaultUpgrades() {
  return {
    speedTier:       0,
    weaponSpeedTier: 0,
    maxHpTier:       0,
    overchargeTier:  0,
    flaskBought:     false,
    pendingHeal:     false,
    reviveBoost:     false,
    glassCannon:     false,
    momentum:        false,
    bleed:           false,
    bounty:          false,
    salvage:         false,
    wallBreaker:     false,
    ricochet:        false,
    shadowChain:     false,
  };
}

function _getTier(upg, id) {
  if (id === 'flask')      return upg.flaskBought ? 1 : 0;
  if (id === 'speed')      return upg.speedTier;
  if (id === 'atkspd')     return upg.weaponSpeedTier;
  if (id === 'maxhp')      return upg.maxHpTier;
  if (id === 'overcharge') return upg.overchargeTier ?? 0;
  return upg[id] ? 1 : 0;
}

// ── ShopScene ────────────────────────────────────────────────────────────────
export class ShopScene extends Scene {
  onEnter() {
    const g = this.game;
    g.state.gold     = g.state.gold     ?? 0;
    g.state.upgrades = g.state.upgrades ?? defaultUpgrades();
    g.state.upgrades.flaskBought = false;

    this._net  = g.state.netSession ?? null;
    this._role = g.state.netRole    ?? null;

    // Grid navigation state
    this._colIdx = 0;   // active column (0–3)
    this._rowIdx = 0;   // selected row within active column
    this._message = null;

    // Warm ambient particles
    this._particles = [];
    this._pTimer    = 0;
    for (let i = 0; i < 55; i++) this._addParticle(true);

    if (this._net) {
      this._net.onMessage = (data) => this._onNetMsg(data);
    }
  }

  onExit() {}

  // ── Net ─────────────────────────────────────────────────────────────────────

  _onNetMsg(data) {
    if (this._role === 'client' && data.t === 'shopDone') {
      const g = this.game;
      g.state.upgrades  = data.upgrades;
      g.state.gold      = data.gold;
      g.state.roomIndex = data.roomIdx;
      if (!g.maps?.campaign || data.roomIdx >= g.maps.campaign.length) {
        g.scenes.switch(new TitleScene(g));
      } else {
        g.scenes.switch(new GameScene(g));
      }
    }
  }

  // ── Column items helper ───────────────────────────────────────────────────

  _colItems(colIdx) {
    const cat = COLUMNS[colIdx].id;
    const partyClasses = new Set(
      (this.game.state.players ?? []).map(p => p.classId ?? 'sword')
    );
    const showAll = partyClasses.size === 0;
    return ITEMS.filter(item => {
      if (item.cat !== cat) return false;
      if (item.classId && !showAll && !partyClasses.has(item.classId)) return false;
      return true;
    });
  }

  _selectedItem() {
    const items = this._colItems(this._colIdx);
    return items[this._rowIdx] ?? null;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  update(dt) {
    // Particles
    this._pTimer += dt;
    if (this._pTimer > 0.09) { this._pTimer = 0; this._addParticle(false); }
    for (const p of this._particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      p.alpha = Math.max(0, Math.min(1, p.life / p.maxLife * 2));
    }
    this._particles = this._particles.filter(p => p.life > 0);

    if (this._message) {
      this._message.timer -= dt;
      if (this._message.timer <= 0) this._message = null;
    }

    if (this._role === 'client') return;

    const inp = this.game.input;
    const nCols = COLUMNS.length;

    // ── Column navigation (Q/E, A/D, U/O, J/L) ───────────────────────────────
    const prevCol = inp.justPressed('KeyQ') || inp.justPressed('KeyA')
                 || inp.justPressed('KeyU') || inp.justPressed('KeyJ');
    const nextCol = inp.justPressed('KeyE') || inp.justPressed('KeyD')
                 || inp.justPressed('KeyO') || inp.justPressed('KeyL');
    if (prevCol) {
      this._colIdx = (this._colIdx - 1 + nCols) % nCols;
      this._clampRow();
    }
    if (nextCol) {
      this._colIdx = (this._colIdx + 1) % nCols;
      this._clampRow();
    }

    // ── Row navigation (W/S, I/K) ────────────────────────────────────────────
    const items = this._colItems(this._colIdx);
    const nRows = items.length;
    if (nRows > 0) {
      if (inp.justPressed('KeyW') || inp.justPressed('KeyI') || inp.justPressed('ArrowUp')) {
        this._rowIdx = (this._rowIdx - 1 + nRows) % nRows;
      }
      if (inp.justPressed('KeyS') || inp.justPressed('KeyK') || inp.justPressed('ArrowDown')) {
        this._rowIdx = (this._rowIdx + 1) % nRows;
      }
    }

    // ── Buy (Space / Enter) ──────────────────────────────────────────────────
    if (inp.justPressed('Space') || inp.justPressed('Enter')) {
      const item = this._selectedItem();
      if (item) this._tryBuy(item);
    }

    // ── Leave (Escape only — E is now "next column") ─────────────────────────
    if (inp.justPressed('Escape')) {
      this._leaveShop();
    }
  }

  _clampRow() {
    const n = this._colItems(this._colIdx).length;
    this._rowIdx = n > 0 ? Math.min(this._rowIdx, n - 1) : 0;
  }

  // ── Buy logic ────────────────────────────────────────────────────────────────

  _tryBuy(item) {
    const upg  = this.game.state.upgrades;
    const gold = this.game.state.gold;
    const tier = _getTier(upg, item.id);
    const maxed = (item.id === 'flask' && upg.flaskBought) || tier >= item.tiers;
    if (maxed) { this._msg('Already maxed!', '#ff9944'); return; }
    const cost = item.costs[tier];
    if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
    this.game.state.gold -= cost;
    switch (item.id) {
      case 'flask':    upg.flaskBought = true; upg.pendingHeal = true; this._msg('Health Flask — full heal next room!', '#7fff7f'); break;
      case 'speed':    upg.speedTier++;        this._msg(`Swiftness  Tier ${upg.speedTier}!`, '#7fff7f'); break;
      case 'atkspd':   upg.weaponSpeedTier++;  this._msg(`Combat Tempo  Tier ${upg.weaponSpeedTier}!`, '#7fff7f'); break;
      case 'maxhp':    upg.maxHpTier++;        this._msg(`Vital Core  Tier ${upg.maxHpTier}!`, '#7fff7f'); break;
      case 'overcharge': upg.overchargeTier = (upg.overchargeTier ?? 0) + 1; this._msg(`Overcharge  Tier ${upg.overchargeTier}!`, '#ff9944'); break;
      default: upg[item.id] = true; this._msg(`${item.name} unlocked!`, '#7fff7f'); break;
    }
  }

  _msg(text, color = '#fff') {
    this._message = { text, color, timer: 2.5 };
  }

  // ── Leave ────────────────────────────────────────────────────────────────────

  _leaveShop() {
    const g       = this.game;
    const campaign = g.maps?.campaign;
    const nextIdx  = (g.state.roomIndex ?? 0) + 1;
    if (this._net) {
      this._net.send({ t: 'shopDone', upgrades: { ...g.state.upgrades }, gold: g.state.gold, roomIdx: nextIdx });
    }
    if (campaign && nextIdx < campaign.length) {
      g.state.roomIndex = nextIdx;
      g.scenes.switch(new GameScene(g));
    } else {
      g.state.roomIndex = 0;
      g.scenes.switch(new TitleScene(g));
    }
  }

  // ── Particles ────────────────────────────────────────────────────────────────

  _addParticle(anywhere) {
    const { width: W, height: H } = this.game.canvas;
    const COLORS = ['#ffd166','#ffb347','#ffe8a0','#ff9944','#fff3cc','#d4a0ff'];
    let x, y;
    if (anywhere) {
      x = Math.random() * W; y = Math.random() * H;
    } else {
      const cx = W / 2, cy = H * 0.38;
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 280;
      x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r;
    }
    const life = 2.5 + Math.random() * 3;
    this._particles.push({
      x, y, vx: (Math.random() - 0.5) * 18, vy: -3 - Math.random() * 14,
      size: 0.9 + Math.random() * 2.4, color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0, maxLife: life, life,
    });
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────

  draw(ctx) {
    const { width: W, height: H } = this.game.canvas;

    ctx.fillStyle = '#080611';
    ctx.fillRect(0, 0, W, H);

    const g1 = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, W * 0.52);
    g1.addColorStop(0,    'rgba(150,100,0,0.13)');
    g1.addColorStop(0.45, 'rgba(90,45,0,0.07)');
    g1.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.5);
    g2.addColorStop(0, 'rgba(80,35,130,0.09)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

    ctx.save();
    for (const p of this._particles) {
      ctx.globalAlpha = p.alpha * 0.60; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (this._role === 'client') { this._drawClientWait(ctx); return; }
    this._drawShopUI(ctx, W, H);
  }

  _drawClientWait(ctx) {
    const { width: W, height: H } = this.game.canvas;
    const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 700);
    ctx.save(); ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Host is shopping…', W / 2, H / 2 - 24);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Upgrades apply when the host continues', W / 2, H / 2 + 14);
    this._drawGoldBadge(ctx, this.game.state.gold ?? 0);
  }

  _drawShopUI(ctx, W, H) {
    this._drawTitleRow(ctx, W);
    this._drawGrid(ctx, W, H);
    this._drawInfoPanel(ctx, W, H);
    this._drawHint(ctx, W, H);
    if (this._message) {
      ctx.save();
      ctx.globalAlpha  = Math.min(1, this._message.timer * 1.5);
      ctx.fillStyle    = this._message.color;
      ctx.shadowColor  = this._message.color;
      ctx.shadowBlur   = 14;
      ctx.font         = 'bold 15px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this._message.text, W / 2, H - 38);
      ctx.restore();
    }
  }

  // ── Title row ────────────────────────────────────────────────────────────────

  _drawTitleRow(ctx, W) {
    const t     = Date.now();
    const pulse = 0.88 + 0.12 * Math.sin(t / 1400);
    ctx.save();
    ctx.globalAlpha  = pulse;
    ctx.shadowColor  = 'rgba(255,209,102,0.5)';
    ctx.shadowBlur   = 22;
    ctx.fillStyle    = '#ffd166';
    ctx.font         = 'bold 30px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('The Armory', W / 2, 14);
    ctx.restore();
    this._drawGoldBadge(ctx, this.game.state.gold ?? 0);
    // Shopkeeper mini-figure (top-right, compact)
    this._drawShopkeeper(ctx, W * 0.915, 46);
  }

  _drawShopkeeper(ctx, cx, cy) {
    const t  = Date.now();
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 38);
    grd.addColorStop(0, 'rgba(200,140,30,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#130900'; ctx.beginPath(); ctx.ellipse(cx, cy + 6, 11, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#220d00'; ctx.beginPath(); ctx.arc(cx, cy - 13, 8, 0, Math.PI * 2); ctx.fill();

    const ep = 0.6 + 0.3 * Math.sin(t / 520);
    ctx.save(); ctx.globalAlpha = ep; ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(cx - 2.8, cy - 14, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 2.8, cy - 14, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const oy = cy - 3 + Math.sin(t / 750) * 4;
    const og = ctx.createRadialGradient(cx + 15, oy, 0, cx + 15, oy, 6);
    og.addColorStop(0, 'rgba(255,220,100,0.85)'); og.addColorStop(1, 'rgba(200,120,0,0)');
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx + 15, oy, 6, 0, Math.PI * 2); ctx.fill();
  }

  _drawGoldBadge(ctx, gold) {
    const { width: W } = this.game.canvas;
    const pulse = 0.88 + 0.12 * Math.sin(Date.now() / 650);
    ctx.save(); ctx.globalAlpha = pulse;
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    const txt = `◈  ${gold}  gold`;
    const tw  = ctx.measureText(txt).width;
    const px  = W - tw - 38; const py = 16;
    ctx.fillStyle = 'rgba(8,6,2,0.82)'; ctx.strokeStyle = 'rgba(255,209,102,0.36)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.roundRect(px - 8, py - 2, tw + 16, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(txt, px, py);
    ctx.restore();
  }

  // ── Grid (4 columns × N rows) ────────────────────────────────────────────────

  _drawGrid(ctx, W, H) {
    // Layout constants
    const N_COLS  = COLUMNS.length;                     // 4
    const GAP_COL = 14;                                 // gap between columns
    const GAP_ROW = 7;                                  // gap between rows
    const CARD_W  = 206;
    const CARD_H  = 82;
    const HEADER_H = 26;
    const HEADER_Y = 60;
    const CARDS_Y  = HEADER_Y + HEADER_H + 6;
    const TOTAL_W  = N_COLS * CARD_W + (N_COLS - 1) * GAP_COL;
    const START_X  = (W - TOTAL_W) / 2;

    const t       = Date.now();
    const upg     = this.game.state.upgrades ?? defaultUpgrades();
    const gold    = this.game.state.gold ?? 0;

    for (let ci = 0; ci < N_COLS; ci++) {
      const colX   = START_X + ci * (CARD_W + GAP_COL);
      const col    = COLUMNS[ci];
      const items  = this._colItems(ci);
      const isActiveCol = ci === this._colIdx;

      // ── Column header ────────────────────────────────────────────────────
      const hPulse = isActiveCol ? (0.92 + 0.08 * Math.sin(t / 280)) : 0.55;
      ctx.save();
      ctx.globalAlpha  = hPulse;
      ctx.fillStyle    = isActiveCol ? 'rgba(60,40,8,0.90)' : 'rgba(16,12,4,0.72)';
      ctx.strokeStyle  = isActiveCol ? col.color : 'rgba(90,72,32,0.28)';
      ctx.lineWidth    = isActiveCol ? 1.8 : 1;
      ctx.beginPath(); ctx.roundRect(colX, HEADER_Y, CARD_W, HEADER_H, 5); ctx.fill(); ctx.stroke();
      if (isActiveCol) {
        ctx.globalAlpha = 0.10 + 0.04 * Math.sin(t / 280);
        ctx.fillStyle = col.color;
        ctx.beginPath(); ctx.roundRect(colX, HEADER_Y, CARD_W, HEADER_H, 5); ctx.fill();
      }
      ctx.globalAlpha  = hPulse;
      ctx.fillStyle    = isActiveCol ? col.color : '#aa9040';
      ctx.font         = isActiveCol ? 'bold 11px "Trebuchet MS", sans-serif' : '10px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(col.label, colX + CARD_W / 2, HEADER_Y + HEADER_H / 2);
      ctx.restore();

      // ── Cards ────────────────────────────────────────────────────────────
      if (items.length === 0) {
        ctx.save(); ctx.globalAlpha = 0.28;
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '10px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('None for party', colX + CARD_W / 2, CARDS_Y + 40);
        ctx.restore();
        continue;
      }

      for (let ri = 0; ri < items.length; ri++) {
        const item    = items[ri];
        const cardY   = CARDS_Y + ri * (CARD_H + GAP_ROW);
        const isSel   = isActiveCol && ri === this._rowIdx;
        const tier    = _getTier(upg, item.id);
        const bought  = (item.id === 'flask' && upg.flaskBought);
        const maxed   = tier >= item.tiers || bought;
        const cost    = maxed ? 0 : item.costs[tier];
        const canAfford = !maxed && gold >= cost;
        const pulse   = isSel ? (0.92 + 0.08 * Math.sin(t / 240)) : isActiveCol ? 0.72 : 0.48;

        // Card background
        ctx.save();
        ctx.globalAlpha  = pulse;
        ctx.fillStyle    = isSel  ? 'rgba(75,52,8,0.92)' : 'rgba(16,12,4,0.78)';
        ctx.strokeStyle  = isSel  ? col.color
                         : maxed        ? 'rgba(140,243,255,0.38)'
                         : canAfford    ? 'rgba(255,200,80,0.28)'
                         :                'rgba(70,55,22,0.22)';
        ctx.lineWidth    = isSel ? 1.8 : 1;
        ctx.beginPath(); ctx.roundRect(colX, cardY, CARD_W, CARD_H, 6); ctx.fill(); ctx.stroke();
        if (isSel) {
          ctx.globalAlpha = 0.09 + 0.04 * Math.sin(t / 240);
          ctx.fillStyle = col.color;
          ctx.beginPath(); ctx.roundRect(colX, cardY, CARD_W, CARD_H, 6); ctx.fill();
        }
        ctx.restore();

        // Icon (left, compact — 22px area)
        const iconCX = colX + 24;
        const iconCY = cardY + CARD_H / 2;
        this._drawItemIcon(ctx, item.icon, iconCX, iconCY, isSel, t, item.classId, 0.80);

        // Name
        const textX = colX + 50;
        ctx.save();
        ctx.globalAlpha  = isSel ? 1 : isActiveCol ? 0.85 : 0.55;
        ctx.fillStyle    = isSel ? '#ffd166' : '#c8a846';
        ctx.font         = 'bold 11px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(item.name, textX, cardY + 10);
        ctx.restore();

        // Tier pips (multi-tier items)
        if (item.tiers > 1) {
          const pipR = 3, pipGap = 9;
          let pipX = textX;
          const pipY = cardY + 28;
          for (let p2 = 0; p2 < item.tiers; p2++) {
            ctx.fillStyle   = p2 < tier ? '#ffd166' : 'rgba(80,60,16,0.5)';
            ctx.strokeStyle = p2 < tier ? 'rgba(255,220,80,0.6)' : 'rgba(60,45,10,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(pipX + pipR, pipY, pipR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            pipX += pipGap;
          }
        }

        // Cost / status badge (right side, vertically centred)
        ctx.save();
        ctx.globalAlpha = isSel ? 1 : isActiveCol ? 0.78 : 0.48;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        if (maxed) {
          ctx.fillStyle = '#8cf3ff';
          ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
          ctx.fillText('✓ MAX', colX + CARD_W - 10, cardY + CARD_H / 2);
        } else {
          ctx.fillStyle = canAfford ? '#ffd166' : 'rgba(160,110,30,0.50)';
          ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
          ctx.fillText(`◈ ${cost}`, colX + CARD_W - 10, cardY + CARD_H / 2);
        }
        ctx.restore();

        // Class badge (bottom-left if class-specific)
        if (item.classId) {
          const bc = item.classId === 'sword' ? '#8cf3ff'
            : item.classId === 'rogue' ? '#c77dff' : '#ffb347';
          ctx.save();
          ctx.globalAlpha = (isSel ? 0.85 : 0.45);
          ctx.fillStyle = bc; ctx.font = '8px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(item.classId, textX, cardY + CARD_H - 7);
          ctx.restore();
        }
      }
    }
  }

  // ── Info panel ───────────────────────────────────────────────────────────────

  _drawInfoPanel(ctx, W, H) {
    const item = this._selectedItem();
    const panelH = 50;
    const panelW = W * 0.70;
    const panelX = (W - panelW) / 2;
    // Position below the tallest possible column (4 rows × 82 + 3 × 7 = 349, + CARDS_Y 92 = 441)
    const panelY = H - panelH - 42;

    ctx.save();
    ctx.fillStyle = 'rgba(14,10,3,0.78)'; ctx.strokeStyle = 'rgba(255,209,102,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 5); ctx.fill(); ctx.stroke();

    if (item) {
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(item.name, panelX + 14, panelY + 8);

      ctx.fillStyle = 'rgba(255,255,255,0.70)'; ctx.font = '10.5px "Trebuchet MS", sans-serif';
      ctx.fillText(item.desc, panelX + 14, panelY + 24);

      if (item.extra) {
        ctx.fillStyle = 'rgba(200,160,80,0.50)'; ctx.font = '10px "Trebuchet MS", sans-serif';
        ctx.fillText(item.extra, panelX + 14, panelY + 37);
      }

      // Tier status (right side)
      const upg  = this.game.state.upgrades ?? defaultUpgrades();
      const tier = _getTier(upg, item.id);
      const maxed = tier >= item.tiers || (item.id === 'flask' && upg.flaskBought);
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = maxed ? '#8cf3ff' : 'rgba(255,255,255,0.30)';
      ctx.font = maxed ? 'bold 10px "Trebuchet MS", sans-serif' : '10px "Trebuchet MS", sans-serif';
      ctx.fillText(
        maxed ? `✓ Maxed (${item.tiers}/${item.tiers})` : `Tier ${tier} / ${item.tiers}`,
        panelX + panelW - 14, panelY + 8,
      );
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No items available for your class in this column.', panelX + panelW / 2, panelY + panelH / 2);
    }
    ctx.restore();
  }

  // ── Hint bar ─────────────────────────────────────────────────────────────────

  _drawHint(ctx, W, H) {
    ctx.fillStyle    = 'rgba(255,255,255,0.20)';
    ctx.font         = '10.5px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(
      'W/S · I/K  move item    Q/E · A/D · U/O · J/L  change column    Space / Enter  buy    Esc  leave',
      W / 2, H - 6,
    );
  }

  // ── Compact icon renderer ─────────────────────────────────────────────────────

  _drawItemIcon(ctx, id, cx, cy, selected, t, classId, scale = 1) {
    const s = scale;
    const pulse = selected ? (0.88 + 0.12 * Math.sin(t / 230)) : 0.72;
    const cc = classId === 'sword' ? '#8cf3ff' : classId === 'rogue' ? '#c77dff' : classId === 'archer' ? '#ffb347' : '#ffd166';
    ctx.save();
    ctx.globalAlpha = pulse;

    switch (id) {
      case 'flask': {
        ctx.strokeStyle = '#8cf3ff'; ctx.fillStyle = 'rgba(140,243,255,0.18)'; ctx.lineWidth = 1.5 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 3*s, cy - 8*s); ctx.lineTo(cx - 3*s, cy - 4*s); ctx.moveTo(cx + 3*s, cy - 8*s); ctx.lineTo(cx + 3*s, cy - 4*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 3*s, cy - 4*s); ctx.bezierCurveTo(cx - 7*s, cy - 2*s, cx - 7*s, cy + 8*s, cx, cy + 9*s); ctx.bezierCurveTo(cx + 7*s, cy + 8*s, cx + 7*s, cy - 2*s, cx + 3*s, cy - 4*s); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'maxhp': {
        const sz = 8 * s;
        if (selected) { ctx.shadowColor = '#ff4c4c'; ctx.shadowBlur = 10; }
        ctx.fillStyle = '#e03030'; ctx.strokeStyle = '#ff7070'; ctx.lineWidth = 1.2 * s;
        ctx.beginPath(); ctx.moveTo(cx, cy + sz * 0.72); ctx.bezierCurveTo(cx - sz * 1.5, cy, cx - sz * 1.5, cy - sz * 0.85, cx, cy - sz * 0.2); ctx.bezierCurveTo(cx + sz * 1.5, cy - sz * 0.85, cx + sz * 1.5, cy, cx, cy + sz * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'revive': {
        ctx.strokeStyle = '#7fff7f'; ctx.lineWidth = 1.5 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = '#7fff7f'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.moveTo(cx, cy + 8*s); ctx.lineTo(cx, cy - 4*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 5*s, cy); ctx.lineTo(cx, cy - 8*s); ctx.lineTo(cx + 5*s, cy); ctx.stroke();
        break;
      }
      case 'speed': {
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2 * s; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.moveTo(cx + 4*s, cy - 10*s); ctx.lineTo(cx - 2*s, cy); ctx.lineTo(cx + 2*s, cy); ctx.lineTo(cx - 4*s, cy + 10*s); ctx.stroke();
        break;
      }
      case 'atkspd': {
        ctx.strokeStyle = '#ff9944'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = '#ff9944'; ctx.shadowBlur = 10; }
        const ds = (a) => { ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(-9*s, 0); ctx.lineTo(7*s, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(7*s, -2.5*s); ctx.lineTo(9.5*s, 0); ctx.lineTo(7*s, 2.5*s); ctx.stroke(); ctx.restore(); };
        ds(-0.45); ds(0.45);
        break;
      }
      case 'momentum': {
        ctx.strokeStyle = '#aaffaa'; ctx.lineWidth = 1.5 * s; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) { ctx.globalAlpha = pulse * (0.28 + i * 0.22); ctx.beginPath(); ctx.arc(cx, cy, (4 + i * 4) * s, Math.PI * 0.65, Math.PI * 2 - 0.35); ctx.stroke(); }
        ctx.globalAlpha = pulse; ctx.fillStyle = '#aaffaa'; ctx.beginPath(); ctx.arc(cx, cy, 3*s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'bleed': {
        ctx.strokeStyle = '#ff5555'; ctx.fillStyle = 'rgba(255,55,55,0.22)'; ctx.lineWidth = 1.5 * s;
        if (selected) { ctx.shadowColor = '#ff5555'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.arc(cx, cy + 3*s, 6*s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 9*s); ctx.lineTo(cx - 4*s, cy); ctx.lineTo(cx + 4*s, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'bounty': {
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5 * s;
        if (selected) { ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.moveTo(cx, cy - 10*s); ctx.lineTo(cx + 7*s, cy - 2*s); ctx.lineTo(cx + 7*s, cy + 4*s); ctx.lineTo(cx, cy + 10*s); ctx.lineTo(cx - 7*s, cy + 4*s); ctx.lineTo(cx - 7*s, cy - 2*s); ctx.closePath();
        ctx.fillStyle = 'rgba(255,209,102,0.16)'; ctx.fill(); ctx.stroke();
        break;
      }
      case 'salvage': {
        ctx.strokeStyle = '#cc9944'; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = '#cc9944'; ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.moveTo(cx - 7*s, cy + 7*s); ctx.lineTo(cx + 5*s, cy - 5*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 5*s, cy - 8*s); ctx.lineTo(cx + 8*s, cy - 5*s); ctx.lineTo(cx + 2*s, cy + 1*s); ctx.lineTo(cx - 1*s, cy - 2*s); ctx.closePath(); ctx.fillStyle = 'rgba(204,153,68,0.25)'; ctx.fill(); ctx.stroke();
        break;
      }
      case 'wallbreak': {
        ctx.strokeStyle = '#ff9944'; ctx.lineWidth = 1.5 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = '#ff9944'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.moveTo(cx - 8*s, cy - 6*s); ctx.lineTo(cx - 2*s, cy - 6*s); ctx.moveTo(cx + 2*s, cy - 6*s); ctx.lineTo(cx + 8*s, cy - 6*s);
        ctx.moveTo(cx - 8*s, cy + 1*s); ctx.lineTo(cx - 4*s, cy + 1*s); ctx.moveTo(cx + 4*s, cy + 1*s); ctx.lineTo(cx + 8*s, cy + 1*s); ctx.stroke();
        ctx.strokeStyle = '#ffdd44'; ctx.lineWidth = 1 * s;
        for (let a = 0; a < 5; a++) { const ra = (a / 5) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(ra) * 2*s, cy + Math.sin(ra) * 2*s); ctx.lineTo(cx + Math.cos(ra) * 8*s, cy + Math.sin(ra) * 8*s); ctx.stroke(); }
        break;
      }
      case 'glass': {
        ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 1.5 * s;
        if (selected) { ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.moveTo(cx, cy - 10*s); ctx.lineTo(cx + 8*s, cy - 6*s); ctx.lineTo(cx + 8*s, cy + 3*s); ctx.lineTo(cx, cy + 10*s); ctx.lineTo(cx - 8*s, cy + 3*s); ctx.lineTo(cx - 8*s, cy - 6*s); ctx.closePath();
        ctx.fillStyle = 'rgba(255,55,55,0.10)'; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,160,160,0.5)'; ctx.lineWidth = 1 * s;
        ctx.beginPath(); ctx.moveTo(cx, cy - 10*s); ctx.lineTo(cx - 3*s, cy - 2*s); ctx.lineTo(cx + 5*s, cy + 3*s); ctx.lineTo(cx, cy + 10*s); ctx.stroke();
        break;
      }
      case 'overcharge': {
        ctx.strokeStyle = cc; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = cc; ctx.shadowBlur = 12; }
        ctx.strokeStyle = `rgba(140,243,255,0.40)`; ctx.lineWidth = 6*s;
        ctx.beginPath(); ctx.moveTo(cx - 1*s, cy + 10*s); ctx.lineTo(cx + 1*s, cy - 10*s); ctx.stroke();
        ctx.strokeStyle = cc; ctx.lineWidth = 2*s;
        ctx.beginPath(); ctx.moveTo(cx - 1*s, cy + 10*s); ctx.lineTo(cx + 1*s, cy - 10*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 2*s, cy - 2*s); ctx.lineTo(cx + 7*s, cy - 6*s); ctx.stroke();
        break;
      }
      case 'ricochet': {
        ctx.strokeStyle = cc; ctx.lineWidth = 1.8 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = cc; ctx.shadowBlur = 10; }
        ctx.beginPath(); ctx.moveTo(cx - 9*s, cy + 6*s); ctx.lineTo(cx + 3*s, cy - 5*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 3*s, cy - 5*s); ctx.lineTo(cx + 9*s, cy + 3*s); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 2.5*s;
        ctx.beginPath(); ctx.moveTo(cx + 1*s, cy - 8*s); ctx.lineTo(cx + 6*s, cy - 8*s); ctx.stroke();
        break;
      }
      case 'shadow': {
        ctx.strokeStyle = cc; ctx.lineWidth = 1.5 * s; ctx.lineCap = 'round';
        if (selected) { ctx.shadowColor = cc; ctx.shadowBlur = 10; }
        for (let i = 0; i < 3; i++) {
          const ox = (i - 1) * 6*s, oy = (i - 1) * 5*s;
          ctx.globalAlpha = pulse * (0.28 + i * 0.26);
          ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 3.5*s, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = pulse; ctx.fillStyle = cc;
        ctx.beginPath(); ctx.arc(cx - 8*s, cy - 6*s, 3.5*s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(cx, cy, 8*s, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
