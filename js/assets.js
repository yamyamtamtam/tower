/* =========================================================
 * アセット管理レイヤー
 *
 * あとで画像(3D風スプライト)を差し替えられるようにするための層。
 * 画像が登録されていない間は、ゲーム側がコード描画(擬似3D)で
 * フォールバックする。
 *
 * ---- 画像の追加方法 ----
 * 1. assets/img/ に画像ファイルを置く
 * 2. 下の ASSET_MANIFEST にキーとファイル名を追加する
 *    例: tower_arrow_1: "tower_arrow_1.png",
 * 3. ブラウザをリロードすると自動でその画像が使われる
 *
 * ---- 使用されるキー一覧(この名前で画像を用意すればOK)----
 *  tile_ground        : 地面タイル(アイソメ菱形 2:1 推奨)
 *  tile_path          : 道タイル
 *  tower_arrow_1..3   : アロータワー Lv1〜3
 *  tower_cannon_1..3  : キャノンタワー Lv1〜3
 *  tower_ice_1..3     : アイスタワー Lv1〜3
 *  tower_sniper_1..3  : スナイパータワー Lv1〜3
 *  enemy_normal / enemy_fast / enemy_tank / enemy_boss : 敵
 *  projectile_arrow / projectile_cannon / projectile_ice / projectile_sniper : 弾
 *  bg                 : 背景(画面全体)
 * ========================================================= */

const ASSET_MANIFEST = {
  // 例: tile_ground: "tile_ground.png",
  // 例: tower_arrow_1: "tower_arrow_1.png",
};

const Assets = {
  images: {},
  _loading: 0,

  /** マニフェストの画像をすべて読み込む(存在しないものは無視) */
  loadAll(onDone) {
    const keys = Object.keys(ASSET_MANIFEST);
    if (keys.length === 0) { onDone(); return; }
    let remaining = keys.length;
    const finish = () => { if (--remaining === 0) onDone(); };
    for (const key of keys) {
      const img = new Image();
      img.onload = () => { this.images[key] = img; finish(); };
      img.onerror = () => {
        console.warn(`[Assets] 読み込み失敗: assets/img/${ASSET_MANIFEST[key]} (フォールバック描画を使用)`);
        finish();
      };
      img.src = `assets/img/${ASSET_MANIFEST[key]}`;
    }
  },

  has(key) {
    return !!this.images[key];
  },

  get(key) {
    return this.images[key] || null;
  },

  /**
   * スプライト描画ヘルパー。
   * 画像があれば (x, y) を「足元中央」として描画し true を返す。
   * なければ false を返す(呼び出し側がフォールバック描画する)。
   * @param {number} w 描画幅(px)。高さはアスペクト比を保って自動計算
   */
  drawSprite(ctx, key, x, y, w) {
    const img = this.images[key];
    if (!img) return false;
    const h = w * (img.height / img.width);
    ctx.drawImage(img, x - w / 2, y - h, w, h);
    return true;
  },

  /**
   * タイル用描画ヘルパー。(x, y) はタイル菱形の中心。
   * 画像は菱形の上端が画像上部に接する前提(標準的なアイソメタイル)。
   */
  drawTile(ctx, key, x, y, tileW, tileH) {
    const img = this.images[key];
    if (!img) return false;
    const h = tileW * (img.height / img.width);
    // 菱形部分(高さ tileH)の中心を (x, y) に合わせ、余剰分は上に伸ばす
    ctx.drawImage(img, x - tileW / 2, y + tileH / 2 - h, tileW, h);
    return true;
  },
};
