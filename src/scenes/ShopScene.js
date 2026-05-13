import { Scene      } from './Scene.js';
import { GameScene  } from './GameScene.js';
import { TitleScene } from './TitleScene.js';

// ── Item definitions ─────────────────────────────────────────────────────────
const ITEMS = [
  {
    id:    'flask',
    name:  'Health Flask',
    icon:  'flask',
    desc:  ['Fully restore HP', 'for all players'],
    tiers: 1,
    costs: [50],
  },
  {
    id:    'speed',
    name:  'Swiftness',
    icon:  'speed',
    desc:  ['+15% move speed', 'stacks 3×'],
    tiers: 3,
    costs: [80, 120, 160],
  },
  {
    id:    'atkspd',
    name:  'Combat Tempo',
    icon:  'atkspd',
    desc:  ['+20% attack speed', '& projectile speed  ×3'],
    tiers: 3,
    costs: [100, 150, 200],
  },
  {
    id:    'maxhp',
    name:  'Vital Core',
    icon:  'maxhp',
    desc:  ['+30 max HP', 'for all players  ×3'],
    tiers: 3,
    costs: [80, 120, 160],
  },
];

// ── Upgrade defaults ─────────────────────────────────────────────────────────
export function defaultUpgrades() {
  return {
    speedTier:       0,
    weaponSpeedTier: 0,
    maxHpTier:       0,
    flaskBought:     false,
    pendingHeal:     false,
  };
}

function _getTier(upg, id) {
  if (id === 'flask')  return upg.flaskBought ? 1 : 0;
  if (id === 'speed')  return upg.speedTier;
  if (id === 'atkspd') return upg.weaponSpeedTier;
  if (id === 'maxhp')  return upg.maxHpTier;
  return 0;
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
    this._role = g.state.netRole    ?? null;  // 'host'|'client'|null

    this._selected = 0;
    this._message  = null;  // { text, color, timer }

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

  // ── Update ───────────────────────────────────────────────────────────────────

  update(dt) {
    // Particles
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

    // Host / solo input
    const input = this.game.input;
    const n     = ITEMS.length;

    if (input.justPressed('ArrowLeft')  || input.justPressed('KeyA')) {
      this._selected = (this._selected - 1 + n) % n;
    }
    if (input.justPressed('ArrowRight') || input.justPressed('KeyD')) {
      this._selected = (this._selected + 1) % n;
    }
    if (input.justPressed('Space') || input.justPressed('Enter')) {
      this._tryBuy(this._selected);
    }
    if (input.justPressed('Escape') || input.justPressed('KeyE')) {
      this._leaveShop();
    }
  }

  // ── Buy logic ────────────────────────────────────────────────────────────────

  _tryBuy(idx) {
    const item = ITEMS[idx];
    const upg  = this.game.state.upgrades;
    const gold = this.game.state.gold;

    if (item.id === 'flask') {
      if (upg.flaskBought) { this._msg('Already bought!', '#ff9944'); return; }
      const cost = item.costs[0];
      if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
      this.game.state.gold -= cost;
      upg.flaskBought  = true;
      upg.pendingHeal  = true;
      this._msg('Health Flask purchased!', '#7fff7f');

    } else if (item.id === 'speed') {
      const tier = upg.speedTier;
      if (tier >= item.tiers) { this._msg('Max tier reached!', '#ff9944'); return; }
      const cost = item.costs[tier];
      if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
      this.game.state.gold -= cost;
      upg.speedTier++;
      this._msg(`Swiftness  Tier ${upg.speedTier}!`, '#7fff7f');

    } else if (item.id === 'atkspd') {
      const tier = upg.weaponSpeedTier;
      if (tier >= item.tiers) { this._msg('Max tier reached!', '#ff9944'); return; }
      const cost = item.costs[tier];
      if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
      this.game.state.gold -= cost;
      upg.weaponSpeedTier++;
      this._msg(`Combat Tempo  Tier ${upg.weaponSpeedTier}!`, '#7fff7f');

    } else if (item.id === 'maxhp') {
      const tier = upg.maxHpTier;
      if (tier >= item.tiers) { this._msg('Max tier reached!', '#ff9944'); return; }
      const cost = item.costs[tier];
      if (gold < cost) { this._msg('Not enough gold!', '#ff6b6b'); return; }
      this.game.state.gold -= cost;
      upg.maxHpTier++;
      this._msg(`Vital Core  Tier ${upg.maxHpTier}!`, '#7fff7f');
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

    // Notify client — include the actual next roomIndex so client transitions correctly
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
      // Spawn around counter area
      const cx = W / 2, cy = H * 0.43;
      const a  = Math.random() * Math.PI * 2;
      const r  = 60 + Math.random() * 250;
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

    // Radial warm glow from counter
    const grad = ctx.createRadialGradient(W / 2, H * 0.43, 0, W / 2, H * 0.43, W * 0.52);
    grad.addColorStop(0,   'rgba(160,110,0,0.14)');
    grad.addColorStop(0.42, 'rgba(100,50,0,0.08)');
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Secondary purple accent from top
    const grad2 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.55);
    grad2.addColorStop(0,   'rgba(90,40,140,0.10)');
    grad2.addColorStop(1,   'rgba(0,0,0,0)');
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
    const t = Date.now();
    const pulse = 0.75 + 0.25 * Math.sin(t / 700);

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle   = '#ffd166';
    ctx.font        = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center';
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
    this._drawTitle(ctx, W, H);
    this._drawCounter(ctx, W, H);
    this._drawItems(ctx, W, H);
    this._drawGold(ctx, this.game.state.gold ?? 0);
    this._drawHint(ctx, W, H);

    if (this._message) {
      ctx.save();
      const ma = Math.min(1, this._message.timer * 1.5);
      ctx.globalAlpha  = ma;
      ctx.fillStyle    = this._message.color;
      ctx.shadowColor  = this._message.color;
      ctx.shadowBlur   = 12;
      ctx.font         = 'bold 17px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._message.text, W / 2, H * 0.835);
      ctx.restore();
    }
  }

  _drawTitle(ctx, W) {
    const t     = Date.now();
    const pulse = 0.88 + 0.12 * Math.sin(t / 1300);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = 'rgba(255,209,102,0.55)';
    ctx.shadowBlur  = 26;
    ctx.fillStyle   = '#ffd166';
    ctx.font        = 'bold 36px "Trebuchet MS", sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('The Armory', W / 2, 26);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.22)';
    ctx.font        = '12px "Trebuchet MS", sans-serif';
    ctx.fillText('Spend your gold wisely, adventurer', W / 2, 72);
    ctx.restore();
  }

  _drawCounter(ctx, W, H) {
    const cx = W / 2;
    const cy = H * 0.40;
    const t  = Date.now();

    // Counter surface
    const tw = 210, th = 20;
    ctx.fillStyle   = 'rgba(70,45,8,0.55)';
    ctx.strokeStyle = 'rgba(255,209,102,0.28)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.roundRect(cx - tw / 2, cy + 30, tw, th, 4); ctx.fill(); ctx.stroke();

    // Floor runes
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const angle = (t / 3500 + i * Math.PI / 2) % (Math.PI * 2);
      const rx    = cx + Math.cos(angle) * 110;
      const ry    = cy + 52 + Math.sin(angle * 0.7) * 14;
      const ra    = 0.15 + 0.07 * Math.sin(t / 900 + i);
      ctx.globalAlpha  = ra;
      ctx.strokeStyle  = '#ffd166';
      ctx.lineWidth    = 1;
      ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(rx, ry, 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // Shopkeeper body glow
    const grd = ctx.createRadialGradient(cx, cy + 6, 0, cx, cy + 6, 56);
    grd.addColorStop(0, 'rgba(200,140,30,0.32)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy + 6, 56, 0, Math.PI * 2); ctx.fill();

    // Robe body
    ctx.fillStyle = '#130900';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 18, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#220d00';
    ctx.beginPath(); ctx.arc(cx, cy - 20, 12, 0, Math.PI * 2); ctx.fill();

    // Glowing eyes
    const eyePulse = 0.65 + 0.30 * Math.sin(t / 520);
    ctx.save();
    ctx.globalAlpha = eyePulse;
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur  = 8;
    ctx.beginPath(); ctx.arc(cx - 4.5, cy - 21, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 4.5, cy - 21, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Hood arc
    ctx.strokeStyle = 'rgba(255,180,60,0.40)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 13, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // Floating orb (held item)
    const orbY = cy - 5 + Math.sin(t / 800) * 5;
    const orbGrd = ctx.createRadialGradient(cx + 24, orbY, 0, cx + 24, orbY, 10);
    orbGrd.addColorStop(0, 'rgba(255,220,100,0.85)');
    orbGrd.addColorStop(1, 'rgba(200,120,0,0)');
    ctx.fillStyle = orbGrd;
    ctx.beginPath(); ctx.arc(cx + 24, orbY, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,100,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.arc(cx + 24, orbY, 10, 0, Math.PI * 2); ctx.stroke();
  }

  _drawItems(ctx, W, H) {
    const upg  = this.game.state.upgrades ?? defaultUpgrades();
    const gold = this.game.state.gold ?? 0;
    const n    = ITEMS.length;
    const cardW  = 168;
    const cardH  = 178;
    const gap    = 16;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = (W - totalW) / 2;
    const cardY  = H * 0.52;
    const t      = Date.now();

    for (let i = 0; i < n; i++) {
      const item      = ITEMS[i];
      const cx        = startX + i * (cardW + gap);
      const sel       = i === this._selected;
      const tier      = _getTier(upg, item.id);
      const bought    = (item.id === 'flask' && upg.flaskBought);
      const maxed     = tier >= item.tiers || bought;
      const cost      = maxed ? 0 : item.costs[tier];
      const canAfford = !maxed && gold >= cost;
      const pulse     = sel ? (0.88 + 0.12 * Math.sin(t / 270)) : 0.62;

      // Card bg
      ctx.save();
      ctx.globalAlpha  = pulse;
      ctx.fillStyle    = sel  ? 'rgba(75,52,8,0.82)'  : 'rgba(18,14,6,0.78)';
      ctx.strokeStyle  = sel  ? 'rgba(255,209,102,0.88)'
                        : maxed        ? 'rgba(140,243,255,0.38)'
                        : canAfford    ? 'rgba(255,200,80,0.32)'
                        :                'rgba(90,72,32,0.28)';
      ctx.lineWidth    = sel ? 2 : 1.5;
      ctx.beginPath(); ctx.roundRect(cx, cardY, cardW, cardH, 10); ctx.fill(); ctx.stroke();

      // Selection glow
      if (sel) {
        ctx.globalAlpha  = 0.14 + 0.06 * Math.sin(t / 270);
        ctx.fillStyle    = 'rgba(255,209,102,1)';
        ctx.beginPath(); ctx.roundRect(cx, cardY, cardW, cardH, 10); ctx.fill();
      }
      ctx.restore();

      // Icon
      this._drawItemIcon(ctx, item.id, cx + cardW / 2, cardY + 40, sel, t);

      // Name
      ctx.fillStyle    = sel ? '#ffd166' : '#ddbe60';
      ctx.font         = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(item.name, cx + cardW / 2, cardY + 78);

      // Desc lines
      ctx.fillStyle = 'rgba(255,255,255,0.46)';
      ctx.font      = '11px "Trebuchet MS", sans-serif';
      for (let d = 0; d < item.desc.length; d++) {
        ctx.fillText(item.desc[d], cx + cardW / 2, cardY + 96 + d * 14);
      }

      // Tier pips (stackable items)
      if (item.tiers > 1) {
        const pipR = 3.5, pipGap = 12;
        const pipsW = item.tiers * pipR * 2 + (item.tiers - 1) * (pipGap - pipR * 2);
        let pipX    = cx + cardW / 2 - pipsW / 2 + pipR;
        const pipY  = cardY + 128;
        for (let p2 = 0; p2 < item.tiers; p2++) {
          const filled = p2 < tier;
          ctx.fillStyle   = filled ? '#ffd166' : 'rgba(90,70,20,0.5)';
          ctx.strokeStyle = filled ? 'rgba(255,220,100,0.7)' : 'rgba(80,60,16,0.4)';
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.arc(pipX, pipY, pipR, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          pipX += pipGap;
        }
      }

      // Cost / status
      const costY = cardY + cardH - 22;
      if (maxed) {
        ctx.fillStyle    = '#8cf3ff';
        ctx.font         = 'bold 12px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓  MAX', cx + cardW / 2, costY);
      } else {
        ctx.fillStyle    = canAfford ? '#ffd166' : 'rgba(180,130,40,0.42)';
        ctx.font         = 'bold 13px "Trebuchet MS", sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`◈  ${cost}`, cx + cardW / 2, costY);
      }
    }
  }

  _drawItemIcon(ctx, id, cx, cy, selected, t) {
    const pulse = selected ? (0.82 + 0.18 * Math.sin(t / 230)) : 0.78;
    ctx.save();
    ctx.globalAlpha = pulse;

    if (id === 'flask') {
      // Potion vial
      ctx.strokeStyle = '#8cf3ff';
      ctx.fillStyle   = 'rgba(140,243,255,0.14)';
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      // Vial neck
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - 12);
      ctx.lineTo(cx - 5, cy - 7);
      ctx.moveTo(cx + 5, cy - 12);
      ctx.lineTo(cx + 5, cy - 7);
      ctx.stroke();
      // Vial body (rounded)
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - 7);
      ctx.bezierCurveTo(cx - 12, cy - 4, cx - 12, cy + 14, cx, cy + 15);
      ctx.bezierCurveTo(cx + 12, cy + 14, cx + 12, cy - 4, cx + 5, cy - 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Cork
      ctx.fillStyle = 'rgba(200,160,80,0.65)';
      ctx.fillRect(cx - 5, cy - 16, 10, 5);
      // Liquid fill
      if (selected) {
        ctx.globalAlpha = pulse * 0.55;
        ctx.fillStyle = '#8cf3ff';
        ctx.beginPath();
        ctx.arc(cx, cy + 6, 7, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (id === 'speed') {
      // Lightning bolt
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      if (selected) {
        ctx.shadowColor = '#ffe066';
        ctx.shadowBlur  = 14;
      }
      ctx.beginPath();
      ctx.moveTo(cx + 6,  cy - 17);
      ctx.lineTo(cx - 4,  cy - 1);
      ctx.lineTo(cx + 3,  cy - 1);
      ctx.lineTo(cx - 6,  cy + 17);
      ctx.stroke();

    } else if (id === 'atkspd') {
      // Two crossed speed-lines swords
      ctx.strokeStyle = '#ff9944';
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      if (selected) { ctx.shadowColor = '#ff9944'; ctx.shadowBlur = 12; }
      const drawSword = (angle) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12, -4); ctx.lineTo(15, 0); ctx.lineTo(12, 4); ctx.stroke();
        ctx.restore();
      };
      drawSword(-0.48);
      drawSword( 0.48);
      // Speed lines
      ctx.globalAlpha *= 0.45;
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth   = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 20, cy - 9 + i * 9);
        ctx.lineTo(cx - 10, cy - 9 + i * 9);
        ctx.stroke();
      }

    } else if (id === 'maxhp') {
      // Heart shape
      const s = 12;
      if (selected) { ctx.shadowColor = '#ff4c4c'; ctx.shadowBlur = 16; }
      ctx.fillStyle   = '#e03030';
      ctx.strokeStyle = '#ff7070';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.72);
      ctx.bezierCurveTo(cx - s * 1.55, cy, cx - s * 1.55, cy - s * 0.88, cx, cy - s * 0.22);
      ctx.bezierCurveTo(cx + s * 1.55, cy - s * 0.88, cx + s * 1.55, cy, cx, cy + s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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
    ctx.font        = 'bold 15px "Trebuchet MS", sans-serif';
    const text = `◈  ${gold}  gold`;
    const tw   = ctx.measureText(text).width;
    const px   = W - tw - 30;
    const py   = 14;
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
    ctx.fillStyle    = 'rgba(255,255,255,0.26)';
    ctx.font         = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('← / →  select    Space / Enter  buy    Esc / E  leave shop', W / 2, H - 11);
  }
}
