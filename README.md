# 粉色悬浮便签 🎀

一个常驻桌面的卡通可爱风悬浮便签（Electron）。始终悬浮在桌面最上层、不遮挡操作，
用于记录每天要做的事，支持实时编辑、自动保存、完成勾选和本地定时提醒。
无需联网、无需登录，数据保存在本地 JSON 文件中，下次打开自动恢复。

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 可编辑文本区 | 多行输入、回车换行、自动保存（停止输入 0.35s 后落库） |
| 完成勾选 | 点击小爱心打勾，文字划线变淡，打勾时还有爱心飞出 |
| 本地定时提醒 | 每条事项可设提醒时间，到点窗口抖动 + 呼吸发光 + 提示音 + 系统通知 |
| 窗口拖动 | 按住顶部标题栏拖动（猫耳朵露在窗口外） |
| 窗口缩放 | 拖动右下角手柄，最小 260×300 |
| 最小化到托盘 | 最小化 / 关闭按钮都是「后台运行」，托盘图标常驻 |
| 开机自启 | 托盘菜单勾选「开机自启动」 |
| 点击穿透 | 默认关闭，点猫爪按钮开启；开启后点击穿透到桌面，悬停工具栏可临时恢复操作 |
| 全局快捷键 | `Ctrl+Alt+N` 新建便签 · `Ctrl+Alt+T` 置顶开关 · `Ctrl+Alt+H` 显示/隐藏全部 · `Ctrl+Alt+C` 关闭穿透 |

> 快捷键若被其他软件占用，会自动降级到备选组合（如 `Ctrl+Alt+P` / `Ctrl+Alt+E`），
> 启动日志会提示实际生效的组合；托盘菜单中同样可以使用全部功能。

## 视觉与特效

- 奶油杏配色：粉白 `#FFF7FA`、浅粉 `#FFEAF2`、柔粉强调 `#F09CBB`、深粉 `#E2789F`，整体低饱和、更耐看
- 近不透明磨砂质感（backdrop-filter + 可调不透明度，默认 98%），白色内边框 + 暖杏虚线手绘描边
- 猫耳朵、猫爪 Logo、小爱心、小星星点缀，顶部手绘波浪分隔线
- 顶部吉祥物：会动的卡通角色（Kitty猫 / 小恶魔 / 爱心 / 星星 / 云朵 / 小熊 / 小花），带眨眼、挥手、耳朵抖动、漂浮动画，点击可互动（跳跃 + 爱心 + 随机鼓励语）
- 背景可爱简笔画：HelloKitty / 爱心 / 星星 / 云朵 / 小熊 / 小花，颜色与风格跟随主题
- 悬停轻微放大 + 阴影加深；编辑时有跳动小星星跟随光标
- 保存时爱心飘出动画；提醒时窗口抖动 + 发光呼吸灯
- 背景有极淡的漂浮云朵 / 闪烁星星，与桌面自然融合

## 调色盘

标题栏点击调色盘按钮（三个重叠圆圈）打开面板：

- **颜色主题卡片（推荐）**：13 组「颜色 ↔ 吉祥物」配套预设，点卡片即成套切换
  颜色 + 顶部吉祥物 + 背景简笔画 + 虚线/波浪线/阴影等全套元素：

  | 颜色 | 吉祥物 | 颜色 | 吉祥物 |
  | --- | --- | --- | --- |
  | 红色 | 小火怪 | 蓝色 | 小鲸鱼 |
  | 粉色 | 小恶魔 | 雾蓝 | 云朵 |
  | 粉白 | Kitty猫 | 靛色 | 月亮 |
  | 橙色 | 小太阳 | 紫色 | 小葡萄 |
  | 黄色 | 小鸡 | 薰衣草 | 库诺米 |
  | 绿色 | 小树 | 奶油黄 | 小熊 |
  | 薄荷 | 小花 | | |

- **微调**：5 个颜色（背景浅/深、强调色、深强调、文字色）可取色器点选或直接输入
  颜色代码（支持 `#FF9EBC`、`F09CBB`、`#f9c`）；不透明度 80%–100% 滑杆；
  背景简笔画 7 种可选
- 所有设置全局同步到每个便签窗口并持久保存

## 目录结构

```
桌面悬浮球/
├── package.json          # 项目配置与依赖
├── main.js               # Electron 主进程：窗口/托盘/快捷键/提醒引擎/数据持久化
├── preload.js            # 预加载：安全暴露 IPC API 给渲染进程
├── index.html            # 界面结构
├── renderer.js           # 渲染进程：编辑/勾选/提醒/穿透/缩放/动画逻辑
├── style.css             # 全部样式与动画
├── assets/
│   ├── make-icons.js     # 图标生成脚本（零依赖，node assets/make-icons.js）
│   ├── icon.png          # 应用图标 512×512
│   ├── tray-icon.png     # 托盘图标 64×64
│   ├── icon.ico          # Windows 打包图标
│   └── icon.icns         # macOS 打包图标
└── README.md
```

## 快速开始

要求：Node.js 18+（自带 npm）

```bash
# 1. 安装依赖（Electron + electron-builder）
npm install

# 2. 启动
npm start
```

> 国内网络如果安装缓慢或二进制下载失败，使用淘宝镜像：
> ```bash
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> npm install --registry=https://registry.npmmirror.com
> ```

首次启动会自带一条示例便签（含几条可爱示例事项），之后所有改动都会自动保存。

## 打包

```bash
npm run dist        # Windows (nsis 安装包) + macOS (dmg)
npm run dist:win    # 仅 Windows
npm run dist:mac    # 仅 macOS（需在 macOS 上执行）
```

产物输出在 `dist/` 目录。

> 国内网络打包时，electron-builder 还需下载代码签名等工具，建议一并设置镜像：
> ```bash
> $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> npm run dist:win
> ```

## 数据存储

- 位置：`%APPDATA%/cute-sticky-notes/sticky-notes.json`（Windows）
  / `~/Library/Application Support/cute-sticky-notes/sticky-notes.json`（macOS）
- 内容：便签标题、事项（文本 / 完成状态 / 提醒时间）、窗口位置和尺寸
- 可在托盘菜单点「打开数据文件夹」直接查看；删除该文件后重启即可重置
- 修改提醒时间会自动重置「已触发」状态，到点会再次提醒

## 字体说明（可选）

默认使用系统圆体（Windows 幼圆 / macOS 圆体-简 / PingFang SC）。
想换成「沐瑶软糖体」（免费商用）：

1. 下载字体文件（如 `MuYaoSoftCandy.ttf`）
2. 放入 `assets/fonts/`，在 `style.css` 顶部加入：

```css
@font-face {
  font-family: "沐瑶软糖体";
  src: url("assets/fonts/MuYaoSoftCandy.ttf") format("truetype");
}
```

`style.css` 的字体栈中已经预留了「沐瑶软糖体」，安装后自动生效。

## 常见问题

**Q：开启穿透后点不到按钮了？**
三种恢复方式：① 按 `Ctrl+Alt+C`；② 右键托盘图标 →「关闭点击穿透」；
③ 把鼠标移到右上角工具栏（会自动临时恢复点击，移开即恢复穿透）。

**Q：关闭窗口后程序在哪？**
在系统托盘（Windows 右下角 / macOS 顶部菜单栏），单击托盘图标可显示/隐藏全部便签。

**Q：提醒没响？**
确认事项设置了提醒时间且未勾选完成；系统通知需在系统设置中允许通知。
到点未打开应用时，重启后会补触发一次。

**Q：macOS 上没有 Dock 图标？**
这是桌面小组件的正常形态（仅托盘常驻）。如需 Dock 图标，
删除 `main.js` 中 `app.dock.hide()` 一行即可。

## 技术要点

- `frame: false` + `transparent: true` 透明无边框窗口，圆角与磨砂由 CSS 实现
- `alwaysOnTop: true` + `skipTaskbar: true`，始终置顶且不进任务栏
- `setIgnoreMouseEvents(true, { forward: true })` 实现点击穿透，
  配合渲染层「悬停工具栏恢复点击」保证可用性
- `-webkit-app-region: drag / no-drag` 实现标题栏拖动
- 主进程单例管理数据与窗口，渲染进程防抖后经 IPC 回写 JSON
- 图标由 `assets/make-icons.js` 用 Node 内置 `zlib` 现场绘制 PNG/ICO/ICNS，无第三方素材
