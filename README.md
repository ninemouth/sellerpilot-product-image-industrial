# SellerPilot Product Image Industrial

面向 Codex 的工业级电商商品图套图制作 skill。它不是一个“万能出图 prompt”，而是一套把商品理解、平台规范、营销文案、图像生成、QA、总览图和 tldraw 批注修订串起来的生产流程。

如果你是第一次接触 Codex skill，可以把它理解成：

- `SKILL.md`：给 Codex 看的操作手册。
- `scripts/`：可重复执行的检查、导出、画布、QA 小工具。
- `references/`、`platform-profiles/`、`workflows/`：按需读取的行业规则和流程资料。
- `assets/tldraw-review-workspace/`：用于看图、批注、截图回传的本地画布工作台。

## 它能做什么

- 根据商品原图、商品 URL、竞品参考图、目标平台、国家/语言、目标人群和风格要求，规划并生成电商商品图套图。
- 支持 Amazon、TikTok Shop、小红书、拼多多、抖音、Temu、Shopee/Lazada、Etsy、Mercado Libre、SHEIN、Ozon、Wildberries 等平台基线。
- 在正式生产前，为粗略需求给出 2-3 个商业方向；用户不选时，harness 会自动选择一个方向继续。
- 从源图中提取商品身份、可见文字、尺寸线索、材料/结构/功能信息，并把这些事实传递到后续图像生成和 QA。
- 针对时令、气候、节假日、区域趋势和营销热词创建平台上下文计划。
- 对最终图片文案做策略 gate，避免无证据的夸张卖点、内部 QA 语言、平台水印或系统标记。
- 用身份一致性、几何比例、物理功能、导出规范、总览图和 QA loop guard 降低“生造功能”“商品变形”“多任务图片串流”等风险。
- 在需要视觉审核时启动 tldraw 画布，让用户直接批注，然后把批注转换成修订任务。

## 它不能做什么

- 不能保证 CTR、CVR、ROAS、ACOS、销量或排名提升。
- 不能替你发布、上传或上架商品。
- 不能编造认证、安全、防水、防火、医疗、儿童/宠物安全等高风险声明。
- 不能把竞品图当成你的商品原图，也不能复制竞品视觉。
- 不能在没有源图或明确证据时声称“身份保持一致”。
- 不能把确定性 layout draft 冒充最终 AI 生成图。

## 准备环境

推荐环境：

- Codex Desktop 或支持本地 skills 的 Codex 环境。
- Node.js 20 或更新版本。
- npm。
- 可选：`tesseract`，用于本地 OCR 读取源图文字。
- 可选：Google Chrome、Microsoft Edge 或 Playwright 浏览器，用于 HTML/画布渲染。

Codex runtime 通常已经带有 `sharp` 和 `playwright`。普通 Node 环境可以运行：

```bash
npm install
```

## 安装到 Codex

把仓库 clone 到任意开发目录：

```bash
git clone https://github.com/ninemouth/sellerpilot-product-image-industrial.git
cd sellerpilot-product-image-industrial
```

验证开发目录：

```bash
npm run verify
```

同步到 Codex skills 目录：

```bash
npm run sync -- --source "$PWD"
```

默认安装位置是：

```text
${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial
```

同步脚本会先备份旧版本，再把当前仓库同步到 Codex skills 目录，并验证两边文件一致。

## 最快上手

安装后，在 Codex 对话里可以这样说：

```text
请使用 $sellerpilot-product-image-industrial，根据这张商品原图，为 Amazon US 做 7 张 listing 图片。
```

或者更自然一点：

```text
这是一款女包，目标平台拼多多，帮我做 8 张商品套图，风格偏通勤轻奢。
```

如果信息足够，skill 会继续推进；如果缺少会影响质量或真实性的关键信息，它只会问 1-3 个高价值问题。低风险缺口会用明确假设继续。

## 推荐输入

效果最好时，给 Codex：

- 商品主图或多角度源图。
- 商品链接。
- 目标平台和国家/语言。
- 希望生成几张图。
- 商品卖点或不能夸大的点。
- 可参考但不能复制的竞品图。
- 目标人群、季节、使用场景或风格偏好。

如果源图里有文字、尺寸、型号、警告、材料、兼容性或安装信息，skill 会尝试识别并锁定这些事实。

## 输出通常包含

Fast generation mode 默认输出：

- 独立的最终图片文件。
- 稳定 ID + 英文用途 slug 的文件名。
- 商品身份锁和源图理解摘要。
- 镜头矩阵或场景策略摘要。
- QA 结论。
- 多图套图的 `overview/SET-OVERVIEW-contact-sheet.png` 总览图。
- 需要批注时的 tldraw review session。

Industrial audit mode 会额外输出完整的 fact sheet、策略、prompt layer、gate report、QA loop routing、修订历史和导出包摘要。

## 常用脚本

验证整个 skill：

```bash
npm run verify
```

创建任务目录：

```bash
node scripts/create-run-skeleton.mjs \
  --out-dir runs/demo-amazon-bag \
  --platform "Amazon" \
  --category "women bag" \
  --product-name "demo bag"
```

创建平台上下文计划：

```bash
node scripts/platform-context-planner.mjs \
  --run-dir runs/demo-amazon-bag \
  --platform "Amazon" \
  --category "women bag" \
  --season "summer"
```

运行 QA loop router：

```bash
node scripts/qa-loop-router.mjs --run-dir runs/demo-amazon-bag
```

同步到 Codex：

```bash
npm run sync -- --source "$PWD"
```

## QA 和防循环机制

这个 skill 的 QA 不是装饰性报告。关键 gate 失败后，`qa-loop-router.mjs` 会判断最早应该回到哪个节点，只重跑受影响的资产或布局。

同一个失败签名会记录在：

```text
qa/qa-loop-state.json
```

如果同一失败超过 retry budget，router 会输出：

```text
blocked_retry_budget_exhausted
```

这表示必须停止自动重生图，改为请求更好的源图、用户事实确认、方向调整或人工接受阻塞状态。

## 目录结构

```text
.
├── SKILL.md                         # Codex 触发后读取的主说明
├── AGENTS.md                        # 项目级执行规则
├── scripts/                         # 验证、导出、画布、QA、同步脚本
├── references/                      # 按需读取的细分规则
├── platform-profiles/               # 平台基线
├── workflows/                       # 平台/场景工作流
├── templates/                       # 结构化产物模板
├── policies/                        # 风险和 QA 边界
├── assets/tldraw-review-workspace/  # 本地批注画布
├── tests/                           # 行为用例说明
└── work/                            # 本地临时开发产物，不应提交真实任务输出
```

## 安全和合规边界

- 不要把用户私有商品图、竞品素材或真实客户数据提交到这个仓库。
- `runs/`、`outputs/`、`work/*` 默认被 `.gitignore` 排除。
- 生成图片前要保留源商品身份：形状、颜色、材质、结构、核心组件。
- 涉及认证、安全、医疗、防水、防火、儿童/宠物安全等声明时，必须有证据，否则标记风险或移除。
- 竞品图只能用于差异化分析，不能复制布局、品牌、视觉资产或文案。

## 故障排查

`npm run verify` 提示缺少 `sharp` 或 `playwright`：

```bash
npm install
```

tldraw 画布无法启动：

```bash
cd assets/tldraw-review-workspace
npm install
npm run build
```

OCR 没有结果：

- 确认系统安装了 `tesseract`。
- 源图文字太小、模糊或倾斜时，需要更清晰的近拍图。

最终交付被 QA 阻塞：

- 查看 `qa/qa-loop-routing-decision.json`。
- 查看 `qa/qa-loop-state.json` 是否已经超过重试预算。
- 按 `return_node` 修最小上游节点，不要整套重做。

## 开源协议

MIT License。详见 [LICENSE](LICENSE)。
