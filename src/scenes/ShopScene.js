import { Scene      } from './Scene.js';
import { GameScene  } from './GameScene.js';
import { TitleScene } from './TitleScene.js';

// ── Categories ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'all',     label: 'All'     },
  { id: 'offense', label: 'Offense' },
  { id: 'defense', label: 'Defense' },
  { id: 'utility', label: 'Utility' },
  { id: 'class',   label: 'Class'   },
];

// ── Item definitions ─────────────────────────────────────────────────────────
const ITEMS = [
  // Defense
  {
    id: 'flask', cat: 'defense', classId: null, name: 'Health Flask',
    icon: 'flask', tiers: 1, costs: [50],
    desc: 'Restores all players to full HP.',
    extra: 'One use per shop visit.',
  },
  {
    id: 'maxhp', cat: 'defense', classId: null, name: 'Vital Core',
    icon: 'maxhp', tiers: 3, costs: [80, 120, 160],
    desc: '+30 max HP for all players.',
    extra: 'Stacks up to ×3.',
  },
  {
    id: 'reviveBoost', cat: 'defense', classId: null, name: 'Revive Boost',
    icon: 'revive', tiers: 1, costs: [60],
    desc: 'Revive allies at 60% HP instead of 40%.',
    extra: 'Works for all players.',
  },
  // Offense
  {
    id: 'atkspd', cat: 'offense', classId: null, name: 'Combat Tempo',
    icon: 'atkspd', tiers: 3, costs: [100, 150, 200],
    desc: '+20% attack speed and projectile speed.',
    extra: 'Stacks up to ×3.',
  },
  {
    id: 'bleed', cat: 'offense', classId: null, name: 'Bleed',
    icon: 'bleed', tiers: 1, costs: [90],
    desc: 'Attacks apply a 3s bleed for 30 total damage.',
    extra: 'Refreshes on re-hit.',
  },
  {
    id: 'bounty', cat: 'offense', classId: null, name: 'Bounty',
    icon: 'bounty', tiers: 1, costs: [80],
    desc: '20% of enemies are marked for 3× gold.',
    extra: 'Normal enemies only.',
  },
  {
    id: 'glassCannon', cat: 'offense', classId: null, name: 'Glass Cannon',
    icon: 'glass', tiers: 1, costs: [100],
    desc: 'Halve max HP. Double attack speed.',
    extra: 'High risk, high reward.',
  },
  // Utility
  {
    id: 'speed', cat: 'utility', classId: null, name: 'Swiftness',
    icon: 'speed', tiers: 3, costs: [80, 120, 160],
    desc: '+15% move speed for all players.',
    extra: 'Stacks up to ×3.',
  },
  {
    id: 'momentum', cat: 'utility', classId: null, name: 'Momentum',
    icon: 'momentum', tiers: 1, costs: [70],
    desc: '+40% move speed for 1.5s after using an ability.',
    extra: 'Works on all classes.',
  },
  {
    id: 'salvage', cat: 'utility', classId: null, name: 'Salvage',
    icon: 'salvage', tiers: 1, costs: [60],
    desc: 'Destroyed walls drop gold shards.',
    extra: 'Great with Wall Breaker.',
  },
  {
    id: 'wallBreaker', cat: 'utility', classId: null, name: 'Wall Breaker',
    icon: 'wallbreak', tiers: 1, costs: [100],
    desc: 'Press [E/O] to shatter all destructible walls within 120px.',
    extra: '1 charge per room.',
  },
  // Class-specific
  {
    id: 'overcharge', cat: 'offense', classId: 'sword', name: 'Overcharge',
    icon: 'overcharge', tiers: 2, costs: [100, 150],
    desc: 'Hold attack to charge a massive sword swing.',
    extra: 'Sword only. Full charge = 2.5–3× damage.',
  },
  {
    id: 'ricochet', cat: 'offense', classId: 'archer', name: 'Ricochet',
    icon: 'ricochet', tiers: 1, costs: [80],
    desc: 'Arrows bounce off walls once.',
    extra: 'Archer only.',
  },
  {
    id: 'shadowChain', cat: 'offense', classId: 'rogue', name: 'Shadow Chain',
    icon: 'shadow', tiers: 1, costs: [90],
    desc: 'Ricochet dash chains through 6 enemies instead of 3.',
    extra: 'Rogue only.',
  },
];

// ── Upgrade defaults ─────────────────────────────────────────────────────────
export function defaultUpgrades() {
  return {
    // Tiered
    speedTier:       0,
    weaponSpeedTier: 0,
    maxHpTier:       0,
    overchargeTier:  0,
    // Booleans
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
  if (id === 'flask')        return upg.flaskBought ? 1 : 0;
  if (id === 'speed')        return upg.speedTier;
  if (id === 'atkspd')       return upg.weaponSpeedTier;
  if (id === 'maxhp')        return upg.maxHpTier;
  if (id === 'overcharge')   return upg.overchargeTier ?? 0;
  // All other upgrades are boolean (0 or 1)
  return upg[id] ? 1 : 0;
}

// ── ShopScene ────────────────────────────────────────────────────────────────
export class ShopScene extends Scene {
  onEnter() {
    const g = this.game;
    g.state.gold     = g.state.gold     ?? 0;
    g.state.upgrades = g.state.upgrades ?? defaultUpgrades();
    // Reset per-visit flask flag so each shop allows one purchase
    g.state.upgrades.flaskBought = false;

    this._net  = g.state.netSession ?? null;
    this._role = g.state.netRole    ?? null;

    // UI state
    this._tabIdx    = 0;   // active category tab index
    this._selected  = 0;   // selected item index within current filtered list
    this._viewOff   = 0;   // horizontal scroll offset (cards visible = 4)
    this._message   = null;

    // Warm ambient particles
    this._particles = [];
    this._pTimer    = 0;
    for (let i = 0; i < 50; i++) this._addParticle(true);

    if (this._net) {
      this._net.onMessage = (data) => this._onNetMsg(data);
    }
  }

  onExit() {}

  // ── Net ─────────────────────────────────────────────────────────────────────

  _onNetMsg(data) {
    if (this._role === 'client') {
      if (data.t === 'shopDone') {
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
  }

  // ── Filtered item list for the active tab ────────────────────────────────────

  _filteredItems() {
    const cat    = CATEGORIES[this._tabIdx].id;
    const upg    = this.game.state.upgrades ?? defaultUpgrades();
    const gold   = this.game.state.gold ?? 0;

    // Classes present in the party (for filtering class-specific items)
    const partyClasses = new Set(
      (this.game.state.players ?? []).map(p => p.classId ?? 'sword')
    );
    // If no player data (solo, no lobby), show all class items
    const showAll = partyClasses.size === 0;

    return ITEMS.filter(item => {
      // Class filter: hide items for classes not in the party (unless show-all)
      if (item.classId && !showAll && !partyClasses.has(item.classId)) return false;
      // Category filter
      if (cat === 'all') return true;
      if (cat === 'class') return !!item.classId;
      return item.cat === cat;
    });
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  update(dt) {
    this._pTimer += dt;
    if (this._pTimer > 0.10) { this._pTimer = 0; this._addParticle(false); }
    for (const p of this._particles) {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, Math.min(1, p.life / p.maxLife * 2));
    }
    this._particles = this._particles.filter(p => p.life > 0);

    if (this._message) {
      this._message.timer -= dt;
      if (this._message.timer <= 0) this._message = null;
    }

    if (this._role === 'client') return;   // client waits

    const input = this.game.input;
    const items = this._filteredItems();
    const n     = items.length;

    // Tab navigation: Tab / Q / E (when no item action)
    if (input.justPressed('Tab') || input.justPressed('KeyQ')) {
      this._tabIdx = (this._tabIdx + 1) % CATEGORIES.length;
      this._selected = 0;
      this._viewOff  = 0;
    }

    // Item navigation: ← →
    if ((input.justPressed('ArrowLeft') || input.justPressed('KeyA')) && n > 0) {
      this._selected = (this._selected - 1 + n) % n;
      this._clampView();
    }
    if ((input.justPressed('ArrowRight') || input.justPressed('KeyD')) && n > 0) {
      this._selected = (this._selected + 1) % n;
      this._clampView();
    }

    if (input.justPressed('Space') || input.justPressed('Enter')) {
      if (n > 0) this._tryBuy(items[this._selected]);
    }
    if (input.justPressed('Escape') || input.justPressed('KeyE')) {
      this._leaveShop();
    }
  }

  _clampView() {
    const VISIBLE = 4;
    if (this._selected < this._viewOff) this._viewOff = this._selected;
    if (this._selected >= this._viewOff + VISIBLE) this._viewOff = this._selected - VISIBLE + 1;
  }

  // ── Buy logic ────────────────────────────────────────────────────────────────

  _tryBuy(item) {
    const upg  = this.game.state.upgrades;
    const gold = this.game.state.gold;
    const tier = _getTier(upg, item.id);

    // Already maxed / bought?
    const maxed = (item.id === 'flask' && upg.flaskBought) || tier >= item.tiers;
    if (maxed) { this._msg('Already maxed!', '#ff9944'); return; }

    const cost = item.costs[tier];
    if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
    this.game.state.gold -= cost;

    switch (item.id) {
      case 'flask':
        upg.flaskBought = true; upg.pendingHeal = true;
        this._msg('Health Flask — healing on next room!', '#7fff7f'); break;
      case 'speed':
        upg.speedTier++;
        this._msg(`Swiftness  Tier ${upg.speedTier}!`, '#7fff7f'); break;
      case 'atkspd':
        upg.weaponSpeedTier++;
        this._msg(`Combat Tempo  Tier ${upg.weaponSpeedTier}!`, '#7fff7f'); break;
      case 'maxhp':
        upg.maxHpTier++;
        this._msg(`Vital Core  Tier ${upg.maxHpTier}!`, '#7fff7f'); break;
      case 'overcharge':
        upg.overchargeTier = (upg.overchargeTier ?? 0) + 1;
        this._msg(`Overcharge  Tier ${upg.overchargeTier}!`, '#ff9944'); break;
      default:
        // Boolean upgrades
        upg[item.id] = true;
        this._msg(`${item.name} unlocked!`, '#7fff7f'); break;
    }
  }

  _msg(text, color = '#fff') {
    this._message = { text, color, timer: 2.5 };
  }

  // ── Leave ────────────────────────────────────────────────────────────────────

  _leaveShop() {
    const g        = this.game;
    const campaign = g.maps?.campaign;
    const nextIdx  = (g.state.roomIndex ?? 0) + 1;

    if (this._net) {
      this._net.send({
        t:        'shopDone',
        upgrades: { ...g.state.upgrades },
        gold:     g.state.gold,
        roomIdx:  nextIdx,
      });
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
    const COLORS = ['#ffd166', '#ffb347', '#ffe8a0', '#ff9944', '#fff3cc', '#d4a0ff'];
    let x, y;
    if (anywhere) {
      x = Math.random() * W;
      y = Math.random() * H;
    } else {
      const cx = W / 2, cy = H * 0.40;
      const a  = Math.random() * Math.PI * 2;
      const r  = 60 + Math.random() * 260;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
    }
    const life = 2.5 + Math.random() * 3;
    this._particles.push({
      x, y,
      vx:     (Math.random() - 0.5) * 20,
      vy:     -4 - Math.random() * 16,
      size:   1.0 + Math.random() * 2.6,
      color:  COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha:  0,
      maxLife: life,
      life,
    });
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────

  draw(ctx) {
    const { width: W, height: H } = this.game.canvas;

    // Dark warm background
    ctx.fillStyle = '#080611';
    ctx.fillRect(0, 0, W, H);

    // Radial warm glow
    const grad = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, W * 0.52);
    grad.addColorStop(0,    'rgba(160,110,0,0.14)');
    grad.addColorStop(0.42, 'rgba(100,50,0,0.08)');
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const grad2 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.55);
    grad2.addColorStop(0, 'rgba(90,40,140,0.10)');
    grad2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, W, H);

    // Particles
    ctx.save();
    for (const p of this._particles) {
      ctx.globalAlpha = p.alpha * 0.65;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this._role === 'client') {
      this._drawClientWait(ctx);
      return;
    }

    this._drawShopUI(ctx, W, H);
  }

  _drawClientWait(ctx) {
    const { width: W, height: H } = this.game.canvas;
    const t     = Date.now();
    const pulse = 0.75 + 0.25 * Math.sin(t / 700);

    ctx.save();
    ctx.globalAlpha  = pulse;
    ctx.fillStyle    = '#ffd166';
    ctx.font         = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Host is shopping…', W / 2, H / 2 - 24);
    ctx.restore();

    ctx.fillStyle    = 'rgba(255,255,255,0.32)';
    ctx.font         = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Upgrades will be applied when the host leaves', W / 2, H / 2 + 14);

    this._drawGold(ctx, this.game.state.gold ?? 0);
  }

  _drawShopUI(ctx, W, H) {
    this._drawTitleRow(ctx, W, H);
    this._drawShopkeeper(ctx, W, H);
    this._drawTabs(ctx, W, H);
    this._drawItems(ctx, W, H);
    this._drawInfoPanel(ctx, W, H);
    this._drawHint(ctx, W, H);

    if (this._message) {
      ctx.save();
      const ma = Math.min(1, this._message.timer * 1.5);
      ctx.globalAlpha  = ma;
      ctx.fillStyle    = this._message.color;
      ctx.shadowColor  = this._message.color;
      ctx.shadowBlur   = 14;
      ctx.font         = 'bold 16px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._message.text, W / 2, H * 0.895);
      ctx.restore();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  _drawTitleRow(ctx, W) {
    const t     = Date.now();
    const pulse = 0.88 + 0.12 * Math.sin(t / 1300);
    ctx.save();
    ctx.globalAlpha  = pulse;
    ctx.shadowColor  = 'rgba(255,209,102,0.55)';
    ctx.shadowBlur   = 26;
    ctx.fillStyle    = '#ffd166';
    ctx.font         = 'bold 34px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('The Armory', W / 2, 18);
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.fillText('Spend your gold wisely', W / 2, 60);
    ctx.restore();

    this._drawGold(ctx, this.game.state.gold ?? 0);
  }

  _drawShopkeeper(ctx, W, H) {
    // Compact shopkeeper in upper-right quadrant
    const cx = W * 0.82;
    const cy = H * 0.24;
    const t  = Date.now();

    // Body glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46);
    grd.addColorStop(0, 'rgba(200,140,30,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill();

    // Robe
    ctx.fillStyle = '#130900';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 14, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = '#220d00';
    ctx.beginPath(); ctx.arc(cx, cy - 17, 10, 0, Math.PI * 2); ctx.fill();
    // Eyes
    const ep = 0.65 + 0.30 * Math.sin(t / 520);
    ctx.save();
    ctx.globalAlpha = ep;
    ctx.fillStyle   = '#ffd166';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur  = 8;
    ctx.beginPath(); ctx.arc(cx - 3.5, cy - 18, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 3.5, cy - 18, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Floating orb
    const orbY = cy - 4 + Math.sin(t / 800) * 5;
    const og   = ctx.createRadialGradient(cx + 20, orbY, 0, cx + 20, orbY, 8);
    og.addColorStop(0, 'rgba(255,220,100,0.85)');
    og.addColorStop(1, 'rgba(200,120,0,0)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx + 20, orbY, 8, 0, Math.PI * 2); ctx.fill();
  }

  _drawTabs(ctx, W, H) {
    const tabY  = H * 0.45;
    const tabH  = 24;
    const tabs  = CATEGORIES;
    const n     = tabs.length;
    const tabW  = 100;
    const gap   = 8;
    const totalW = n * tabW + (n - 1) * gap;
    const startX = (W - totalW) / 2;
    const t      = Date.now();

    for (let i = 0; i < n; i++) {
      const tx   = startX + i * (tabW + gap);
      const sel  = i === this._tabIdx;
      const a    = sel ? 1 : 0.55;
      ctx.save();
      ctx.globalAlpha  = a;
      ctx.fillStyle    = sel ? 'rgba(75,52,8,0.90)' : 'rgba(18,14,6,0.70)';
      ctx.strokeStyle  = sel ? 'rgba(255,209,102,0.90)' : 'rgba(90,72,32,0.35)';
      ctx.lineWidth    = sel ? 1.5 : 1;
      ctx.beginPath(); ctx.roundRect(tx, tabY, tabW, tabH, 5); ctx.fill(); ctx.stroke();
      if (sel) {
        ctx.globalAlpha = 0.12 + 0.05 * Math.sin(t / 300);
        ctx.fillStyle   = 'rgba(255,209,102,1)';
        ctx.beginPath(); ctx.roundRect(tx, tabY, tabW, tabH, 5); ctx.fill();
      }
      ctx.globalAlpha  = a;
      ctx.fillStyle    = sel ? '#ffd166' : '#aa9040';
      ctx.font         = sel ? 'bold 11px "Trebuchet MS", sans-serif' : '11px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tabs[i].label, tx + tabW / 2, tabY + tabH / 2);
      ctx.restore();
    }

    // Hint for tab navigation
    ctx.fillStyle    = 'rgba(255,255,255,0.18)';
    ctx.font         = '10px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('[ Tab ] to switch', W - 16, tabY + tabH / 2);
  }

  _drawItems(ctx, W, H) {
    const items   = this._filteredItems();
    const upg     = this.game.state.upgrades ?? defaultUpgrades();
    const gold    = this.game.state.gold ?? 0;
    const VISIBLE = 4;
    const cardW   = 165, cardH = 148, gap = 10;
    const totalW  = VISIBLE * cardW + (VISIBLE - 1) * gap;
    const startX  = (W - totalW) / 2;
    const cardY   = H * 0.49;
    const t       = Date.now();

    if (items.length === 0) {
      ctx.fillStyle    = 'rgba(255,255,255,0.25)';
      ctx.font         = '13px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No items available for your class.', W / 2, cardY + cardH / 2);
      return;
    }

    // Prev / Next arrows
    if (this._viewOff > 0) {
      this._drawScrollArrow(ctx, startX - 22, cardY + cardH / 2, 'left');
    }
    if (this._viewOff + VISIBLE < items.length) {
      this._drawScrollArrow(ctx, startX + totalW + 22, cardY + cardH / 2, 'right');
    }

    // Draw up to VISIBLE cards from offset
    for (let vi = 0; vi < VISIBLE; vi++) {
      const idx  = this._viewOff + vi;
      if (idx >= items.length) break;
      const item = items[idx];
      const cx   = startX + vi * (cardW + gap);
      const sel  = idx === this._selected;
      const tier     = _getTier(upg, item.id);
      const bought   = (item.id === 'flask' && upg.flaskBought);
      const maxed    = tier >= item.tiers || bought;
      const cost     = maxed ? 0 : item.costs[tier];
      const canAfford = !maxed && gold >= cost;
      const pulse    = sel ? (0.88 + 0.12 * Math.sin(t / 270)) : 0.60;

      // Card bg
      ctx.save();
      ctx.globalAlpha  = pulse;
      ctx.fillStyle    = sel  ? 'rgba(75,52,8,0.88)'  : 'rgba(18,14,6,0.78)';
      ctx.strokeStyle  = sel  ? 'rgba(255,209,102,0.88)'
                       : maxed        ? 'rgba(140,243,255,0.40)'
                       : canAfford    ? 'rgba(255,200,80,0.30)'
                       :                'rgba(90,72,32,0.25)';
      ctx.lineWidth    = sel ? 2 : 1.2;
      ctx.beginPath(); ctx.roundRect(cx, cardY, cardW, cardH, 8); ctx.fill(); ctx.stroke();
      if (sel) {
        ctx.globalAlpha = 0.12 + 0.05 * Math.sin(t / 270);
        ctx.fillStyle   = 'rgba(255,209,102,1)';
        ctx.beginPath(); ctx.roundRect(cx, cardY, cardW, cardH, 8); ctx.fill();
      }
      ctx.restore();

      // Class badge (top-right corner)
      if (item.classId) {
        const badgeColor = item.classId === 'sword' ? '#8cf3ff'
          : item.classId === 'rogue' ? '#c77dff' : '#ffb347';
        ctx.save();
        ctx.globalAlpha  = sel ? 0.9 : 0.6;
        ctx.fillStyle    = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.roundRect(cx + cardW - 48, cardY + 4, 44, 14, 3); ctx.fill();
        ctx.fillStyle    = badgeColor;
        ctx.font         = 'bold 9px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.classId.toUpperCase(), cx + cardW - 26, cardY + 11);
        ctx.restore();
      }

      // Icon
      this._drawItemIcon(ctx, item.icon, cx + cardW / 2, cardY + 36, sel, t, item.classId);

      // Name
      ctx.fillStyle    = sel ? '#ffd166' : '#c8a846';
      ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(item.name, cx + cardW / 2, cardY + 66);

      // Tier pips (for multi-tier items)
      if (item.tiers > 1) {
        const pipR = 3, pipGap = 10;
        const pw   = item.tiers * pipR * 2 + (item.tiers - 1) * (pipGap - pipR * 2);
        let pipX   = cx + cardW / 2 - pw / 2 + pipR;
        const pipY = cardY + 84;
        for (let p2 = 0; p2 < item.tiers; p2++) {
          const filled = p2 < tier;
          ctx.fillStyle   = filled ? '#ffd166' : 'rgba(90,70,20,0.45)';
          ctx.strokeStyle = filled ? 'rgba(255,220,100,0.65)' : 'rgba(80,60,16,0.35)';
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.arc(pipX, pipY, pipR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          pipX += pipGap;
        }
      }

      // Cost / status
      const costY = cardY + cardH - 22;
      if (maxed) {
        ctx.fillStyle    = '#8cf3ff';
        ctx.font         = 'bold 11px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓  MAX', cx + cardW / 2, costY);
      } else {
        ctx.fillStyle    = canAfford ? '#ffd166' : 'rgba(180,130,40,0.40)';
        ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`◈  ${cost}`, cx + cardW / 2, costY);
      }
    }
  }

  _drawScrollArrow(ctx, x, y, dir) {
    ctx.save();
    ctx.globalAlpha  = 0.55;
    ctx.fillStyle    = '#ffd166';
    ctx.font         = 'bold 18px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dir === 'left' ? '‹' : '›', x, y);
    ctx.restore();
  }

  _drawInfoPanel(ctx, W, H) {
    const items = this._filteredItems();
    if (items.length === 0) return;
    const item  = items[this._selected];
    if (!item) return;

    const panelY = H * 0.76;
    const panelH = 70;
    const panelW = W * 0.70;
    const panelX = (W - panelW) / 2;

    // Panel background
    ctx.save();
    ctx.fillStyle    = 'rgba(18,14,6,0.72)';
    ctx.strokeStyle  = 'rgba(255,209,102,0.22)';
    ctx.lineWidth    = 1;
    ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 6); ctx.fill(); ctx.stroke();

    // Item name + category badge
    ctx.fillStyle    = '#ffd166';
    ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.name, panelX + 14, panelY + 10);

    // Description
    ctx.fillStyle    = 'rgba(255,255,255,0.72)';
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.fillText(item.desc, panelX + 14, panelY + 29);

    // Extra note (dimmer)
    if (item.extra) {
      ctx.fillStyle = 'rgba(200,160,80,0.52)';
      ctx.fillText(item.extra, panelX + 14, panelY + 46);
    }

    // Tier indicator (right side)
    const tier  = _getTier(this.game.state.upgrades ?? defaultUpgrades(), item.id);
    const maxed = tier >= item.tiers;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = maxed ? '#8cf3ff' : 'rgba(255,255,255,0.35)';
    ctx.font         = maxed ? 'bold 11px "Trebuchet MS", sans-serif' : '11px "Trebuchet MS", sans-serif';
    ctx.fillText(
      maxed
        ? `✓ Maxed (${item.tiers}/${item.tiers})`
        : `Tier ${tier}/${item.tiers}`,
      panelX + panelW - 14,
      panelY + 10,
    );

    ctx.restore();
  }

  _drawItemIcon(ctx, id, cx, cy, selected, t, classId) {
    const pulse = selected ? (0.85 + 0.15 * Math.sin(t / 230)) : 0.75;
    ctx.save();
    ctx.globalAlpha = pulse;
    const classColor = classId === 'sword' ? '#8cf3ff'
      : classId === 'rogue' ? '#c77dff'
      : classId === 'archer' ? '#ffb347'
      : '#ffd166';

    switch (id) {
      case 'flask': {
        ctx.strokeStyle = '#8cf3ff'; ctx.fillStyle = 'rgba(140,243,255,0.14)';
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(cx-4,cy-11); ctx.lineTo(cx-4,cy-6); ctx.moveTo(cx+4,cy-11); ctx.lineTo(cx+4,cy-6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx-4,cy-6); ctx.bezierCurveTo(cx-10,cy-3,cx-10,cy+12,cx,cy+13); ctx.bezierCurveTo(cx+10,cy+12,cx+10,cy-3,cx+4,cy-6); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (selected) { ctx.globalAlpha = pulse*0.5; ctx.fillStyle='#8cf3ff'; ctx.beginPath(); ctx.arc(cx,cy+5,5,0,Math.PI*2); ctx.fill(); }
        break;
      }
      case 'maxhp': {
        const s = 11;
        if (selected) { ctx.shadowColor='#ff4c4c'; ctx.shadowBlur=14; }
        ctx.fillStyle='#e03030'; ctx.strokeStyle='#ff7070'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(cx,cy+s*0.72); ctx.bezierCurveTo(cx-s*1.5,cy,cx-s*1.5,cy-s*0.85,cx,cy-s*0.2); ctx.bezierCurveTo(cx+s*1.5,cy-s*0.85,cx+s*1.5,cy,cx,cy+s*0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'revive': {
        ctx.strokeStyle='#7fff7f'; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#7fff7f'; ctx.shadowBlur=12; }
        // Up-arrow revival symbol
        ctx.beginPath(); ctx.moveTo(cx,cy+12); ctx.lineTo(cx,cy-6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx-7,cy); ctx.lineTo(cx,cy-10); ctx.lineTo(cx+7,cy); ctx.stroke();
        ctx.strokeStyle='rgba(127,255,127,0.35)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.arc(cx,cy,13,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'speed': {
        ctx.strokeStyle='#ffe066'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#ffe066'; ctx.shadowBlur=14; }
        ctx.beginPath(); ctx.moveTo(cx+5,cy-15); ctx.lineTo(cx-3,cy); ctx.lineTo(cx+3,cy); ctx.lineTo(cx-5,cy+15); ctx.stroke();
        break;
      }
      case 'atkspd': {
        ctx.strokeStyle='#ff9944'; ctx.lineWidth=2.5; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#ff9944'; ctx.shadowBlur=12; }
        const ds = (angle) => { ctx.save(); ctx.translate(cx,cy); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(-12,0); ctx.lineTo(10,0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10,-3); ctx.lineTo(13,0); ctx.lineTo(10,3); ctx.stroke(); ctx.restore(); };
        ds(-0.45); ds(0.45);
        ctx.globalAlpha *= 0.4; ctx.strokeStyle='#ffcc44'; ctx.lineWidth=1;
        for (let i=0;i<3;i++) { ctx.beginPath(); ctx.moveTo(cx-18,cy-7+i*7); ctx.lineTo(cx-10,cy-7+i*7); ctx.stroke(); }
        break;
      }
      case 'momentum': {
        ctx.strokeStyle='#aaffaa'; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#aaffaa'; ctx.shadowBlur=12; }
        // Concentric speed circles
        for (let i=0;i<3;i++) { ctx.globalAlpha=pulse*(0.3+i*0.25); ctx.beginPath(); ctx.arc(cx,cy,5+i*5,Math.PI*0.6,Math.PI*2-0.3); ctx.stroke(); }
        ctx.globalAlpha=pulse; ctx.fillStyle='#aaffaa'; ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2); ctx.fill();
        break;
      }
      case 'bleed': {
        ctx.strokeStyle='#ff5555'; ctx.fillStyle='rgba(255,60,60,0.25)'; ctx.lineWidth=1.5;
        if (selected) { ctx.shadowColor='#ff5555'; ctx.shadowBlur=12; }
        // Droplet shape
        ctx.beginPath(); ctx.arc(cx,cy+4,8,0,Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx,cy-12); ctx.lineTo(cx-6,cy+1); ctx.lineTo(cx+6,cy+1); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.globalAlpha*=0.6; ctx.strokeStyle='#ffaaaa'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(cx-3,cy+1); ctx.lineTo(cx-1,cy+6); ctx.stroke();
        break;
      }
      case 'bounty': {
        ctx.strokeStyle='#ffd166'; ctx.lineWidth=2;
        if (selected) { ctx.shadowColor='#ffd166'; ctx.shadowBlur=14; }
        // Diamond / gem shape
        ctx.beginPath(); ctx.moveTo(cx,cy-13); ctx.lineTo(cx+9,cy-3); ctx.lineTo(cx+9,cy+5); ctx.lineTo(cx,cy+13); ctx.lineTo(cx-9,cy+5); ctx.lineTo(cx-9,cy-3); ctx.closePath();
        ctx.fillStyle='rgba(255,209,102,0.18)'; ctx.fill(); ctx.stroke();
        ctx.globalAlpha*=0.55; ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fill();
        break;
      }
      case 'salvage': {
        ctx.strokeStyle='#cc9944'; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#cc9944'; ctx.shadowBlur=10; }
        // Pickaxe-ish shape
        ctx.beginPath(); ctx.moveTo(cx-10,cy+10); ctx.lineTo(cx+6,cy-6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+6,cy-10); ctx.lineTo(cx+10,cy-6); ctx.lineTo(cx+2,cy+2); ctx.lineTo(cx-2,cy-2); ctx.closePath();
        ctx.fillStyle='rgba(204,153,68,0.28)'; ctx.fill(); ctx.stroke();
        break;
      }
      case 'wallbreak': {
        ctx.strokeStyle='#ff9944'; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor='#ff9944'; ctx.shadowBlur=12; }
        // Broken wall + explosion
        ctx.beginPath(); ctx.moveTo(cx-10,cy-8); ctx.lineTo(cx-3,cy-8); ctx.moveTo(cx+3,cy-8); ctx.lineTo(cx+10,cy-8);
        ctx.moveTo(cx-10,cy); ctx.lineTo(cx-5,cy); ctx.moveTo(cx+5,cy); ctx.lineTo(cx+10,cy); ctx.stroke();
        ctx.strokeStyle='#ffdd44'; ctx.lineWidth=1.5;
        for (let a=0;a<6;a++) { const ra=(a/6)*Math.PI*2; ctx.beginPath(); ctx.moveTo(cx+Math.cos(ra)*3,cy+Math.sin(ra)*3); ctx.lineTo(cx+Math.cos(ra)*11,cy+Math.sin(ra)*11); ctx.stroke(); }
        break;
      }
      case 'glass': {
        ctx.strokeStyle='#ff4444'; ctx.lineWidth=2;
        if (selected) { ctx.shadowColor='#ff4444'; ctx.shadowBlur=12; }
        // Broken shield / glass
        ctx.beginPath(); ctx.moveTo(cx,cy-13); ctx.lineTo(cx+10,cy-8); ctx.lineTo(cx+10,cy+4); ctx.lineTo(cx,cy+13); ctx.lineTo(cx-10,cy+4); ctx.lineTo(cx-10,cy-8); ctx.closePath();
        ctx.fillStyle='rgba(255,60,60,0.12)'; ctx.fill(); ctx.stroke();
        ctx.strokeStyle='#ffaaaa'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(cx,cy-13); ctx.lineTo(cx-4,cy-2); ctx.lineTo(cx+6,cy+4); ctx.lineTo(cx,cy+13); ctx.stroke();
        break;
      }
      case 'overcharge': {
        ctx.strokeStyle=classColor; ctx.lineWidth=2.5; ctx.lineCap='round';
        if (selected) { ctx.shadowColor=classColor; ctx.shadowBlur=14; }
        // Charged sword
        ctx.beginPath(); ctx.moveTo(cx-2,cy+14); ctx.lineTo(cx+2,cy-14); ctx.stroke();
        ctx.strokeStyle='rgba(140,243,255,0.5)'; ctx.lineWidth=7;
        ctx.beginPath(); ctx.moveTo(cx-2,cy+10); ctx.lineTo(cx+2,cy-12); ctx.stroke();
        // Spark lines
        ctx.strokeStyle=classColor; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(cx+3,cy-4); ctx.lineTo(cx+9,cy-8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx-4,cy+3); ctx.lineTo(cx-9,cy+8); ctx.stroke();
        break;
      }
      case 'ricochet': {
        ctx.strokeStyle=classColor; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor=classColor; ctx.shadowBlur=12; }
        // Arrow bouncing off a wall
        ctx.beginPath(); ctx.moveTo(cx-12,cy+8); ctx.lineTo(cx+4,cy-6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+4,cy-6); ctx.lineTo(cx+12,cy+4); ctx.stroke();
        // Wall line
        ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(cx+2,cy-10); ctx.lineTo(cx+8,cy-10); ctx.stroke();
        // Arrow tip
        ctx.strokeStyle=classColor; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(cx+12,cy+4); ctx.lineTo(cx+8,cy+2); ctx.lineTo(cx+10,cy+8); ctx.stroke();
        break;
      }
      case 'shadow': {
        ctx.strokeStyle=classColor; ctx.lineWidth=2; ctx.lineCap='round';
        if (selected) { ctx.shadowColor=classColor; ctx.shadowBlur=12; }
        // Multi-target dash: 3 ghost shapes
        for (let i=0;i<3;i++) {
          const ox = (i-1)*7, oy = i*4-4;
          ctx.globalAlpha=pulse*(0.35+i*0.25);
          ctx.beginPath(); ctx.arc(cx+ox,cy+oy,4,0,Math.PI*2); ctx.stroke();
        }
        ctx.globalAlpha=pulse; ctx.fillStyle=classColor;
        ctx.beginPath(); ctx.arc(cx-9,cy-8,4,0,Math.PI*2); ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.fill();
      }
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawGold(ctx, gold) {
    const { width: W } = this.game.canvas;
    const t    = Date.now();
    const pulse = 0.88 + 0.12 * Math.sin(t / 650);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font        = 'bold 14px "Trebuchet MS", sans-serif';
    const text = `◈  ${gold}  gold`;
    const tw   = ctx.measureText(text).width;
    const px   = W - tw - 30;
    const py   = 16;
    ctx.fillStyle   = 'rgba(8,6,2,0.80)';
    ctx.strokeStyle = 'rgba(255,209,102,0.38)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.roundRect(px - 8, py - 2, tw + 16, 24, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle    = '#ffd166';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, px, py);
    ctx.restore();
  }

  _drawHint(ctx, W, H) {
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.font         = '11px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      '← / →  select    Space / Enter  buy    Tab  switch tab    Esc / E  leave',
      W / 2, H - 8,
    );
  }
}
