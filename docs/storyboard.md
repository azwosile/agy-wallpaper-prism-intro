# Wallpaper Prism (`v1.1.0`) — Bilibili 宣传片与操作教程分镜蓝图 (`storyboard.md`)

> **项目**: `agy-wallpaper-prism` (`Wallpaper Prism` v1.1.0)  
> **规格**: `1920×1080` · `60fps` · `H.264 High@4.2 yuv420p` · `AAC 192kbps 48kHz (-14.0 LUFS)`  
> **最终成片时长**: `93.797s`（`01:34` / `5628` 帧 @ 60fps，以 `audio/timeline.json` 为唯一真值：Act1 `0.000–14.800s` · Act2 `14.800–28.261s` · Act3 `28.261–44.989s` · Act4 `44.989–63.855s` · Act5 `63.855–78.305s` · Act6 `78.305–93.797s`）  
> **BGM**: `残像音阶, M3mo - 感官过载.mp3`（`132 BPM`，`bgmStartSec = 0.0s`，结尾 `2.5s` `qsin` 丝滑淡出）  
> **配音风格**: Fish Audio `s2.1-pro-free` · **曼波 (Mambo)** 活力解说（15 句紧凑台词，见 `docs/narration-script.json`）

---

## 1. 视觉美学与风格融合

本片深度融合两大 B 站高完播率爆款基因：

1. **光学美学标杆（致敬 `BV1kay4z3EDR` Obsidian Prism WebGL2 光学套件）**:
   - **原生 WebGL2 光学背景 (`scene/webgl-prism.js`)**: 实时 GLSL 渲染棱镜色散焦散（Chromatic Dispersion Caustics）、菲涅尔玻璃折射弧光（Specular Glass Arcs）、`172°` 液态玻璃扫光与随 `audio/bgm-energy.json` 132 BPM 律动的体积散景光斑（Volumetric Bokeh）。
   - **3D 镜头语法与微距特写**: 真实 `/hub`（Antigravity 2.0 宿主界面）与 `/studio`（Wallpaper Prism Sidecar 面板）嵌入带有真实深度投影与 `1px` 镜面顶光边的 3D 玻璃窗框中，采用弹簧插值（Spring Easing）进行俯仰透视推拉、8px 浮岛缝隙微距特写与明暗无缝翻转。
2. **活力曼波引导教学（致敬 `BV1G3HD6WEfu` 曼波插件实测）**:
   - **5 步傻瓜式上手路线 (`STEP 01` → `STEP 05`)**: 屏幕左上角以高质感液态玻璃胶囊标注当前步骤，配合**虚拟棱镜光标（Virtual Prism Cursor）**划出优雅贝塞尔轨迹并触发同心圆点击波纹，精准点选真实 UI 控件。
   - **一眼看懂的技术硬实力标签**: 关键帧弹出轻量光效指标胶囊（`8.3ms 冷启动`、`2.5ms 极速切换`、`32×32 动态取色`、`WCAG 对比度底限`、`0 Token`、`零修改 app.asar`），炫酷而不堆砌。
   - **B 站底部安全区动态字幕**: 固定位于 `Y = 935–1025px` 居中安全带，深色高对比磨砂衬底 + 细腻棱镜描边，绝不遮挡主画面核心按钮，亦避开右下角 `1680..1920 × 990..1080` 的 B 站进度条/时长角标区。

---

## 2. 音频节奏锚点与全局渲染架构

### 2.1 BGM 音乐结构与分幕对齐（`残像音阶, M3mo - 感官过载.mp3`，`132 BPM`）

| 音乐时间戳 | 音乐形态 | 分幕 / 关键视觉触发点 |
|---|---|---|
| `0.0s – 3.9s` | 电子律动前奏 (`-16dB`, 0.5s 脉冲) | **Act 1 前半**: 纯黑死板默认 IDE 冷开场 |
| **`4.0s`** | **强重拍冲击 (`-12.4dB`)** | **Act 1 破壁爆发**: 玻璃棱镜折射碎裂，点亮 `崩坏3周年庆（动态）` 浮岛工作台！ |
| **`14.5s – 15.0s`** | **第一主 Drop (`-11.5dB`, peak `0.92`)** | **Act 2 切入**: 动感切换至右侧 `[Wallpaper Prism]` 完整工作台 + Steam 431960 自动扫描 |
| `31.5s → 32.5s` | **短休止吸气 (`-23.0dB`) → 鼓点猛砸 (`-12.1dB`)** | **Act 3 高光点击**: 虚拟光标悬停并点击 `崩坏3周年庆（动态）`，卡点 `2.5ms` 秒切！ |
| **`44.0s`** | **高能乐句强拍 (`-11.5dB`)** | **Act 4 外观大秀**: 切换 `棱镜外观`，`浮岛画境 ↔ 紧凑一体` + `Nord 浅霜` + WCAG 代码微距 |
| **`59.5s – 71.5s`** | **间奏缓和 Breakdown (`-18dB ~ -21.6dB`)** | **Act 5 日常神技**: 音乐自然收拢留白，清晰演示 `Ctrl+Alt+W` 快捷浮窗 + 一键普通快捷方式自动加载 |
| **`72.5s`** | **终极高潮 Drop (`-11.7dB`, peak `0.94`)** | **Act 6 开源收尾**: 音乐轰鸣回归，3D 浮岛全景 + GitHub 开源卡片 + 曼波一键三连！ |
| `~83.0s – 85.5s` | 结尾能量尾奏 + `2.5s` 丝滑淡出 | 棱镜徽标光晕收束，优雅黑场渐隐 |

### 2.2 确定性帧同步协议（`@motion-builder` 实现约定）
- `window.__setTime(tSec)` 驱动整场演出：
  - **台词与分镜同步**: 读取 `audio/timeline.json`，根据 `tSec` 定位当前激活的 `line`（`01_hook`..`15_mambo_cta`）及句内归一化进度 `p = clamp((tSec - line.startSec) / line.durationSec, 0, 1)`，杜绝音画漂移。
  - **动态壁纸零掉帧**: `崩坏3周年庆（动态）` 使用预抽帧 `honkai3-frames/%04d.jpg`，按 `frameIdx = Math.floor(tSec * 60) % totalHonkaiFrames` 直接绘入 `/hub` 的 `#agy-prism-stage` 画布与 `/studio` 的 21:9 预览画布。
  - **WebGL2 Shader 同步**: 从 `audio/bgm-energy.json` 读取 `Math.floor(tSec * 60)` 处的 `{ rms, bass, treble }` 驱动 `uEnergy`、`uBass`、`uChromaticBurst` 与动态强调色 `uAccentRGB`。

---

## 3. 六幕十五镜逐镜分镜表（Shot-by-Shot Blueprint）

> 注：表中 `target` 时间为脚本预估时间，渲染时以 `audio/timeline.json` 真实 `startSec` / `endSec` 为准；`action` 字段与 `docs/narration-script.json` 严格一一对应。

### Act 1 · 破壁冷开场：告别纯黑，点亮液态棱镜（`0.0s – 14.8s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S01** `01_hook` | `cold_open_dark_ide_shatter` | `0.4s – 3.8s` | **Before 冷色调平视**: 纯黑原生 Antigravity 2.0 Hub（关闭棱镜皮肤，`skinEnabled: false`，低饱和冷灰），镜头缓慢前推 (`scale: 0.96 -> 1.02`, `rotateY: -2deg -> 0deg`)，在 `3.6s` 处屏幕中心出现一道锐利青紫棱镜裂光预蓄力。 | WebGL2 低亮度深空暗底 (`uEnergy` 微弱脉冲)；`3.95s` `uChromaticBurst` 蓄满爆发。无光标。 | 左上灰阶胶囊：`BEFORE · 默认纯黑工作台` |
| **S02** `02_reveal` | `prism_refraction_burst_reveal_honkai3` | `4.15s – 8.95s` | **4.0s 卡点棱镜爆发**: 全屏 `172°` RGB 色散扫光划过！暗黑实心底板瞬间切换为 **Obsidian Prism 6层液态毛玻璃 + 浮岛画境 (`islands`)**，背后 **`崩坏3周年庆（动态）`** 4K60 动态壁纸瞬间绽放！镜头做一个凌厉的弹性拉远 + 3D 英雄斜角 (`rotateX: 7deg, rotateY: -9deg, scale: 1.08 -> 0.96`)。中央短暂浮现半透明菱形 Prism Logo + `Wallpaper Prism v1.1.0` 金属流光标题。 | `/hub` 实时注入 `wallpaper-inject.js`，启用 `layout: islands`, `scheme: prism-default (dark)`, `accentMode: dynamic`；WebGL2 焦散环随 132 BPM 重拍向外扩散。 | 左上高亮棱镜胶囊：`Wallpaper Prism v1.1.0 · Obsidian Prism 6层液态玻璃` |
| **S03** `03_hero_showcase` | `hero_islands_3d_sweep` | `9.3s – 14.3s` | **英雄 3D 漫游特写**: 镜头沿 3D 弧线从左侧对话流扫向右侧代码卡片与终端 (`rotateY: -9deg -> +7deg`, `scale: 0.96 -> 1.05`)，清晰呈现 `崩坏3周年庆（动态）` 透过半透明毛玻璃的丝滑流动感、1px 顶部高光描边与悬浮阴影。右侧弹出 3 枚轻量光效徽章依次亮起。 | `honkai3-frames` 满 60fps 流畅循环；3 枚特性胶囊带弹簧入场：`4K60 动态壁纸` / `零修改 app.asar` / `0 Agent Token`。 | 左上：`崩坏3周年庆（动态）· 零修改 app.asar · 0 Token` |

---

### Act 2 · 开箱即用：面板开启 & Steam 431960 自动扫描（`14.8s – 28.0s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S04** `04_open_studio` | `open_sidecar_studio_pane` | `14.8s – 20.4s` | **14.8s 主 Drop 切入**: 主舞台丝滑分屏为 **左侧 `/hub`（占比 42%）+ 右侧 `/studio` 完整工作台（占比 58%）**，呈现 Antigravity 真实侧边 Aux Pane 形态。镜头轻微推近右侧 Studio 顶部导航栏 (`scale: 1.04`, 焦距锁定 Studio)。 | **虚拟光标**: 从屏幕中部滑向右上角 `[Wallpaper Prism]` 侧边栏入口标签并点击（触发青蓝色同心涟漪），`/studio` 玻璃窗从右侧弹簧滑入展开，顶部绿点亮起 `已连接宿主 · 棱镜皮肤生效中`。 | 步骤徽章：`STEP 01 · 打开右侧 [Wallpaper Prism] 工作台` |
| **S05** `05_steam_autoscan` | `steam_library_autoscan_highlight` | `20.75s – 27.55s` | **壁纸库自动扫描特写**: 镜头居中聚焦 `/studio` 的「壁纸库」网格视图 (`scale: 1.08`)，上方筛选标签（`全部 / 视频 / 图片 / 网页 / 场景`）依次高亮扫过，展示自动识别出的 **Steam 创意工坊 (431960)** 脱敏 SFW 精品壁纸墙（无任何敏感/成人内容，路径统一脱敏为 `Steam/steamapps/workshop/content/431960`）。 | **虚拟光标**: 轻点一下 `重新扫描` 按钮，瞬间完成扫描并弹出冷启动性能浮标：**`⚡ 8.3ms 缓存冷启动`**；卡片角标依次闪亮：`MP4 视频` / `PKGV/LZ4 场景` / `HTML 网页` / `静态图`。 | `Steam 431960 自动扫描 · PKGV/LZ4 场景解包 · 8.3ms 冷启动` |

---

### Act 3 · 一键秒切：2.5ms 加速、动态取色与左侧快捷光学（`28.0s – 44.1s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S06** `06_click_honkai` | `cursor_click_honkai3_card` | `28.0s – 32.6s` | **卡点点击高光时刻**: `/studio` 处于另一张冷色调风景壁纸预览态，镜头对准第一张卡片 **`崩坏3周年庆（动态）`** 缓慢推进 (`scale: 1.08 -> 1.18`)；在 `31.5s` BGM 短休止处光标悬停卡片（卡片悬浮泛出玻璃高光），**精准在 `32.5s` 重拍处按下点击！** | **虚拟光标**: 移至 `崩坏3周年庆（动态）` 缩略图中心 -> `32.5s` 触发耀眼棱镜点击波纹！右侧 21:9 实时预览与左侧 `/hub` 同步瞬间切入绚丽的 `崩坏3周年庆（动态）`！ | `STEP 02 · 点击切换「崩坏3周年庆（动态）」` |
| **S07** `07_faststart_switch` | `fast_switch_speed_badge_and_preview` | `33.0s – 38.0s` | **极速切壁纸与零拷贝架构展示**: 镜头微微后撤展示左 `/hub` 与右 `/studio` 21:9 实时预览的双屏同步律动 (`rotateY: +4deg -> -3deg`)，画面上方滑出透明玻璃性能遥测卡片，以动态数字跳动定格 **`2.5ms`** 切换耗时与 `MP4 Faststart VFS · HTTP 206 Range` 管线示意图。 | WebGL2 切换瞬态色散波纹；`/hub` 与 `/studio` 视频帧保持 100% 毫秒级同步无黑屏闪烁。 | `2.5ms 极速切换 · 零拷贝 MP4 Faststart · 206 Range` |
| **S08** `08_dynamic_accent` | `dynamic_chroma_accent_and_left_rail` | `38.35s – 43.65s` | **32×32 动态取色 + 平衡左侧栏特写**: 镜头推至 `/studio` 左侧精调栏（Left Rail），高亮显示 `32×32 实时动态取色` 色板胶囊（实时从 `崩坏3周年庆（动态）` 提取的主强调色光晕同步染亮全界面按钮与 WebGL2 背景 `uAccentRGB`！）。随后光标平滑拖动左侧栏 `壁纸背景柔焦模糊` 滑块，右侧 `/hub` 背景实时呈现清晰 ↔ 柔焦变化，并掠过 `轮播列表` 播放控制条。 | **虚拟光标**: 拖拽左栏光学模糊滑块 (`0px -> 10px -> 2px`)，点击播放列表图标展开 1 秒精简预览；WebGL2 粒子色温实时跟随提取的强调色流转。 | `32×32 动态取色 · 左侧栏光学微调 · 播放列表自动轮播` |

---

### Act 4 · Obsidian Prism 光学系统：浮岛、明暗配色与 WCAG 护眼（`44.1s – 60.2s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S09** `09_islands_vs_flush` | `toggle_islands_flush_macro_gap` | `44.1s – 49.2s` | **44.0s 强拍切页 + 浮岛间隙微距**: 光标点击 `/studio` 顶部 **`棱镜外观`** 标签页，镜头切至 `/hub` 主视窗 + 悬浮控制条，进行极具质感的大微距特写 (`scale: 1.32`，聚焦侧边栏与主面板之间的 **`8px` 浮岛间距** 与 `1px` 镜面高光顶边！)。 | **虚拟光标**: 在 `面板布局模式` 中依次点击 **`紧凑一体 Flush`**（浮岛丝滑合拢成无缝一体面板）→ 再点回 **`浮岛画境 Islands`**（四周优雅收缩浮起，透出背后 `崩坏3周年庆（动态）` 流动光斑与环境投影）。 | `STEP 03 · 浮岛画境 Islands ↔ 紧凑一体 Flush` |
| **S10** `10_presets_and_nord` | `switch_scheme_dark_to_nord_light` | `49.55s – 54.65s` | **4 场景预设 & 8 配色昼夜炫技**: 镜头回到全景斜角 (`scale: 1.0`, `rotateY: -5deg -> +5deg`)，顶部快捷呈现 4 套场景预设（`通透流光 / 浮岛画境 / 沉静柔焦 / 极简省电`）与 8 组色卡圆点矩阵。光标轻点 **`极地冰川 Nord` + `白昼亮色`**, 一道晶莹冰蓝斜向擦屏扫光（Diagonal Frost Wipe）瞬间将整套暗黑黑曜工作台翻转为绝美 **Light Frost Nord 冰川浅霜毛玻璃**！尾声再切回深空黑曜或停留在最通透的高级态迎接护眼展示。 | `/hub` 实时切换 `data-prism-scheme="nord"` + `data-prism-theme="light"`（冰川雪白透光磨砂 `#ECEFF4` + `#5E81AC` 极地蓝强调色），WebGL2 背景色同步转入冰晶浅蓝折射光！ | `4 光学预设 · 8 组明暗配色 · Dark Obsidian ↔ Light Frost Nord` |
| **S11** `11_wcag_readability` | `macro_zoom_code_terminal_wcag` | `55.0s – 59.8s` | **WCAG 代码可读性微距实测**: 镜头从亮色或高透光态顺畅回切深空黑曜，并**微距推入 `/hub` 内的语法高亮代码块与 xterm 终端面板 (`scale: 1.42`)**！展示高饱和动态壁纸在背后流动的同时，代码块文字边缘如刀锋般锐利清晰。角落弹出实时对比度检测标牌：`WCAG AA/AAA Contrast Floor ✓ · 磨砂护眼`。 | **虚拟光标**: 在 `代码与终端底板模式` 三档切换一次演示（`通透微透` → `磨砂护眼`），高亮显示对比度保护底板生效，杜绝花屏看不清字。 | `WCAG 对比度底限 · 代码/终端磨砂护眼` |

---

### Act 5 · 日常丝滑工作流：`Ctrl+Alt+W` 快捷浮窗 & 普通快捷方式自动加载（`60.2s – 72.5s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S12** `12_quick_popover` | `hotkey_ctrl_alt_w_quick_popover` | `60.25s – 66.05s` | **59.5s 间奏留白 · 沉浸式编码快捷键**: 隐藏右侧 Studio，呈现 **100% 全屏纯净 Antigravity 浮岛工作台 (`/hub`)** 沉浸氛围！屏幕下方中央弹出极具机械质感的三颗 3D 发光磨砂按键帽：**`Ctrl` + `Alt` + `W`** 依次按下闪光！瞬间在工作台右下方弹出 **Quick Prism Popover（96% 实心高可读悬浮面板）**。 | **虚拟光标**: 在 Quick Prism Popover 的 `速选壁纸` / `光学精调` 轻点微调一下界面不透明度，背后整窗毛玻璃实时呼吸式响应，完全不打断当前聊天与代码编写。 | `STEP 04 · 快捷键 Ctrl+Alt+W · 快捷光学浮窗` |
| **S13** `13_shortcut_autoload` | `click_normal_shortcut_autoload_success` | `66.45s – 72.15s` | **一键普通快捷方式自动加载**: 镜头切入 `/studio` 的 **`宿主与系统`** 标签页并推近核心卡片区域 (`scale: 1.15`)。卡片清晰展示未配置态提示，光标径直点击醒目的发光主按钮：**`⚡ 一键开启普通快捷方式自动加载（不中断当前对话）`**！按钮立刻绽放翡翠绿成功光晕，状态瞬间切换为：**`✓ 普通快捷方式自启已就绪 · 上次设置自动恢复已开启`**，旁边浮现精简桌面 `Antigravity` 图标闪光示意（零弹窗、不改 `app.asar`、零中断）。 | **虚拟光标**: 点击 `一键开启普通快捷方式自动加载` -> 触发成功 Toast 通知与绿色状态徽章；WebGL2 粒子由静谧渐升准备迎接 `72.5s` 最终高潮！ | `STEP 05 · 普通快捷方式自动加载 · 冷启动零弹窗自动恢复` |

---

### Act 6 · 开源高潮与曼波一键三连收尾（`72.5s – ~85.5s`）

| 镜头 ID | `action` | 预估时间 | 画面与 3D 镜头调度 | WebGL2 / UI 状态与光标动作 | 屏幕叠字 / Callout |
|---|---|---|---|---|---|
| **S14** `14_opensource_repo` | `opensource_github_hero_card` | `72.65s – 77.85s` | **72.5s 终极高潮 Drop**: 棱镜爆发转场！左侧浮现 3D 悬浮倾斜的 Antigravity 浮岛全貌（`崩坏3周年庆（动态）` 持续 60fps 璀璨流转），右侧展开一块超大号**液态玻璃 GitHub 开源名片**: 菱形 Prism 矢量 Logo + **`Wallpaper Prism v1.1.0`** + **`github.com/azwosile/agy-wallpaper-prism`** + 极简两行终端安装预览（`node scripts/build.mjs` / `node scripts/install-local.mjs`）。 | WebGL2 满功率绚丽棱镜色散环与 132 BPM 鼓点共振；4 枚金标总结依次亮起：`MIT 开源` / `Steam 431960` / `Obsidian Prism` / `0 Token`。 | `v1.1.0 完全开源 · github.com/azwosile/agy-wallpaper-prism` |
| **S15** `15_mambo_cta` | `bilibili_triple_cta_outro` | `78.2s – ~85.5s` | **曼波一键三连 End Card**: 开源卡片优雅上移半格，正下方以弹性物理特效弹出 B 站标志性发光玻璃三连胶囊：**`👍 点赞` · `🪙 投币` · `⭐ 收藏`**，三枚图标依次充能亮起青粉金三色光环！最后 `2.5s` 随 BGM 尾奏自然淡出，画面玻璃光晕温柔收束为深空黑曜尾帧。 | 虚拟光标优雅掠过三连按钮触发三连长按充能光环；`83.0s -> 85.5s` 整体亮度与 WebGL2 焦散丝滑淡出至深空黑。 | `一键三连 · 点赞 👍 投币 🪙 收藏 ⭐ · 曼波~` |

---

## 4. 封面视觉规范（`@cover-artist` 专用设计指令）

需独立排版渲染两套原生比例封面（**严禁将 16:9 简单裁切为 4:3**），确保在 B 站首页瀑布流 `240px` 小缩略图下依然一秒吸睛、字迹如刀刻般清晰：

### 4.1 视觉资产与绝对合规红线
- **背景底图**: 采用 `@asset-sanitizer` 筛选并视觉验证通过的最璀璨一帧 `崩坏3周年庆（动态）`（`assets/showcase/honkai3-frame-*.png`）。
- **核心前景道具**: 真实脱敏的 **Obsidian Prism 浮岛毛玻璃 Antigravity Hub 3D 透视窗**（包含透出动态壁纸的 8px 浮岛缝隙、高亮代码段、右侧发光 `Ctrl+Alt+W` 胶囊），沿 `172°` 倾角叠加 WebGL2/Canvas 菲涅尔棱镜折射光束与紫青色散边缘高光。
- **隐私零容忍**: 严禁出现个人用户名、真实硬盘路径、非全年龄壁纸或任何 API 密钥。

### 4.2 双比例专属构图规范

| 规格 | 尺寸 | 构图重点与文字层级 | 安全区禁忌 |
|---|---|---|---|
| **16:9 横屏主封面** (`covers/cover-16x9.png`) | `1920×1080` | **左文右景黄金三分法**: 左侧 `0..940px` 暗色渐变光学压暗区承载超大主标题（白字 + 青紫棱镜光晕 + 深黑厚重投影）：<br>• 顶标胶囊：`开源 · Antigravity 插件` + 灵动 `曼波配音` 亮色小徽章<br>• 第一行超大字：**重塑 Antigravity！**<br>• 第二行撞色荧光渐变大字：**动态壁纸 × 浮岛毛玻璃**<br>• 底部三枚精炼特性标签：`Steam 创意工坊` · `Obsidian Prism UI` · `零修改 app.asar`<br>右侧 `860..1860px` 悬浮 3D 倾斜浮岛毛玻璃工作台，与背后的 `崩坏3周年庆（动态）` 主体角色/星光交相辉映，斜穿一道通透棱镜折射光带。 | **严禁在右下角 (`1620..1920 × 940..1080`) 放置任何文字或核心图标**（避让 B 站视频时长黑底角标）。 |
| **4:3 推荐/动态封面** (`covers/cover-4x3.png`) | `1600×1200` | **上下纵深阶梯构图（原生 4:3 重排）**: 顶部 `Y = 70..460px` 居中偏左大标题（字号比 16:9 相对更大 15%，确保移动端信息流极小卡片依然一秒读清），顶标胶囊紧贴其上；中下部 `Y = 470..1080px` 宽幅展示 3D 浮岛毛玻璃工作台与完整的 `崩坏3周年庆（动态）` 视觉中心，底部左侧排列 3 枚精简胶囊徽章。 | **避让右下角 (`1320..1600 × 1060..1200`) 时长角标**与四角圆角裁切留白（四周保底 `56px` 安全边距）。 |

---

## 5. 全片隐私、脱敏与真实性核查清单

- [ ] **技术参数 100% 实事求是**（`v1.1.0`、`Steam 431960`、`8.3ms` 冷启动、`2.5ms` 切换、零拷贝 MP4 faststart、`PKGV/LZ4` 场景提取、6 层 `--prism-*` 玻璃、4 预设 + 8 明暗配色、`32×32` 动态取色、WCAG 代码底板、`Ctrl+Alt+W`、普通快捷方式自动加载、0 Token、不改 `app.asar`）。
- [ ] **内容全年龄合规**: 展示壁纸仅含 `崩坏3周年庆（动态）` 与 `@asset-sanitizer` 人工审图通过的全年龄 SFW 壁纸。
- [ ] **个人信息零泄露**: 画面代码、终端、路径栏、标题栏绝不出现任何真实系统用户名、私人目录或 API Key。
