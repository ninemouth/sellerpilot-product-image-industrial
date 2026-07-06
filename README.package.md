# SellerPilot Product Image Industrial Codex Package

工业级 Codex 可用电商产品图生成 Skill / Agent 包。

## 核心定位

这不是一个单点“出图 prompt”，而是一套运行在 SellerPilot 架构下的商品视觉生产系统：

- Harness Engineering：负责图片/URL/画布/证据/导出等执行基座
- Loop Architecture：负责规划、生成、自审、画布反馈、修订、导出的闭环
- Product Image Orchestrator Agent：负责总控调度
- Skill Runtime：将商品理解、平台规范、视觉策略、文案本地化、Codex 原生 GPT 内置生图、QA、修订、导出拆成可维护 Skill；请求包只作为 fallback 或 audit 证据

## 用法

1. 将本目录安装到 Codex skills 目录。
2. 日常在 Codex chat/project 中使用 `$sellerpilot-product-image-industrial` 或自然语言商品图请求触发。
3. 普通生图默认走 fast generation mode；完整审计/迁移证据才走 industrial audit mode。
4. 不要求用户指定生图工具、模型名或运行边界。

## 开发与发布收敛

先在开发目录运行验证：

```bash
npm run verify
```

验证通过后同步到 Codex 已安装 skill：

```bash
npm run sync -- --source /Users/yang/sellerpilot-product-image-industrial
```

同步脚本会先备份已安装版本，再 `rsync --delete` 到 `${CODEX_HOME:-~/.codex}/skills/sellerpilot-product-image-industrial`，最后用 `diff -qr` 验证开发目录和安装目录一致。

## 首发建议

先跑通：商品图 + 商品 URL + Amazon US 7 图套图。
再扩展：竞品图差异化重做、多平台迁移、小红书/TikTok Shop 风格化套图。
