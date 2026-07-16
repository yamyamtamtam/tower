# 画像アセットの置き場所

このフォルダに3D風の画像(スプライト)を置き、`js/assets.js` の
`ASSET_MANIFEST` にキーとファイル名を登録すると、コード描画から
画像描画に自動で切り替わります。

```js
const ASSET_MANIFEST = {
  tile_ground: "tile_ground.png",
  tower_arrow_1: "tower_arrow_1.png",
  // ...
};
```

## 対応キー一覧

| キー | 内容 | 推奨仕様 |
|---|---|---|
| `tile_ground` | 地面タイル | 幅:高さ = 2:1 の菱形。厚みがある場合は下に伸ばす |
| `tile_path` | 道タイル | 同上 |
| `tower_arrow_1`〜`3` | アロータワー Lv1〜3 | 足元中央が画像下端中央。透過PNG |
| `tower_cannon_1`〜`3` | キャノンタワー Lv1〜3 | 同上 |
| `tower_ice_1`〜`3` | アイスタワー Lv1〜3 | 同上 |
| `tower_sniper_1`〜`3` | スナイパータワー Lv1〜3 | 同上 |
| `enemy_normal` / `enemy_fast` / `enemy_tank` / `enemy_boss` | 敵キャラ | 足元中央が画像下端中央。透過PNG |
| `projectile_arrow` / `projectile_cannon` / `projectile_ice` / `projectile_sniper` | 弾 | 小さめの透過PNG |
| `bg` | 背景 | 画面全体に引き伸ばされる |

- タイルサイズは `js/config.js` の `TILE_W` / `TILE_H`(初期値 88×44px)を基準に描画されます。
- タワー・敵は足元座標を基準に、幅に合わせて等比で拡大縮小されます。
