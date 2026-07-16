/* =========================================================
 * タワーディフェンス メインロジック
 * アイソメトリック(クォータービュー)描画。
 * 画像アセットが登録されていればそれを使い、なければ
 * コード描画(擬似3D)でフォールバックする。
 * ========================================================= */

(() => {
  "use strict";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  const TW = CONFIG.TILE_W;
  const TH = CONFIG.TILE_H;
  const COLS = CONFIG.GRID_COLS;
  const ROWS = CONFIG.GRID_ROWS;

  /* ---------- 座標変換 ---------- */
  let originX = 0;
  let originY = 0;

  function gridToScreen(gx, gy) {
    return {
      x: (gx - gy) * (TW / 2) + originX,
      y: (gx + gy) * (TH / 2) + originY,
    };
  }

  function screenToGrid(sx, sy) {
    const dx = sx - originX;
    const dy = sy - originY;
    return {
      gx: (dx / (TW / 2) + dy / (TH / 2)) / 2,
      gy: (dy / (TH / 2) - dx / (TW / 2)) / 2,
    };
  }

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    // グリッド中心を画面中央(少し上寄り)に配置
    const cx = (COLS - 1) / 2;
    const cy = (ROWS - 1) / 2;
    originX = window.innerWidth / 2 - (cx - cy) * (TW / 2);
    originY = window.innerHeight / 2 - (cx + cy) * (TH / 2) - 10;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---------- 経路 ---------- */
  const pathCells = new Set();
  (function buildPathCells() {
    for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
      const a = PATH_WAYPOINTS[i];
      const b = PATH_WAYPOINTS[i + 1];
      const steps = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      for (let s = 0; s <= steps; s++) {
        const x = a.x + Math.sign(b.x - a.x) * Math.min(s, Math.abs(b.x - a.x));
        const y = a.y + Math.sign(b.y - a.y) * Math.min(s, Math.abs(b.y - a.y));
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) pathCells.add(`${x},${y}`);
      }
    }
  })();

  const segLengths = [];
  let totalPathLen = 0;
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const a = PATH_WAYPOINTS[i];
    const b = PATH_WAYPOINTS[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLengths.push(len);
    totalPathLen += len;
  }

  /** 経路の始点からの距離 dist に対応するグリッド座標を返す */
  function pathPos(dist) {
    let d = dist;
    for (let i = 0; i < segLengths.length; i++) {
      if (d <= segLengths[i]) {
        const a = PATH_WAYPOINTS[i];
        const b = PATH_WAYPOINTS[i + 1];
        const t = segLengths[i] === 0 ? 0 : d / segLengths[i];
        return { gx: a.x + (b.x - a.x) * t, gy: a.y + (b.y - a.y) * t };
      }
      d -= segLengths[i];
    }
    const last = PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1];
    return { gx: last.x, gy: last.y };
  }

  /* ---------- ゲーム状態 ---------- */
  const state = {
    money: CONFIG.START_MONEY,
    lives: CONFIG.START_LIVES,
    wave: 0,
    waveActive: false,
    spawnQueue: [],
    spawnTimer: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    particles: [],
    floatTexts: [],
    towerGrid: new Map(), // "c,r" -> tower
    buildType: null,      // 建設モード中のタワー種別
    selectedTower: null,
    hoverCell: null,
    speed: 1,
    paused: false,
    over: false,
  };

  /* ---------- エンティティ ---------- */
  class Enemy {
    constructor(type, wave) {
      this.type = type;
      const def = ENEMY_TYPES[type];
      this.def = def;
      this.maxHp = Math.round(def.hp * enemyHpScale(wave));
      this.hp = this.maxHp;
      this.speed = def.speed;
      this.bounty = Math.round(def.bounty * enemyBountyScale(wave));
      this.dist = 0;
      this.slowTimer = 0;
      this.slowFactor = 1;
      this.dead = false;
      this.wobble = Math.random() * Math.PI * 2;
      const p = pathPos(0);
      this.gx = p.gx;
      this.gy = p.gy;
    }

    update(dt) {
      if (this.slowTimer > 0) {
        this.slowTimer -= dt;
        if (this.slowTimer <= 0) this.slowFactor = 1;
      }
      this.dist += this.speed * this.slowFactor * dt;
      this.wobble += dt * 6;
      const p = pathPos(this.dist);
      this.gx = p.gx;
      this.gy = p.gy;
      if (this.dist >= totalPathLen) {
        this.dead = true;
        state.lives -= this.type === "boss" ? 5 : 1;
        addFloatText(this.gx, this.gy, "-LIFE", "#ff5252");
        if (state.lives <= 0) gameOver(false);
      }
    }

    hit(damage, slow) {
      if (this.dead) return;
      this.hp -= damage;
      if (slow) {
        this.slowFactor = Math.min(this.slowFactor, slow.factor);
        this.slowTimer = Math.max(this.slowTimer, slow.duration);
      }
      if (this.hp <= 0) {
        this.dead = true;
        state.money += this.bounty;
        addFloatText(this.gx, this.gy, `+$${this.bounty}`, "#ffd54f");
        addBurst(this.gx, this.gy, this.def.color);
      }
    }
  }

  class Tower {
    constructor(type, c, r) {
      this.type = type;
      this.def = TOWER_TYPES[type];
      this.c = c;
      this.r = r;
      this.level = 1;
      this.cooldown = 0;
      this.invested = this.def.levels[0].cost;
      this.recoil = 0;
    }

    get stats() {
      return this.def.levels[this.level - 1];
    }

    get upgradeCost() {
      return this.level < this.def.levels.length ? this.def.levels[this.level].cost : null;
    }

    update(dt) {
      this.cooldown -= dt;
      this.recoil = Math.max(0, this.recoil - dt * 4);
      if (this.cooldown > 0) return;

      const s = this.stats;
      let best = null;
      let bestDist = -1;
      for (const e of state.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.gx - this.c, e.gy - this.r);
        if (d <= s.range && e.dist > bestDist) {
          best = e;
          bestDist = e.dist;
        }
      }
      if (!best) return;

      this.cooldown = 1 / s.rate;
      this.recoil = 1;
      state.projectiles.push(new Projectile(this, best));
    }
  }

  class Projectile {
    constructor(tower, target) {
      this.tower = tower;
      this.def = tower.def.projectile;
      this.stats = tower.stats;
      this.type = tower.type;
      this.target = target;
      this.gx = tower.c;
      this.gy = tower.r;
      this.tx = target.gx;
      this.ty = target.gy;
      this.dead = false;
      this.height = 26 + tower.level * 6; // 発射高さ(px)
    }

    update(dt) {
      if (!this.target.dead) {
        this.tx = this.target.gx;
        this.ty = this.target.gy;
      }
      const dx = this.tx - this.gx;
      const dy = this.ty - this.gy;
      const d = Math.hypot(dx, dy);
      const step = this.def.speed * dt;
      this.height = Math.max(6, this.height - dt * 40);
      if (d <= step || d < 0.12) {
        this.impact();
        return;
      }
      this.gx += (dx / d) * step;
      this.gy += (dy / d) * step;
    }

    impact() {
      this.dead = true;
      const s = this.stats;
      if (s.splash) {
        addBurst(this.tx, this.ty, this.def.color, s.splash);
        for (const e of state.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.gx - this.tx, e.gy - this.ty) <= s.splash) {
            e.hit(s.damage, s.slow);
          }
        }
      } else {
        if (!this.target.dead) this.target.hit(s.damage, s.slow);
        addBurst(this.tx, this.ty, this.def.color, 0.25);
      }
    }
  }

  /* ---------- エフェクト ---------- */
  function addBurst(gx, gy, color, radius = 0.5) {
    state.particles.push({ gx, gy, color, radius, t: 0, dur: 0.35 });
  }

  function addFloatText(gx, gy, text, color) {
    state.floatTexts.push({ gx, gy, text, color, t: 0, dur: 1.0 });
  }

  /* ---------- Wave管理 ---------- */
  function startWave() {
    if (state.waveActive || state.over) return;
    state.wave++;
    state.waveActive = true;
    state.spawnQueue = buildWave(state.wave);
    state.spawnTimer = 0.5;
    updateHUD();
  }

  function updateWave(dt) {
    if (!state.waveActive) return;

    if (state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        const next = state.spawnQueue.shift();
        state.enemies.push(new Enemy(next.type, state.wave));
        state.spawnTimer = next.delay;
      }
    } else if (state.enemies.length === 0) {
      // Wave終了
      state.waveActive = false;
      const bonus = 30 + state.wave * 4;
      state.money += bonus;
      addFloatText(COLS / 2, ROWS / 2, `Wave ${state.wave} クリア! +$${bonus}`, "#aed581");
      if (state.wave >= CONFIG.TOTAL_WAVES) gameOver(true);
    }
  }

  /* ---------- 建設・強化・売却 ---------- */
  function cellKey(c, r) {
    return `${c},${r}`;
  }

  function isBuildable(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    if (pathCells.has(cellKey(c, r))) return false;
    if (state.towerGrid.has(cellKey(c, r))) return false;
    return true;
  }

  function tryBuild(c, r) {
    const type = state.buildType;
    if (!type || !isBuildable(c, r)) return;
    const cost = TOWER_TYPES[type].levels[0].cost;
    if (state.money < cost) return;
    state.money -= cost;
    const tower = new Tower(type, c, r);
    state.towers.push(tower);
    state.towerGrid.set(cellKey(c, r), tower);
    addBurst(c, r, TOWER_TYPES[type].color, 0.6);
  }

  function upgradeTower(tower) {
    const cost = tower.upgradeCost;
    if (cost == null || state.money < cost) return;
    state.money -= cost;
    tower.level++;
    tower.invested += cost;
    addBurst(tower.c, tower.r, "#ffd54f", 0.6);
  }

  function sellTower(tower) {
    const refund = Math.floor(tower.invested * CONFIG.SELL_RATIO);
    state.money += refund;
    state.towers = state.towers.filter((t) => t !== tower);
    state.towerGrid.delete(cellKey(tower.c, tower.r));
    if (state.selectedTower === tower) state.selectedTower = null;
    addFloatText(tower.c, tower.r, `+$${refund}`, "#ffd54f");
  }

  /* ---------- 入力 ---------- */
  let mouseX = 0;
  let mouseY = 0;

  canvas.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const g = screenToGrid(mouseX, mouseY);
    const c = Math.round(g.gx);
    const r = Math.round(g.gy);
    state.hoverCell = c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null;
  });

  canvas.addEventListener("click", () => {
    if (state.over) return;
    const cell = state.hoverCell;
    if (!cell) {
      selectTower(null);
      return;
    }
    const existing = state.towerGrid.get(cellKey(cell.c, cell.r));
    if (state.buildType) {
      if (existing) {
        selectTower(existing);
        setBuildType(null);
      } else {
        tryBuild(cell.c, cell.r);
      }
    } else {
      selectTower(existing || null);
    }
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setBuildType(null);
    selectTower(null);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setBuildType(null);
      selectTower(null);
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!state.waveActive) startWave();
    }
    if (e.key === "1") setBuildType("arrow");
    if (e.key === "2") setBuildType("cannon");
    if (e.key === "3") setBuildType("ice");
    if (e.key === "4") setBuildType("sniper");
  });

  /* ---------- UI ---------- */
  const ui = {
    money: document.getElementById("money"),
    lives: document.getElementById("lives"),
    wave: document.getElementById("wave"),
    btnWave: document.getElementById("btn-wave"),
    btnSpeed: document.getElementById("btn-speed"),
    btnPause: document.getElementById("btn-pause"),
    towerPanel: document.getElementById("tower-panel"),
    towerPanelTitle: document.getElementById("tower-panel-title"),
    towerPanelStats: document.getElementById("tower-panel-stats"),
    btnUpgrade: document.getElementById("btn-upgrade"),
    upgradeCost: document.getElementById("upgrade-cost"),
    btnSell: document.getElementById("btn-sell"),
    sellValue: document.getElementById("sell-value"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlayText: document.getElementById("overlay-text"),
    btnRestart: document.getElementById("btn-restart"),
    buildCards: [...document.querySelectorAll(".build-card")],
  };

  function setBuildType(type) {
    state.buildType = state.buildType === type ? null : type;
    if (state.buildType) selectTower(null);
    for (const card of ui.buildCards) {
      card.classList.toggle("selected", card.dataset.tower === state.buildType);
    }
  }

  function selectTower(tower) {
    state.selectedTower = tower;
    ui.towerPanel.classList.toggle("hidden", !tower);
  }

  for (const card of ui.buildCards) {
    card.addEventListener("click", () => setBuildType(card.dataset.tower));
  }

  ui.btnWave.addEventListener("click", startWave);

  ui.btnSpeed.addEventListener("click", () => {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
    ui.btnSpeed.textContent = `▶ x${state.speed}`;
  });

  ui.btnPause.addEventListener("click", () => {
    state.paused = !state.paused;
    ui.btnPause.textContent = state.paused ? "▶" : "⏸";
  });

  ui.btnUpgrade.addEventListener("click", () => {
    if (state.selectedTower) upgradeTower(state.selectedTower);
  });

  ui.btnSell.addEventListener("click", () => {
    if (state.selectedTower) sellTower(state.selectedTower);
  });

  ui.btnRestart.addEventListener("click", () => location.reload());

  function updateHUD() {
    ui.money.textContent = state.money;
    ui.lives.textContent = Math.max(0, state.lives);
    ui.wave.textContent = `${state.wave}/${CONFIG.TOTAL_WAVES}`;
    ui.btnWave.disabled = state.waveActive || state.over;
    ui.btnWave.textContent = state.waveActive ? "Wave 進行中…" : `Wave ${state.wave + 1} 開始`;

    for (const card of ui.buildCards) {
      const cost = TOWER_TYPES[card.dataset.tower].levels[0].cost;
      card.classList.toggle("disabled", state.money < cost);
    }

    const t = state.selectedTower;
    if (t) {
      const s = t.stats;
      ui.towerPanelTitle.textContent = `${t.def.name} Lv.${t.level}`;
      let lines = `ダメージ: ${s.damage}\n射程: ${s.range}\n連射: ${s.rate}/秒`;
      if (s.splash) lines += `\n爆風範囲: ${s.splash}`;
      if (s.slow) lines += `\n減速: ${Math.round((1 - s.slow.factor) * 100)}% / ${s.slow.duration}秒`;
      ui.towerPanelStats.textContent = lines;

      const uc = t.upgradeCost;
      if (uc == null) {
        ui.btnUpgrade.disabled = true;
        ui.upgradeCost.textContent = "(最大)";
      } else {
        ui.btnUpgrade.disabled = state.money < uc;
        ui.upgradeCost.textContent = `$${uc}`;
      }
      ui.sellValue.textContent = `$${Math.floor(t.invested * CONFIG.SELL_RATIO)}`;
    }
  }

  function gameOver(victory) {
    if (state.over) return;
    state.over = true;
    ui.overlay.classList.remove("hidden");
    ui.overlayTitle.textContent = victory ? "🎉 クリア!" : "💀 ゲームオーバー";
    ui.overlayText.textContent = victory
      ? `全${CONFIG.TOTAL_WAVES} Waveを防衛しました!`
      : `Wave ${state.wave} で防衛線が突破されました…`;
  }

  /* =========================================================
   * 描画
   * ========================================================= */

  function drawDiamond(x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x, y + h / 2);
    ctx.lineTo(x - w / 2, y);
    ctx.closePath();
  }

  function drawBackground() {
    if (Assets.has("bg")) {
      const img = Assets.get("bg");
      ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
    g.addColorStop(0, "#232b45");
    g.addColorStop(1, "#131826");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  const EDGE_DEPTH = 20; // 島の側面の厚み(px)

  function drawTiles() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y } = gridToScreen(c, r);
        const isPath = pathCells.has(cellKey(c, r));

        // 側面(グリッド端のみ)→ 浮島っぽい擬似3D
        if (r === ROWS - 1) {
          ctx.beginPath();
          ctx.moveTo(x - TW / 2, y);
          ctx.lineTo(x, y + TH / 2);
          ctx.lineTo(x, y + TH / 2 + EDGE_DEPTH);
          ctx.lineTo(x - TW / 2, y + EDGE_DEPTH);
          ctx.closePath();
          ctx.fillStyle = "#2c3352";
          ctx.fill();
        }
        if (c === COLS - 1) {
          ctx.beginPath();
          ctx.moveTo(x + TW / 2, y);
          ctx.lineTo(x, y + TH / 2);
          ctx.lineTo(x, y + TH / 2 + EDGE_DEPTH);
          ctx.lineTo(x + TW / 2, y + EDGE_DEPTH);
          ctx.closePath();
          ctx.fillStyle = "#222842";
          ctx.fill();
        }

        // タイル上面(画像があれば差し替え)
        const key = isPath ? "tile_path" : "tile_ground";
        if (!Assets.drawTile(ctx, key, x, y, TW, TH)) {
          drawDiamond(x, y, TW, TH);
          if (isPath) {
            ctx.fillStyle = (c + r) % 2 === 0 ? "#b89a6a" : "#af9160";
          } else {
            ctx.fillStyle = (c + r) % 2 === 0 ? "#4a7a4e" : "#437146";
          }
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.18)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // 入口/出口マーカー
    const start = gridToScreen(PATH_WAYPOINTS[0].x + 1, PATH_WAYPOINTS[0].y);
    const end = gridToScreen(
      PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1].x - 1,
      PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1].y
    );
    ctx.font = "700 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("IN →", start.x - TW * 0.7, start.y - 8);
    ctx.fillText("→ OUT", end.x + TW * 0.7, end.y - 8);
  }

  function drawHover() {
    const cell = state.hoverCell;
    if (!cell || state.over) return;
    const { x, y } = gridToScreen(cell.c, cell.r);

    if (state.buildType) {
      const ok = isBuildable(cell.c, cell.r) &&
        state.money >= TOWER_TYPES[state.buildType].levels[0].cost;
      drawDiamond(x, y, TW, TH);
      ctx.fillStyle = ok ? "rgba(120,255,140,0.3)" : "rgba(255,80,80,0.3)";
      ctx.fill();
      ctx.strokeStyle = ok ? "#7fff8f" : "#ff5050";
      ctx.lineWidth = 2;
      ctx.stroke();
      if (ok) {
        drawRange(cell.c, cell.r, TOWER_TYPES[state.buildType].levels[0].range, TOWER_TYPES[state.buildType].color);
      }
    } else {
      drawDiamond(x, y, TW, TH);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawRange(c, r, range, color) {
    const { x, y } = gridToScreen(c, r);
    const rx = range * TW / Math.SQRT2;
    const ry = range * TH / Math.SQRT2;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ---- タワー描画(フォールバック:擬似3D)---- */
  function drawTowerShape(tower, x, y) {
    const key = `tower_${tower.type}_${tower.level}`;
    if (Assets.drawSprite(ctx, key, x, y + TH * 0.18, TW * 0.9)) return;

    const color = tower.def.color;
    const lv = tower.level;
    const h = 26 + lv * 8; // 本体の高さ
    const w = TW * 0.34;
    const recoil = tower.recoil * 3;

    // 台座(菱形プレート+側面)
    drawDiamond(x, y, TW * 0.68, TH * 0.68);
    ctx.fillStyle = "#39415f";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.stroke();
    drawDiamond(x, y - 5, TW * 0.6, TH * 0.6);
    ctx.fillStyle = "#4a5478";
    ctx.fill();

    const baseY = y - 5;
    const topY = baseY - h + recoil;

    // 本体(左右面で陰影をつけた角柱)
    ctx.fillStyle = shade(color, -35);
    ctx.beginPath(); // 左面
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x, baseY + w * 0.28);
    ctx.lineTo(x, topY + w * 0.28);
    ctx.lineTo(x - w / 2, topY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shade(color, -60);
    ctx.beginPath(); // 右面
    ctx.moveTo(x + w / 2, baseY);
    ctx.lineTo(x, baseY + w * 0.28);
    ctx.lineTo(x, topY + w * 0.28);
    ctx.lineTo(x + w / 2, topY);
    ctx.closePath();
    ctx.fill();

    // 上面
    drawDiamond(x, topY + w * 0.14, w, w * 0.56);
    ctx.fillStyle = shade(color, 0);
    ctx.fill();

    // 種別ごとの飾り
    ctx.fillStyle = shade(color, 25);
    if (tower.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x, topY - 14);
      ctx.lineTo(x + 7, topY + 2);
      ctx.lineTo(x - 7, topY + 2);
      ctx.closePath();
      ctx.fill();
    } else if (tower.type === "cannon") {
      ctx.beginPath();
      ctx.arc(x, topY, 9, 0, Math.PI * 2);
      ctx.fill();
    } else if (tower.type === "ice") {
      ctx.beginPath();
      ctx.moveTo(x, topY - 16);
      ctx.lineTo(x + 6, topY - 2);
      ctx.lineTo(x, topY + 6);
      ctx.lineTo(x - 6, topY - 2);
      ctx.closePath();
      ctx.fill();
    } else if (tower.type === "sniper") {
      ctx.fillRect(x - 2, topY - 18, 4, 18);
      ctx.beginPath();
      ctx.arc(x, topY - 18, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // レベル表示(ピップ)
    ctx.fillStyle = "#ffd54f";
    for (let i = 0; i < lv; i++) {
      ctx.beginPath();
      ctx.arc(x - 8 + i * 8, y + TH * 0.42, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---- 敵描画(フォールバック:陰影付き球体)---- */
  function drawEnemyShape(e, x, y) {
    const size = TW * 0.3 * e.def.size;

    // 影
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.55, size * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();

    const key = `enemy_${e.type}`;
    if (Assets.drawSprite(ctx, key, x, y + 4, size * 2)) return;

    const bounce = Math.abs(Math.sin(e.wobble)) * 3;
    const by = y - size * 0.55 - bounce;

    const grad = ctx.createRadialGradient(
      x - size * 0.18, by - size * 0.18, size * 0.1,
      x, by, size * 0.62
    );
    grad.addColorStop(0, shade(e.def.color, 45));
    grad.addColorStop(1, shade(e.def.color, -35));
    ctx.beginPath();
    ctx.arc(x, by, size * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 凍結表現
    if (e.slowTimer > 0) {
      ctx.beginPath();
      ctx.arc(x, by, size * 0.58, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(140,220,255,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 目(進行方向っぽく右向き)
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + size * 0.16, by - size * 0.08, size * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.arc(x + size * 0.2, by - size * 0.08, size * 0.055, 0, Math.PI * 2);
    ctx.fill();

    // HPバー
    const bw = size * 1.15;
    const ratio = Math.max(0, e.hp / e.maxHp);
    const barY = by - size * 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - bw / 2, barY, bw, 5);
    ctx.fillStyle = ratio > 0.5 ? "#66bb6a" : ratio > 0.25 ? "#ffca28" : "#ef5350";
    ctx.fillRect(x - bw / 2, barY, bw * ratio, 5);
  }

  function drawProjectile(p) {
    const { x, y } = gridToScreen(p.gx, p.gy);
    const py = y - p.height;
    const key = `projectile_${p.type}`;
    if (Assets.drawSprite(ctx, key, x, py + p.def.size, p.def.size * 3)) return;

    ctx.beginPath();
    ctx.arc(x, py, p.def.size, 0, Math.PI * 2);
    ctx.fillStyle = p.def.color;
    ctx.shadowColor = p.def.color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    for (const pt of state.particles) {
      const { x, y } = gridToScreen(pt.gx, pt.gy);
      const k = pt.t / pt.dur;
      const rx = pt.radius * TW / Math.SQRT2 * (0.3 + k * 0.7);
      const ry = pt.radius * TH / Math.SQRT2 * (0.3 + k * 0.7);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = pt.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = "700 15px sans-serif";
    ctx.textAlign = "center";
    for (const ft of state.floatTexts) {
      const { x, y } = gridToScreen(ft.gx, ft.gy);
      const k = ft.t / ft.dur;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, x, y - 40 - k * 30);
      ctx.globalAlpha = 1;
    }
  }

  /** 色の明度調整ユーティリティ */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
    const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function render() {
    drawBackground();
    drawTiles();

    // 選択中タワーの射程
    if (state.selectedTower) {
      const t = state.selectedTower;
      drawRange(t.c, t.r, t.stats.range, t.def.color);
    }

    drawHover();

    // 奥行きソートしてエンティティ描画(奥→手前)
    const drawables = [];
    for (const t of state.towers) {
      drawables.push({ depth: t.c + t.r, fn: () => {
        const { x, y } = gridToScreen(t.c, t.r);
        drawTowerShape(t, x, y);
      } });
    }
    for (const e of state.enemies) {
      drawables.push({ depth: e.gx + e.gy, fn: () => {
        const { x, y } = gridToScreen(e.gx, e.gy);
        drawEnemyShape(e, x, y);
      } });
    }
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.fn();

    for (const p of state.projectiles) drawProjectile(p);
    drawParticles();

    if (state.paused && !state.over) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = "#fff";
      ctx.font = "800 36px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("一時停止中", window.innerWidth / 2, window.innerHeight / 2);
    }
  }

  /* ---------- メインループ ---------- */
  let lastTime = performance.now();

  function loop(now) {
    let dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (!state.paused && !state.over) {
      dt *= state.speed;

      updateWave(dt);
      for (const e of state.enemies) e.update(dt);
      state.enemies = state.enemies.filter((e) => !e.dead);
      for (const t of state.towers) t.update(dt);
      for (const p of state.projectiles) p.update(dt);
      state.projectiles = state.projectiles.filter((p) => !p.dead);

      for (const pt of state.particles) pt.t += dt;
      state.particles = state.particles.filter((pt) => pt.t < pt.dur);
      for (const ft of state.floatTexts) ft.t += dt;
      state.floatTexts = state.floatTexts.filter((ft) => ft.t < ft.dur);
    }

    updateHUD();
    render();
    requestAnimationFrame(loop);
  }

  Assets.loadAll(() => {
    updateHUD();
    requestAnimationFrame(loop);
  });
})();
