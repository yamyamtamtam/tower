/* =========================================================
 * ゲーム設定・バランスデータ
 * ========================================================= */

const CONFIG = {
  // アイソメタイルのサイズ(px)。画像を入れる場合もこの比率(2:1)推奨
  TILE_W: 88,
  TILE_H: 44,

  GRID_COLS: 12,
  GRID_ROWS: 9,

  START_MONEY: 220,
  START_LIVES: 20,
  SELL_RATIO: 0.7, // 売却時の返金率(投資額に対する割合)

  TOTAL_WAVES: 30, // これを超えるとクリア
};

/* 敵の進行ルート(グリッド座標の折れ点)。範囲外の始点/終点で画面外から出入りする */
const PATH_WAYPOINTS = [
  { x: -1, y: 4 },
  { x: 2, y: 4 },
  { x: 2, y: 1 },
  { x: 6, y: 1 },
  { x: 6, y: 6 },
  { x: 9, y: 6 },
  { x: 9, y: 3 },
  { x: 12, y: 3 },
];

/* ---------- タワー定義 ----------
 * levels[i] がレベル i+1 の性能。cost はそのレベルにするための追加費用。
 * range: 射程(グリッド単位) / damage: ダメージ / rate: 秒間発射数
 * splash: 爆風半径(グリッド単位) / slow: {factor, duration} 減速効果
 */
const TOWER_TYPES = {
  arrow: {
    name: "アロータワー",
    color: "#4fc3f7",
    projectile: { speed: 11, color: "#b3e5fc", size: 4 },
    levels: [
      { cost: 50, range: 2.6, damage: 12, rate: 2.4 },
      { cost: 60, range: 2.9, damage: 22, rate: 2.8 },
      { cost: 120, range: 3.2, damage: 40, rate: 3.3 },
    ],
  },
  cannon: {
    name: "キャノンタワー",
    color: "#ff8a65",
    projectile: { speed: 7, color: "#ffab91", size: 7 },
    levels: [
      { cost: 100, range: 2.3, damage: 32, rate: 0.8, splash: 1.1 },
      { cost: 90, range: 2.5, damage: 58, rate: 0.85, splash: 1.25 },
      { cost: 180, range: 2.8, damage: 100, rate: 0.9, splash: 1.45 },
    ],
  },
  ice: {
    name: "アイスタワー",
    color: "#81d4fa",
    projectile: { speed: 9, color: "#e1f5fe", size: 5 },
    levels: [
      { cost: 75, range: 2.4, damage: 6, rate: 1.2, slow: { factor: 0.6, duration: 2.0 } },
      { cost: 80, range: 2.7, damage: 11, rate: 1.3, slow: { factor: 0.5, duration: 2.2 } },
      { cost: 160, range: 3.0, damage: 18, rate: 1.4, slow: { factor: 0.4, duration: 2.6 } },
    ],
  },
  sniper: {
    name: "スナイパータワー",
    color: "#ba68c8",
    projectile: { speed: 18, color: "#e1bee7", size: 4 },
    levels: [
      { cost: 120, range: 4.6, damage: 70, rate: 0.5 },
      { cost: 140, range: 5.2, damage: 135, rate: 0.55 },
      { cost: 260, range: 5.8, damage: 250, rate: 0.6 },
    ],
  },
};

/* ---------- 敵定義 ----------
 * hp: 基本HP / speed: 移動速度(グリッド/秒) / bounty: 撃破報酬 / size: 描画サイズ係数
 */
const ENEMY_TYPES = {
  normal: { name: "ノーマル", hp: 42, speed: 1.5, bounty: 8, size: 1.0, color: "#ef5350" },
  fast:   { name: "ファスト", hp: 26, speed: 2.6, bounty: 9, size: 0.85, color: "#ffca28" },
  tank:   { name: "タンク",   hp: 150, speed: 0.95, bounty: 18, size: 1.25, color: "#8d6e63" },
  boss:   { name: "ボス",     hp: 950, speed: 0.75, bounty: 130, size: 1.7, color: "#7e57c2" },
};

/* ---------- Wave生成 ----------
 * wave番号(1始まり)から出現リストを作る。
 * 返り値: [{type, delay}] delayは前の敵からの出現間隔(秒)
 */
function buildWave(wave) {
  const list = [];
  const push = (type, count, gap) => {
    for (let i = 0; i < count; i++) list.push({ type, delay: gap });
  };

  const n = 6 + Math.floor(wave * 1.6);
  push("normal", n, 0.9);

  if (wave >= 3) push("fast", 2 + Math.floor(wave * 0.8), 0.55);
  if (wave >= 5) push("tank", Math.floor(wave / 2.5), 1.6);
  if (wave % 10 === 0) push("boss", Math.floor(wave / 10), 3.0);

  return list;
}

/* HPと報酬のWaveスケーリング */
function enemyHpScale(wave) {
  return (1 + 0.16 * (wave - 1)) * Math.pow(1.045, wave - 1);
}
function enemyBountyScale(wave) {
  return 1 + 0.04 * (wave - 1);
}
