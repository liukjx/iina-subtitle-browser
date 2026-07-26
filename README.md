# IINA 字幕浏览器插件 (Subtitle Browser)

在 IINA 侧边栏显示所有字幕行及时间戳，点击可跳转播放，类似 PotPlayer 的字幕浏览器。

![IINA 6.0+](https://img.shields.io/badge/IINA-6.0%2B-blue)
![Plugin API](https://img.shields.io/badge/Plugin%20API-v2-green)

## 功能

- **支持 3 种字幕格式**: SRT / ASS/SSA / WebVTT
- **侧边栏展示**: 所有字幕行按时间顺序列出，带时间戳
- **实时同步**: 播放时自动高亮当前字幕行，自动滚动
- **点击跳转**: 点击任一字幕行，视频跳转到对应时间点
- **浅色/深色模式**: 自动适配系统外观

## 安装

1. 打开 IINA → 设置 → 插件
2. 点击「打开插件文件夹」
3. 将 `com.lss.subtitle-browser.iinaplugin` 文件夹放入打开的目录
4. 在 IINA 中启用该插件
5. 播放视频时，点击右侧边栏的「字幕浏览器」标签即可使用

> **注意**: 仅支持**外挂字幕**文件（.srt / .ass / .vtt），暂不支持内嵌字幕。

## 用法

1. 播放带有外挂字幕的视频文件
2. 在 IINA 右侧边栏选择「字幕浏览器」标签
3. 插件会自动加载当前选中的字幕轨道
4. 侧边栏会显示所有字幕行，播放时当前行高亮
5. 点击任意字幕行即可跳转到对应时间

## 文件结构

```
com.lss.subtitle-browser.iinaplugin/
├── Info.json       # 插件元数据（名称、权限、版本）
├── main.js         # 主逻辑（字幕解析、同步、插件生命周期）
└── sidebar.html    # 侧边栏 UI（字幕列表展示与交互）
```

## 技术细节

- 使用 IINA Plugin API v2
- 解析器: SRT / ASS (自动剥离样式标签) / WebVTT
- 同步: 每 300ms 轮询 `time-pos`，二分查找定位当前字幕
- 权限: `file-system`（读取字幕文件）、`show-osd`

## 许可

MIT License
