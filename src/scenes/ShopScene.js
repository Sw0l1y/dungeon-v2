import { Scene      } from './Scene.js';
import { GameScene  } from './GameScene.js';
import { TitleScene } from './TitleScene.js';

const COLUMNS = [
  { id: 'offense', label: 'Offense', color: '#ff9944' },
  { id: 'defense', label: 'Defense', color: '#7fff7f' },
  { id: 'utility', label: 'Utility', color: '#8cf3ff' },
  { id: 'class',   label: 'Class',   color: '#c77dff' },
];

const ITEMS = [
  // ── Offense ──────────────────────────────────────────────────────────────
  { id: 'atkspd',      cat: 'offense', classId: null,     name: 'Combat Tempo', icon: 'atkspd',    tiers: 3, costs: [100,150,200], desc: '+20% attack & projectile speed.', extra: 'Stacks ×3.' },
  { id: 'bleed',       cat: 'offense', classId: null,     name: 'Bleed',        icon: 'bleed',     tiers: 1, costs: [90],          desc: 'Hits apply 30 dmg bleed over 3s.', extra: 'Refreshes on re-hit.' },
  { id: 'bounty',      cat: 'offense', classId: null,     name: 'Bounty',       icon: 'bounty',    tiers: 1, costs: [80],          desc: '20% of enemies marked for 3× gold.', extra: 'Normal enemies only.' },
  { id: 'glassCannon', cat: 'offense', classId: null,     name: 'Glass Cannon', icon: 'glass',     tiers: 1, costs: [100],         desc: 'Halve max HP. Double attack speed.', extra: 'High risk, high reward.' },
  // ── Defense ──────────────────────────────────────────────────────────────
  { id: 'flask',       cat: 'defense', classId: null,     name: 'Health Flask', icon: 'flask',     tiers: 1, costs: [50],          desc: 'Restore all players to full HP.',    extra: 'One use per shop visit.' },
  { id: 'maxhp',       cat: 'defense', classId: null,     name: 'Vital Core',   icon: 'maxhp',     tiers: 3, costs: [80,120,160],  desc: '+30 max HP for all players.',        extra: 'Stacks ×3.' },
  { id: 'reviveBoost', cat: 'defense', classId: null,     name: 'Revive Boost', icon: 'revive',    tiers: 1, costs: [60],          desc: 'Revive allies at 60% HP (was 40%).', extra: 'Applies to all players.' },
  // ── Utility ──────────────────────────────────────────────────────────────
  { id: 'speed',       cat: 'utility', classId: null,     name: 'Swiftness',    icon: 'speed',     tiers: 3, costs: [80,120,160],  desc: '+15% move speed for all players.',   extra: 'Stacks ×3.' },
  { id: 'momentum',    cat: 'utility', classId: null,     name: 'Momentum',     icon: 'momentum',  tiers: 1, costs: [70],          desc: '+40% speed for 1.5s after ability.', extra: 'Works on all classes.' },
  { id: 'salvage',     cat: 'utility', classId: null,     name: 'Salvage',      icon: 'salvage',   tiers: 1, costs: [60],          desc: 'Destroyed walls drop gold shards.',  extra: 'Pairs well with Wall Breaker.' },
  { id: 'wallBreaker', cat: 'utility', classId: null,     name: 'Wall Breaker', icon: 'wallbreak', tiers: 1, costs: [100],         desc: '[E/O] shatters walls in 120px.',     extra: '1 charge per room.' },
  // ── Class ────────────────────────────────────────────────────────────────
  { id: 'overcharge',  cat: 'class',   classId: 'sword',  name: 'Overcharge',   icon: 'overcharge',tiers: 2, costs: [100,150],     desc: 'Hold attack to charge. Full = 2.5–3× dmg.', extra: 'Sword only.' },
  { id: 'ricochet',    cat: 'class',   classId: 'archer', name: 'Ricochet',     icon: 'ricochet',  tiers: 1, costs: [80],          desc: 'Arrows bounce off walls once.',      extra: 'Archer only.' },
  { id: 'shadowChain', cat: 'class',   classId: 'rogue',  name: 'Shadow Chain', icon: 'shadow',    tiers: 1, costs: [90],          desc: 'Ricochet dash chains 6 enemies.',    extra: 'Rogue only.' },
];

export function defaultUpgrades() {
  return {
    speedTier: 0, weaponSpeedTier: 0, maxHpTier: 0, overchargeTier: 0,
    flaskBought: false, pendingHeal: false, reviveBoost: false,
    glassCannon: false, momentum: false, bleed: false, bounty: false,
    salvage: false, wallBreaker: false, ricochet: false, shadowChain: false,
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

// ── ShopScene ─────────────────────────────────────────────────────────────────
export class ShopScene extends Scene {
  onEnter() {
    const g = this.game;
    g.state.gold     = g.state.gold     ?? 0;
    g.state.upgrades = g.state.upgrades ?? defaultUpgrades();
    g.state.upgrades.flaskBought = false;

    this._net  = g.state.netSession ?? null;
    this._role = g.state.netRole    ?? null;   // null | 'host' | 'client'

    this._p1 = { colIdx: 0, rowIdx: 0, message: null, ready: false };
    this._p2 = { colIdx: 0, rowIdx: 0, message: null, ready: false };

    this._particles = [];
    this._pTimer    = 0;
    for (let i = 0; i < 55; i++) this._addParticle(true);

    if (this._net) this._net.onMessage = (data) => this._onNetMsg(data);
  }

  onExit() {}

  // ── Net ──────────────────────────────────────────────────────────────────────

  _onNetMsg(data) {
    const g = this.game;
    // ── Client-side messages ─────────────────────────────────────────────────
    if (this._role === 'client') {
      if (data.t === 'shopState') {
        g.state.upgrades  = data.upgrades;
        g.state.gold      = data.gold;
        this._p1.ready    = data.p1Ready ?? false;
      }
      if (data.t === 'shopDone') {
        g.state.upgrades  = data.upgrades;
        g.state.gold      = data.gold;
        g.state.roomIndex = data.roomIdx;
        const done = !g.maps?.campaign || data.roomIdx >= g.maps.campaign.length;
        g.scenes.switch(done ? new TitleScene(g) : new GameScene(g));
      }
      return;
    }
    // ── Host-side messages ───────────────────────────────────────────────────
    if (data.t === 'shopBuy') {
      const item = ITEMS.find(i => i.id === data.itemId);
      if (item) this._tryBuy(item, this._p2);
      this._sendShopState();
    }
    if (data.t === 'shopP2Ready') {
      this._p2.ready = data.ready;
      this._sendShopState();
      this._checkAllReady();
    }
  }

  _sendShopState() {
    if (!this._net) return;
    this._net.send({
      t: 'shopState',
      upgrades: { ...this.game.state.upgrades },
      gold:     this.game.state.gold,
      p1Ready:  this._p1.ready,
    });
  }

  // ── Column items ──────────────────────────────────────────────────────────────

  _colItems(colIdx) {
    const cat = COLUMNS[colIdx].id;
    const partyClasses = new Set((this.game.state.players ?? []).map(p => p.classId ?? 'sword'));
    const showAll = partyClasses.size === 0;
    return ITEMS.filter(item => {
      if (item.cat !== cat) return false;
      if (item.classId && !showAll && !partyClasses.has(item.classId)) return false;
      return true;
    });
  }

  _selectedItem(ps) { return this._colItems(ps.colIdx)[ps.rowIdx] ?? null; }

  _clampRow(ps) {
    const n = this._colItems(ps.colIdx).length;
    ps.rowIdx = n > 0 ? Math.min(ps.rowIdx, n - 1) : 0;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  update(dt) {
    this._pTimer += dt;
    if (this._pTimer > 0.09) { this._pTimer = 0; this._addParticle(false); }
    for (const p of this._particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      p.alpha = Math.max(0, Math.min(1, p.life / p.maxLife * 2));
    }
    this._particles = this._particles.filter(p => p.life > 0);

    for (const ps of [this._p1, this._p2]) {
      if (ps.message) { ps.message.timer -= dt; if (ps.message.timer <= 0) ps.message = null; }
    }

    const inp    = this.game.input;
    const nCols  = COLUMNS.length;
    const isLocal  = !this._net;
    const isClient = this._role === 'client';
    const isHost   = !isClient;   // local or host

    // ── P1 nav + buy + ready  (local or host) ─────────────────────────────────
    if (isHost) {
      if (inp.justPressed('KeyQ') || inp.justPressed('KeyA')) { this._p1.colIdx = (this._p1.colIdx - 1 + nCols) % nCols; this._clampRow(this._p1); }
      if (inp.justPressed('KeyE') || inp.justPressed('KeyD')) { this._p1.colIdx = (this._p1.colIdx + 1) % nCols; this._clampRow(this._p1); }
      const it1 = this._colItems(this._p1.colIdx);
      if (it1.length > 0) {
        if (inp.justPressed('KeyW') || inp.justPressed('ArrowUp'))   this._p1.rowIdx = (this._p1.rowIdx - 1 + it1.length) % it1.length;
        if (inp.justPressed('KeyS') || inp.justPressed('ArrowDown')) this._p1.rowIdx = (this._p1.rowIdx + 1) % it1.length;
      }
      if (inp.justPressed('Space')) {
        const item = this._selectedItem(this._p1);
        if (item) { this._tryBuy(item, this._p1); if (this._net) this._sendShopState(); }
      }
      if (inp.justPressed('KeyX')) {
        this._p1.ready = !this._p1.ready;
        if (this._net) this._sendShopState();
        this._checkAllReady();
      }
      if (isLocal && inp.justPressed('Escape')) this._leaveShop();
    }

    // ── P2 nav + buy + ready  (local or client) ───────────────────────────────
    if (inp.justPressed('KeyU') || inp.justPressed('KeyJ')) { this._p2.colIdx = (this._p2.colIdx - 1 + nCols) % nCols; this._clampRow(this._p2); }
    if (inp.justPressed('KeyO') || inp.justPressed('KeyL')) { this._p2.colIdx = (this._p2.colIdx + 1) % nCols; this._clampRow(this._p2); }
    const it2 = this._colItems(this._p2.colIdx);
    if (it2.length > 0) {
      if (inp.justPressed('KeyI')) this._p2.rowIdx = (this._p2.rowIdx - 1 + it2.length) % it2.length;
      if (inp.justPressed('KeyK')) this._p2.rowIdx = (this._p2.rowIdx + 1) % it2.length;
    }
    if (inp.justPressed('Enter')) {
      const item = this._selectedItem(this._p2);
      if (item) {
        if (isClient) {
          // Validate locally, then send to host to apply
          const upg  = this.game.state.upgrades;
          const tier = _getTier(upg, item.id);
          const maxed = tier >= item.tiers || (item.id === 'flask' && upg.flaskBought);
          if (maxed)                              this._msg(this._p2, 'Already maxed!',     '#ff9944');
          else if (this.game.state.gold < item.costs[tier]) this._msg(this._p2, 'Not enough gold!', '#ff6b6b');
          else { this._net.send({ t: 'shopBuy', itemId: item.id }); this._msg(this._p2, 'Purchasing…', '#aaaaff'); }
        } else {
          this._tryBuy(item, this._p2);
        }
      }
    }
    if (inp.justPressed('KeyM')) {
      this._p2.ready = !this._p2.ready;
      if (isClient) this._net.send({ t: 'shopP2Ready', ready: this._p2.ready });
      else          this._checkAllReady();
    }
  }

  // ── Buy ───────────────────────────────────────────────────────────────────────

  _tryBuy(item, ps) {
    const upg  = this.game.state.upgrades;
    const gold = this.game.state.gold;
    const tier = _getTier(upg, item.id);
    const maxed = (item.id === 'flask' && upg.flaskBought) || tier >= item.tiers;
    if (maxed) { this._msg(ps, 'Already maxed!', '#ff9944'); return; }
    const cost = item.costs[tier];
    if (gold < cost) { this._msg(ps, 'Not enough gold!', '#ff6b6b'); return; }
    this.game.state.gold -= cost;
    switch (item.id) {
      case 'flask':      upg.flaskBought = true; upg.pendingHeal = true; this._msg(ps, 'Health Flask — full heal next room!', '#7fff7f'); break;
      case 'speed':      upg.speedTier++;        this._msg(ps, `Swiftness Tier ${upg.speedTier}!`,       '#7fff7f'); break;
      case 'atkspd':     upg.weaponSpeedTier++;  this._msg(ps, `Combat Tempo Tier ${upg.weaponSpeedTier}!`, '#7fff7f'); break;
      case 'maxhp':      upg.maxHpTier++;        this._msg(ps, `Vital Core Tier ${upg.maxHpTier}!`,      '#7fff7f'); break;
      case 'overcharge': upg.overchargeTier = (upg.overchargeTier ?? 0) + 1; this._msg(ps, `Overcharge Tier ${upg.overchargeTier}!`, '#ff9944'); break;
      default:           upg[item.id] = true;    this._msg(ps, `${item.name} unlocked!`, '#7fff7f'); break;
    }
  }

  _msg(ps, text, color = '#fff') { ps.message = { text, color, timer: 2.5 }; }

  // ── Ready / leave ─────────────────────────────────────────────────────────────

  _checkAllReady() {
    if (this._p1.ready && this._p2.ready) this._leaveShop();
  }

  _leaveShop() {
    const g        = this.game;
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

  // ── Particles ─────────────────────────────────────────────────────────────────

  _addParticle(anywhere) {
    const { width: W, height: H } = this.game.canvas;
    const COLORS = ['#ffd166','#ffb347','#ffe8a0','#ff9944','#fff3cc','#d4a0ff'];
    let x, y;
    if (anywhere) { x = Math.random() * W; y = Math.random() * H; }
    else {
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 280;
      x = W/2 + Math.cos(a)*r; y = H*0.38 + Math.sin(a)*r;
    }
    const life = 2.5 + Math.random() * 3;
    this._particles.push({
      x, y, vx: (Math.random()-0.5)*18, vy: -3 - Math.random()*14,
      size: 0.9 + Math.random()*2.4, color: COLORS[Math.floor(Math.random()*COLORS.length)],
      alpha: 0, maxLife: life, life,
    });
  }

  // ── Draw ──────────────────────────────────────────────────────────────────────

  draw(ctx) {
    const { width: W, height: H } = this.game.canvas;
    ctx.fillStyle = '#060410'; ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.4, W*0.55);
    g1.addColorStop(0, 'rgba(120,80,0,0.10)'); g1.addColorStop(0.5,'rgba(60,35,0,0.05)'); g1.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    ctx.save();
    for (const p of this._particles) { ctx.globalAlpha=p.alpha*0.50; ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
    this._drawShopUI(ctx, W, H);
  }

  // ── Top-level layout ──────────────────────────────────────────────────────────

  _drawShopUI(ctx, W, H) {
    const t = Date.now();
    const HDR_H = 44;

    // Header bg
    ctx.save();
    const hg = ctx.createLinearGradient(0, 0, 0, HDR_H);
    hg.addColorStop(0, 'rgba(18,12,3,0.98)'); hg.addColorStop(1, 'rgba(10,7,2,0.85)');
    ctx.fillStyle = hg; ctx.fillRect(0, 0, W, HDR_H);
    ctx.strokeStyle = 'rgba(255,209,102,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, HDR_H); ctx.lineTo(W, HDR_H); ctx.stroke();
    ctx.restore();

    // Title
    const pulse = 0.90 + 0.10 * Math.sin(t / 1400);
    ctx.save(); ctx.globalAlpha = pulse;
    ctx.shadowColor = 'rgba(255,209,102,0.50)'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 19px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('The Armory', W / 2, HDR_H / 2);
    ctx.restore();

    // Gold badge — top-right of header
    this._drawGoldBadge(ctx, this.game.state.gold ?? 0, W - 12, 6, HDR_H - 12);

    // Bottom hint strip
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.font = '8.5px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('P1: W/S nav · Q/E tab · Space buy · X ready    |    P2: I/K nav · U/O tab · Enter buy · M ready    |    Esc leave', W/2, H - 2);
    ctx.restore();

    // Panel geometry
    const OUTER_PAD = 10, PANEL_GAP = 12;
    const pW  = (W - 2*OUTER_PAD - PANEL_GAP) / 2;
    const pX1 = OUTER_PAD;
    const pX2 = OUTER_PAD + pW + PANEL_GAP;
    const pY  = HDR_H + 6;
    const pH  = H - pY - 16;

    for (const px of [pX1, pX2]) {
      ctx.save();
      ctx.fillStyle = 'rgba(7,4,16,0.68)'; ctx.strokeStyle = 'rgba(255,209,102,0.09)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px, pY, pW, pH, 8); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    this._drawPanel(ctx, this._p1, pX1, pY, pW, pH, 'Player 1', 'Q', 'E', 'Space', 'X');
    this._drawPanel(ctx, this._p2, pX2, pY, pW, pH, 'Player 2', 'U', 'O', 'Enter', 'M');

    // Both ready overlay
    if (this._p1.ready && this._p2.ready) {
      const op = 0.70 + 0.30 * Math.sin(t / 300);
      ctx.save(); ctx.globalAlpha = op;
      ctx.fillStyle = '#7fff7f'; ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#7fff7f'; ctx.shadowBlur = 28;
      ctx.fillText('Both Ready — Continuing…', W / 2, H / 2);
      ctx.restore();
    }
  }

  // ── Panel ────────────────────────────────────────────────────────────────────

  _drawPanel(ctx, ps, pX, pY, pW, pH, label, leftKey, rightKey, buyKey, readyKey) {
    const N_COLS  = COLUMNS.length;
    const IP      = 10;
    const TAB_GAP = 4;
    const LABEL_H = 24;
    const TAB_H   = 28;
    const INFO_H  = 58;
    const READY_H = 40;
    const BOT_PAD = 8;
    const GAP_ROW = 6;
    const MAX_ROWS = 4;
    const ICON_W  = 54;
    const COST_W  = 68;

    const TAB_W  = (pW - 2*IP - (N_COLS - 1)*TAB_GAP) / N_COLS;
    const CARD_W = pW - 2*IP;
    const CARD_X = pX + IP;

    const TABS_Y  = pY + LABEL_H + 5;
    const CARDS_Y = TABS_Y + TAB_H + 6;
    const usedH   = LABEL_H + 5 + TAB_H + 6 + (MAX_ROWS - 1)*GAP_ROW + 8 + INFO_H + 6 + READY_H + BOT_PAD;
    const CARD_H  = Math.max(68, Math.floor((pH - usedH) / MAX_ROWS));
    const INFO_Y  = CARDS_Y + MAX_ROWS * (CARD_H + GAP_ROW) - GAP_ROW + 8;
    const READY_Y = INFO_Y + INFO_H + 6;

    const t    = Date.now();
    const upg  = this.game.state.upgrades ?? defaultUpgrades();
    const gold = this.game.state.gold ?? 0;
    const col  = COLUMNS[ps.colIdx];

    // ── Player label ──────────────────────────────────────────────────────────
    const labelMidY = pY + LABEL_H / 2;
    this._drawKeyBadge(ctx, leftKey,  CARD_X,         labelMidY, 'left');
    this._drawKeyBadge(ctx, rightKey, pX + pW - IP,   labelMidY, 'right');
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.52)'; ctx.font = 'bold 10px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, pX + pW / 2, labelMidY);
    ctx.restore();

    // ── Category tabs ─────────────────────────────────────────────────────────
    for (let ci = 0; ci < N_COLS; ci++) {
      const tabCol   = COLUMNS[ci];
      const tabX     = CARD_X + ci * (TAB_W + TAB_GAP);
      const isActive = ci === ps.colIdx;
      const alpha    = isActive ? (0.96 + 0.04 * Math.sin(t / 280)) : 0.52;

      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle   = isActive ? 'rgba(28,18,4,0.96)' : 'rgba(10,7,2,0.72)';
      ctx.strokeStyle = isActive ? tabCol.color : 'rgba(70,55,20,0.25)';
      ctx.lineWidth   = isActive ? 1.5 : 0.7;
      ctx.beginPath(); ctx.roundRect(tabX, TABS_Y, TAB_W, TAB_H, 4); ctx.fill(); ctx.stroke();
      if (isActive) {
        // Category color wash
        ctx.globalAlpha = 0.11 + 0.04 * Math.sin(t / 280);
        ctx.fillStyle = tabCol.color;
        ctx.beginPath(); ctx.roundRect(tabX, TABS_Y, TAB_W, TAB_H, 4); ctx.fill();
        // Bottom accent bar
        ctx.globalAlpha = alpha * 0.90;
        ctx.fillStyle = tabCol.color;
        ctx.beginPath(); ctx.roundRect(tabX + 8, TABS_Y + TAB_H - 3.5, TAB_W - 16, 2.5, 1.5); ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isActive ? tabCol.color : '#5a4a1a';
      ctx.font = isActive ? 'bold 9.5px "Trebuchet MS", sans-serif' : '9px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tabCol.label, tabX + TAB_W / 2, TABS_Y + TAB_H / 2 - 0.5);
      ctx.restore();
    }

    // ── Item cards ────────────────────────────────────────────────────────────
    const items = this._colItems(ps.colIdx);

    if (items.length === 0) {
      ctx.save(); ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#d8cfc0'; ctx.font = '10px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No items available for this party', pX + pW / 2, CARDS_Y + 50);
      ctx.restore();
    } else {
      for (let ri = 0; ri < items.length; ri++) {
        const item      = items[ri];
        const cardY     = CARDS_Y + ri * (CARD_H + GAP_ROW);
        const isSel     = ri === ps.rowIdx;
        const tier      = _getTier(upg, item.id);
        const maxed     = tier >= item.tiers || (item.id === 'flask' && upg.flaskBought);
        const cost      = maxed ? 0 : item.costs[tier];
        const canAfford = !maxed && gold >= cost;
        const pulse     = isSel ? (0.97 + 0.03 * Math.sin(t / 240)) : 0.72;

        // Card bg
        ctx.save(); ctx.globalAlpha = pulse;
        ctx.fillStyle   = isSel ? 'rgba(52,35,6,0.96)' : 'rgba(12,8,2,0.84)';
        ctx.strokeStyle = isSel ? col.color
                        : maxed ? 'rgba(140,243,255,0.28)'
                        : canAfford ? 'rgba(255,200,80,0.20)'
                        : 'rgba(45,34,10,0.22)';
        ctx.lineWidth   = isSel ? 1.5 : 0.8;
        ctx.beginPath(); ctx.roundRect(CARD_X, cardY, CARD_W, CARD_H, 6); ctx.fill(); ctx.stroke();
        if (isSel) {
          ctx.globalAlpha = 0.07 + 0.03 * Math.sin(t / 240);
          ctx.fillStyle = col.color;
          ctx.beginPath(); ctx.roundRect(CARD_X, cardY, CARD_W, CARD_H, 6); ctx.fill();
        }
        ctx.restore();

        // Icon zone — soft circle bg + icon
        const iconCX = CARD_X + ICON_W / 2;
        const iconCY = cardY + CARD_H / 2;
        ctx.save(); ctx.globalAlpha = isSel ? 0.20 : 0.09;
        ctx.fillStyle = isSel ? col.color : 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(iconCX, iconCY, ICON_W * 0.36, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        this._drawItemIcon(ctx, item.icon, iconCX, iconCY, isSel, t, item.classId, 1.25);

        // Divider between icon and text
        ctx.save(); ctx.globalAlpha = isSel ? 0.16 : 0.07;
        ctx.strokeStyle = isSel ? col.color : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(CARD_X + ICON_W, cardY + 10); ctx.lineTo(CARD_X + ICON_W, cardY + CARD_H - 10); ctx.stroke();
        ctx.restore();

        // Text zone
        const textX   = CARD_X + ICON_W + 12;
        const nameY   = cardY + Math.floor(CARD_H * 0.22);
        const descY   = nameY + 18;
        const detailY = cardY + CARD_H - 14;

        // Name
        ctx.save(); ctx.globalAlpha = isSel ? 1.0 : 0.76;
        ctx.fillStyle = isSel ? '#ffd166' : '#a08228';
        ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        if (isSel) { ctx.shadowColor = 'rgba(255,209,102,0.35)'; ctx.shadowBlur = 7; }
        ctx.fillText(item.name, textX, nameY);
        ctx.restore();

        // Desc
        ctx.save(); ctx.globalAlpha = isSel ? 0.84 : 0.48;
        ctx.fillStyle = '#cfc8bc';
        ctx.font = '9.5px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(item.desc, textX, descY);
        ctx.restore();

        // Tier pips
        if (item.tiers > 1) {
          let pipX = textX;
          for (let p = 0; p < item.tiers; p++) {
            const filled = p < tier;
            ctx.save(); ctx.globalAlpha = isSel ? (filled ? 1.0 : 0.30) : (filled ? 0.72 : 0.18);
            ctx.fillStyle   = filled ? '#ffd166' : 'rgba(100,78,22,0.6)';
            ctx.strokeStyle = filled ? 'rgba(255,220,80,0.5)' : 'rgba(70,52,14,0.3)';
            ctx.lineWidth   = 0.8;
            ctx.beginPath(); ctx.arc(pipX + 4, detailY, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
            pipX += 11;
          }
        }

        // Class badge
        if (item.classId) {
          const bc = item.classId==='sword' ? '#8cf3ff' : item.classId==='rogue' ? '#c77dff' : '#ffb347';
          const pipOffset = item.tiers > 1 ? item.tiers * 11 + 8 : 0;
          ctx.save(); ctx.globalAlpha = isSel ? 0.78 : 0.32;
          ctx.fillStyle = bc; ctx.font = '8px "Trebuchet MS", sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(item.classId, textX + pipOffset, detailY);
          ctx.restore();
        }

        // Cost / MAX — right zone
        const costCX = CARD_X + CARD_W - COST_W / 2;
        const costCY = cardY + CARD_H / 2;
        ctx.save(); ctx.globalAlpha = isSel ? 1.0 : 0.68;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (maxed) {
          ctx.fillStyle = '#8cf3ff'; ctx.font = 'bold 9.5px "Trebuchet MS", sans-serif';
          if (isSel) { ctx.shadowColor = '#8cf3ff'; ctx.shadowBlur = 10; }
          ctx.fillText('✓ MAX', costCX, costCY);
        } else {
          ctx.fillStyle = canAfford ? '#ffd166' : 'rgba(140,100,28,0.55)';
          ctx.font = `bold ${isSel ? 13 : 12}px "Trebuchet MS", sans-serif`;
          if (isSel && canAfford) { ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10; }
          ctx.fillText(`◈ ${cost}`, costCX, costCY);
        }
        ctx.restore();
      }
    }

    // ── Info panel ────────────────────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,1,0.82)'; ctx.strokeStyle = 'rgba(255,209,102,0.11)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(CARD_X, INFO_Y, CARD_W, INFO_H, 5); ctx.fill(); ctx.stroke();
    const sel = this._selectedItem(ps);
    if (sel) {
      const selTier  = _getTier(upg, sel.id);
      const selMaxed = selTier >= sel.tiers || (sel.id === 'flask' && upg.flaskBought);

      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(sel.name, CARD_X + 12, INFO_Y + 9);

      if (sel.extra) {
        ctx.fillStyle = 'rgba(200,165,80,0.62)'; ctx.font = '9.5px "Trebuchet MS", sans-serif';
        ctx.fillText(sel.extra, CARD_X + 12, INFO_Y + 25);
      }

      // Tier progress bar
      if (sel.tiers > 1) {
        const barX = CARD_X + 12, barY = INFO_Y + INFO_H - 15, barW = 100, barH = 5;
        ctx.fillStyle = 'rgba(50,38,12,0.65)';
        ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 2.5); ctx.fill();
        const fill = selMaxed ? 1 : selTier / sel.tiers;
        if (fill > 0) {
          ctx.fillStyle = selMaxed ? '#8cf3ff' : '#ffd166';
          ctx.beginPath(); ctx.roundRect(barX, barY, barW * fill, barH, 2.5); ctx.fill();
        }
        ctx.fillStyle = selMaxed ? '#8cf3ff' : 'rgba(255,255,255,0.32)';
        ctx.font = '8px "Trebuchet MS", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(selMaxed ? 'Maxed' : `${selTier} / ${sel.tiers}`, barX + barW + 7, barY + barH / 2);
      } else if (selMaxed) {
        ctx.fillStyle = '#8cf3ff'; ctx.font = 'bold 8.5px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText('✓ Unlocked', CARD_X + 12, INFO_Y + INFO_H - 6);
      }

      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillStyle = selMaxed ? '#8cf3ff' : 'rgba(255,255,255,0.25)';
      ctx.font = selMaxed ? 'bold 9px "Trebuchet MS", sans-serif' : '9px "Trebuchet MS", sans-serif';
      ctx.fillText(selMaxed ? '✓ Maxed' : `Tier ${selTier} / ${sel.tiers}`, CARD_X + CARD_W - 10, INFO_Y + 9);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '9.5px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No items for this party', CARD_X + CARD_W / 2, INFO_Y + INFO_H / 2);
    }
    ctx.restore();

    // ── Per-player message ────────────────────────────────────────────────────
    if (ps.message) {
      ctx.save(); ctx.globalAlpha = Math.min(1, ps.message.timer * 1.5);
      ctx.fillStyle = ps.message.color; ctx.shadowColor = ps.message.color; ctx.shadowBlur = 14;
      ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(ps.message.text, pX + pW / 2, INFO_Y - 5);
      ctx.restore();
    }

    // ── Ready button ──────────────────────────────────────────────────────────
    const isReady    = ps.ready;
    const otherReady = ps === this._p1 ? this._p2.ready : this._p1.ready;
    const rPulse     = isReady ? (0.82 + 0.18 * Math.sin(t / 400)) : 1;

    ctx.save(); ctx.globalAlpha = rPulse;
    ctx.fillStyle   = isReady ? 'rgba(0,130,55,0.32)' : 'rgba(18,13,4,0.78)';
    ctx.strokeStyle = isReady ? 'rgba(127,255,127,0.72)' : 'rgba(255,200,80,0.22)';
    ctx.lineWidth   = isReady ? 1.5 : 0.8;
    ctx.beginPath(); ctx.roundRect(CARD_X, READY_Y, CARD_W, READY_H, 6); ctx.fill(); ctx.stroke();
    if (isReady) {
      ctx.globalAlpha = (0.07 + 0.03 * Math.sin(t / 400)) * rPulse;
      ctx.fillStyle = '#7fff7f'; ctx.beginPath(); ctx.roundRect(CARD_X, READY_Y, CARD_W, READY_H, 6); ctx.fill();
    }
    ctx.globalAlpha = rPulse;
    ctx.fillStyle = isReady ? '#7fff7f' : 'rgba(255,255,255,0.38)';
    ctx.font = isReady ? 'bold 13px "Trebuchet MS", sans-serif' : '11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (isReady) { ctx.shadowColor = '#7fff7f'; ctx.shadowBlur = 12; }
    ctx.fillText(isReady ? '✓  Ready' : 'Not Ready', pX + pW / 2, READY_Y + READY_H / 2);
    this._drawKeyBadge(ctx, readyKey, CARD_X + CARD_W - IP, READY_Y + READY_H / 2, 'right');
    ctx.restore();

    if (isReady && !otherReady) {
      ctx.save(); ctx.globalAlpha = 0.35 + 0.20 * Math.sin(t / 600);
      ctx.fillStyle = '#7fff7f'; ctx.font = '8.5px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('waiting for other player…', pX + pW / 2, READY_Y + READY_H + 3);
      ctx.restore();
    }
  }

  // ── Key badge ────────────────────────────────────────────────────────────────
  // side 'left'  → badge extends right from cx
  // side 'right' → badge extends left from cx

  _drawKeyBadge(ctx, label, cx, cy, side) {
    ctx.save();
    ctx.font = 'bold 8.5px "Trebuchet MS", sans-serif';
    const tw = ctx.measureText(label).width;
    const bw = tw + 10, bh = 15;
    const bx = side === 'left' ? cx + 2 : cx - bw - 2;
    ctx.fillStyle = 'rgba(16,11,3,0.88)'; ctx.strokeStyle = 'rgba(255,209,102,0.38)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.roundRect(bx, cy - bh/2, bw, bh, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,209,102,0.72)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw/2, cy);
    ctx.restore();
  }

  // ── Gold badge ────────────────────────────────────────────────────────────────

  _drawGoldBadge(ctx, gold, rightEdgeX, topY, badgeH) {
    ctx.save(); ctx.globalAlpha = 0.90 + 0.10 * Math.sin(Date.now() / 650);
    ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
    const txt = `◈  ${gold}  gold`, tw = ctx.measureText(txt).width;
    const bw = tw + 18;
    const bx = rightEdgeX - bw, by = topY;
    ctx.fillStyle = 'rgba(6,4,1,0.86)'; ctx.strokeStyle = 'rgba(255,209,102,0.32)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, badgeH, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + bw/2, by + badgeH/2);
    ctx.restore();
  }

  // ── Icon renderer ────────────────────────────────────────────────────────────

  _drawItemIcon(ctx, id, cx, cy, selected, t, classId, scale = 1) {
    const s = scale, pulse = selected ? (0.88 + 0.12 * Math.sin(t / 230)) : 0.72;
    const cc = classId==='sword' ? '#8cf3ff' : classId==='rogue' ? '#c77dff' : classId==='archer' ? '#ffb347' : '#ffd166';
    ctx.save(); ctx.globalAlpha = pulse;
    switch (id) {
      case 'flask': {
        ctx.strokeStyle='#8cf3ff'; ctx.fillStyle='rgba(140,243,255,0.18)'; ctx.lineWidth=1.5*s; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(cx-3*s,cy-8*s); ctx.lineTo(cx-3*s,cy-4*s); ctx.moveTo(cx+3*s,cy-8*s); ctx.lineTo(cx+3*s,cy-4*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx-3*s,cy-4*s); ctx.bezierCurveTo(cx-7*s,cy-2*s,cx-7*s,cy+8*s,cx,cy+9*s); ctx.bezierCurveTo(cx+7*s,cy+8*s,cx+7*s,cy-2*s,cx+3*s,cy-4*s); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      }
      case 'maxhp': {
        const sz=8*s; if(selected){ctx.shadowColor='#ff4c4c';ctx.shadowBlur=10;}
        ctx.fillStyle='#e03030'; ctx.strokeStyle='#ff7070'; ctx.lineWidth=1.2*s;
        ctx.beginPath(); ctx.moveTo(cx,cy+sz*0.72); ctx.bezierCurveTo(cx-sz*1.5,cy,cx-sz*1.5,cy-sz*0.85,cx,cy-sz*0.2); ctx.bezierCurveTo(cx+sz*1.5,cy-sz*0.85,cx+sz*1.5,cy,cx,cy+sz*0.72); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      }
      case 'revive': {
        ctx.strokeStyle='#7fff7f'; ctx.lineWidth=1.5*s; ctx.lineCap='round'; if(selected){ctx.shadowColor='#7fff7f';ctx.shadowBlur=10;}
        ctx.beginPath(); ctx.moveTo(cx,cy+8*s); ctx.lineTo(cx,cy-4*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx-5*s,cy); ctx.lineTo(cx,cy-8*s); ctx.lineTo(cx+5*s,cy); ctx.stroke(); break;
      }
      case 'speed': {
        ctx.strokeStyle='#ffe066'; ctx.lineWidth=2*s; ctx.lineJoin='round'; ctx.lineCap='round'; if(selected){ctx.shadowColor='#ffe066';ctx.shadowBlur=12;}
        ctx.beginPath(); ctx.moveTo(cx+4*s,cy-10*s); ctx.lineTo(cx-2*s,cy); ctx.lineTo(cx+2*s,cy); ctx.lineTo(cx-4*s,cy+10*s); ctx.stroke(); break;
      }
      case 'atkspd': {
        ctx.strokeStyle='#ff9944'; ctx.lineWidth=2*s; ctx.lineCap='round'; if(selected){ctx.shadowColor='#ff9944';ctx.shadowBlur=10;}
        const ds=(a)=>{ctx.save();ctx.translate(cx,cy);ctx.rotate(a);ctx.beginPath();ctx.moveTo(-9*s,0);ctx.lineTo(7*s,0);ctx.stroke();ctx.beginPath();ctx.moveTo(7*s,-2.5*s);ctx.lineTo(9.5*s,0);ctx.lineTo(7*s,2.5*s);ctx.stroke();ctx.restore();};
        ds(-0.45); ds(0.45); break;
      }
      case 'momentum': {
        ctx.strokeStyle='#aaffaa'; ctx.lineWidth=1.5*s; ctx.lineCap='round';
        for(let i=0;i<3;i++){ctx.globalAlpha=pulse*(0.28+i*0.22);ctx.beginPath();ctx.arc(cx,cy,(4+i*4)*s,Math.PI*0.65,Math.PI*2-0.35);ctx.stroke();}
        ctx.globalAlpha=pulse; ctx.fillStyle='#aaffaa'; ctx.beginPath(); ctx.arc(cx,cy,3*s,0,Math.PI*2); ctx.fill(); break;
      }
      case 'bleed': {
        ctx.strokeStyle='#ff5555'; ctx.fillStyle='rgba(255,55,55,0.22)'; ctx.lineWidth=1.5*s; if(selected){ctx.shadowColor='#ff5555';ctx.shadowBlur=10;}
        ctx.beginPath(); ctx.arc(cx,cy+3*s,6*s,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx,cy-9*s); ctx.lineTo(cx-4*s,cy); ctx.lineTo(cx+4*s,cy); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
      }
      case 'bounty': {
        ctx.strokeStyle='#ffd166'; ctx.lineWidth=1.5*s; if(selected){ctx.shadowColor='#ffd166';ctx.shadowBlur=12;}
        ctx.beginPath(); ctx.moveTo(cx,cy-10*s); ctx.lineTo(cx+7*s,cy-2*s); ctx.lineTo(cx+7*s,cy+4*s); ctx.lineTo(cx,cy+10*s); ctx.lineTo(cx-7*s,cy+4*s); ctx.lineTo(cx-7*s,cy-2*s); ctx.closePath();
        ctx.fillStyle='rgba(255,209,102,0.16)'; ctx.fill(); ctx.stroke(); break;
      }
      case 'salvage': {
        ctx.strokeStyle='#cc9944'; ctx.lineWidth=2*s; ctx.lineCap='round'; if(selected){ctx.shadowColor='#cc9944';ctx.shadowBlur=8;}
        ctx.beginPath(); ctx.moveTo(cx-7*s,cy+7*s); ctx.lineTo(cx+5*s,cy-5*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+5*s,cy-8*s); ctx.lineTo(cx+8*s,cy-5*s); ctx.lineTo(cx+2*s,cy+1*s); ctx.lineTo(cx-1*s,cy-2*s); ctx.closePath(); ctx.fillStyle='rgba(204,153,68,0.25)'; ctx.fill(); ctx.stroke(); break;
      }
      case 'wallbreak': {
        ctx.strokeStyle='#ff9944'; ctx.lineWidth=1.5*s; ctx.lineCap='round'; if(selected){ctx.shadowColor='#ff9944';ctx.shadowBlur=10;}
        ctx.beginPath(); ctx.moveTo(cx-8*s,cy-6*s); ctx.lineTo(cx-2*s,cy-6*s); ctx.moveTo(cx+2*s,cy-6*s); ctx.lineTo(cx+8*s,cy-6*s); ctx.moveTo(cx-8*s,cy+1*s); ctx.lineTo(cx-4*s,cy+1*s); ctx.moveTo(cx+4*s,cy+1*s); ctx.lineTo(cx+8*s,cy+1*s); ctx.stroke();
        ctx.strokeStyle='#ffdd44'; ctx.lineWidth=1*s;
        for(let a=0;a<5;a++){const ra=(a/5)*Math.PI*2;ctx.beginPath();ctx.moveTo(cx+Math.cos(ra)*2*s,cy+Math.sin(ra)*2*s);ctx.lineTo(cx+Math.cos(ra)*8*s,cy+Math.sin(ra)*8*s);ctx.stroke();} break;
      }
      case 'glass': {
        ctx.strokeStyle='#ff4444'; ctx.lineWidth=1.5*s; if(selected){ctx.shadowColor='#ff4444';ctx.shadowBlur=10;}
        ctx.beginPath(); ctx.moveTo(cx,cy-10*s); ctx.lineTo(cx+8*s,cy-6*s); ctx.lineTo(cx+8*s,cy+3*s); ctx.lineTo(cx,cy+10*s); ctx.lineTo(cx-8*s,cy+3*s); ctx.lineTo(cx-8*s,cy-6*s); ctx.closePath();
        ctx.fillStyle='rgba(255,55,55,0.10)'; ctx.fill(); ctx.stroke();
        ctx.strokeStyle='rgba(255,160,160,0.5)'; ctx.lineWidth=1*s;
        ctx.beginPath(); ctx.moveTo(cx,cy-10*s); ctx.lineTo(cx-3*s,cy-2*s); ctx.lineTo(cx+5*s,cy+3*s); ctx.lineTo(cx,cy+10*s); ctx.stroke(); break;
      }
      case 'overcharge': {
        if(selected){ctx.shadowColor=cc;ctx.shadowBlur=12;}
        ctx.strokeStyle='rgba(140,243,255,0.40)'; ctx.lineWidth=6*s; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(cx-1*s,cy+10*s); ctx.lineTo(cx+1*s,cy-10*s); ctx.stroke();
        ctx.strokeStyle=cc; ctx.lineWidth=2*s;
        ctx.beginPath(); ctx.moveTo(cx-1*s,cy+10*s); ctx.lineTo(cx+1*s,cy-10*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+2*s,cy-2*s); ctx.lineTo(cx+7*s,cy-6*s); ctx.stroke(); break;
      }
      case 'ricochet': {
        ctx.strokeStyle=cc; ctx.lineWidth=1.8*s; ctx.lineCap='round'; if(selected){ctx.shadowColor=cc;ctx.shadowBlur=10;}
        ctx.beginPath(); ctx.moveTo(cx-9*s,cy+6*s); ctx.lineTo(cx+3*s,cy-5*s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+3*s,cy-5*s); ctx.lineTo(cx+9*s,cy+3*s); ctx.stroke();
        ctx.strokeStyle='rgba(255,255,255,0.30)'; ctx.lineWidth=2.5*s;
        ctx.beginPath(); ctx.moveTo(cx+1*s,cy-8*s); ctx.lineTo(cx+6*s,cy-8*s); ctx.stroke(); break;
      }
      case 'shadow': {
        ctx.strokeStyle=cc; ctx.lineWidth=1.5*s; ctx.lineCap='round'; if(selected){ctx.shadowColor=cc;ctx.shadowBlur=10;}
        for(let i=0;i<3;i++){const ox=(i-1)*6*s,oy=(i-1)*5*s;ctx.globalAlpha=pulse*(0.28+i*0.26);ctx.beginPath();ctx.arc(cx+ox,cy+oy,3.5*s,0,Math.PI*2);ctx.stroke();}
        ctx.globalAlpha=pulse; ctx.fillStyle=cc; ctx.beginPath(); ctx.arc(cx-8*s,cy-6*s,3.5*s,0,Math.PI*2); ctx.fill(); break;
      }
      default: {
        ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(cx,cy,8*s,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0; ctx.restore();
  }
}
