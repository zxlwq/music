# 主题皮肤（skins）

本目录与主样式解耦：换皮 / 增删主题优先改这里。

- **中间面板**（播放器、歌单、按钮、进度等）：随 `html[data-skin]` 的 `--skin-*` 变色
- **整页两侧背景**：始终用背景图 + 中性压暗，**不**铺皮肤彩色渐变

## 结构

```
src/skins/
  README.md      # 本文档
  index.js       # 皮肤注册表 + applySkin / persistSkin
  skins.css      # 各 data-skin 的 CSS 变量覆盖
```

## 使用方式

1. 设置 → **美化设置** → **主题皮肤** 下拉切换（即时预览）。
2. 「应用并保存」会写入 `localStorage.ui.skinId`，并随云端 appearance 同步。
3. 启动时由 `src/hooks/theme.js` 调用 `applySkin(getSkinId())`。

## 当前皮肤

| id      | 名称 | 风格          |
| ------- | ---- | ------------- |
| sakura  | 樱粉 | 默认樱花粉    |
| ocean   | 海雾 | 青绿 → 天蓝   |
| sunset  | 暮橙 | 琥珀 → 珊瑚   |
| forest  | 翠野 | 薄荷绿 → 翠绿 |
| aurora  | 极光 | 青蓝 → 玫紫   |
| glacier | 冰川 | 冰青 → 银灰蓝 |
| ember   | 余烬 | 赤橙 → 玫红   |
| grape   | 葡萄 | 浅紫 → 葡萄紫 |
| honey   | 蜜金 | 香槟金 → 琥珀 |
| wine    | 酒红 | 玫粉 → 酒红   |
| mist    | 烟岚 | 薄荷青 → 青灰 |
| citrus  | 青柠 | 嫩绿 → 柠黄   |

## 新增一套皮肤

1. 在 `skins.css` 增加 `[data-skin='your-id'] { ... }`，覆盖约定变量（见文件头注释）。
2. 在 `index.js` 的 `SKINS` 数组追加 `{ id, name }`。
3. 无需改播放器组件；按钮 / 进度条等已使用 `var(--skin-*)`。

## 移除皮肤系统

1. 删除整个 `src/skins/` 目录。
2. `src/main.jsx` 去掉 `import './skins/skins.css'`。
3. `src/hooks/theme.js` 去掉 `applySkin` 相关调用。
4. `Settings.jsx` 去掉「主题皮肤」表单项与 `skinId` 状态。
5. `SettingsUI.js` 去掉 `skinId` 同步字段。
6. （可选）将 `styles.css` 中 `var(--skin-*)` 改回原先写死的色值。
