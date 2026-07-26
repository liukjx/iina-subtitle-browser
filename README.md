# IINA 字幕浏览器插件 (Subtitle Browser)

在 IINA 侧边栏显示所有字幕行及时间戳，点击可跳转播放，类似 PotPlayer 的字幕浏览器。

![IINA 6.0+](https://img.shields.io/badge/IINA-6.0%2B-blue)
![Plugin API](https://img.shields.io/badge/Plugin%20API-v2-green)
![GitHub Release](https://img.shields.io/github/v/release/liukjx/iina-subtitle-browser)

## 功能

- **支持 3 种字幕格式**: SRT / ASS/SSA / WebVTT
- **侧边栏展示**: 所有字幕行按时间顺序列出，带时间戳
- **实时同步**: 播放时自动高亮当前字幕行，自动滚动
- **点击跳转**: 点击任一字幕行，视频跳转到对应时间点
- **浅色/深色模式**: 自动适配系统外观

## 安装

### 方式一：通过 Release 安装（推荐）

1. 前往 [Releases](https://github.com/liukjx/iina-subtitle-browser/releases) 页面
2. 下载最新版本的 `.iinaplgz` 文件
3. 打开 IINA → 设置 → 插件，将文件拖入窗口即可

### 方式二：手动安装

1. 打开 IINA → 设置 → 插件
2. 点击「打开插件文件夹」
3. 将 `com.lss.subtitle-browser.iinaplugin` 文件夹放入打开的目录
4. 在 IINA 中启用该插件
5. 播放视频时，点击右侧边栏的「字幕浏览器」标签即可使用

## 用法

1. 播放带有外挂字幕的视频文件
2. 在 IINA 右侧边栏选择「字幕浏览器」标签
3. 插件会自动加载当前选中的字幕轨道
4. 侧边栏会显示所有字幕行，播放时当前行高亮
5. 点击任意字幕行即可跳转到对应时间

> 提示：如果侧边栏没有自动显示，请点击 IINA 窗口右上角的侧边栏按钮（□ 图标）手动打开。

## 已知限制

- **仅支持外挂字幕**: 内嵌字幕（如 MKV 内封）暂不支持，请先提取为独立 .srt / .ass / .vtt 文件
- **ASS 特效不支持**: ASS 中的动画、旋转、颜色等样式标签（`{\pos(...}`, `{\fn...}` 等）会被剥离，仅保留纯文本
- **同步精度**: 播放位置每 **300ms** 轮询一次，非逐帧精确同步
- **IINA 版本**: 需要 IINA **6.0 或更高版本**（IINA Plugin API v2）
- **首次加载**: 切换视频或字幕轨道后，插件可能需要 **1-2 秒**自动加载

## 开发

### 本地调试

```bash
# 将插件链接到 IINA 开发目录（修改后即时生效）
/Applications/IINA.app/Contents/MacOS/iina-plugin link /path/to/com.lss.subtitle-browser.iinaplugin

# 取消链接
/Applications/IINA.app/Contents/MacOS/iina-plugin unlink /path/to/com.lss.subtitle-browser.iinaplugin
```

### 手动打包

```bash
/Applications/IINA.app/Contents/MacOS/iina-plugin pack /path/to/your.iinaplugin
# 输出: com.lss.subtitle-browser.iinaplugin-<version>.iinaplgz
```

### 自动发布

推送 `v*` 格式的 tag 即可触发 GitHub Actions 自动打包并上传到 Release：

```bash
git tag v1.0.2
git push origin v1.0.2
# → 在 GitHub 创建 Release 关联该 tag，Actions 会自动完成打包
```

工作流会自动：
1. 从 tag 名提取版本号（`v1.0.2` → `1.0.2`）
2. 更新 `Info.json` 的 `version` 字段
3. 打包为 `.iinaplgz` 文件
4. 上传到对应 Release

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
- 打包格式: `.iinaplugin`（开发目录）/ `.iinaplgz`（分发压缩包）
- 作者: [栗少](https://github.com/liukjx)

## 许可

MIT License
