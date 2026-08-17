# SellerPilot Product Image Orchestrator

## Mission

把商品原图/URL、竞品参考、平台、语言、人群与风格要求转为身份可信、平台适配、可审核且可局部修复的正式商品图。减少重复解析、串行等待、无效 provider 调用及上下文/I/O，不牺牲质量证据、QA 或成图质量。

## Canonical control plane

所有新 run 使用以下权威链路：

```text
planning/normalized-task.json
  -> contracts/production-contract.json + contracts/platform-overrides.json
  -> planning/compiled-production-plan.json
  -> orchestration/tasks.json + dispatcher-registry.json + generation-jobs.json
  -> run-state.json + telemetry
```

- 不得重复用正则从长用户文本推断同一事实；mode router、efficiency plan、brief、compiler、provider 与 QA 读取 normalized task。
- 不得手工编写标准 tasks.json，不得把 workflow YAML 或并行表格当作实际调度证据。
- 每个 task 必须绑定 execution class：确定性命令、结构化 agent handoff、generation controller、delivery closure 或 human pause。
- agent handoff 只加载 task-specific context pack、rule IDs 和依赖证据；不得把全部 references/prompts 塞入每一步。
- 缓存指纹包含 normalized task、生产契约、平台覆盖、显式输入、依赖输出 hash、dispatcher 和 provider/generation spec 证据。

## First gates

1. 所有 production request 的第一步必须运行 skill update check。`current` 静默继续；`update_available` 在用户选择前不得进入规划、源图分析、生图、QA 或画布；`unknown_*` 可继续但不得声称已是最新。
2. normalize once，并写 `planning/normalized-task.json`。
3. compile plan；同时生成 efficiency plan、dispatcher registry、generation jobs 与 run state。
4. provider 只解析一次并固定 digest；后续每个角色必须复用当前 run 的 resolution。
5. Brief Intake 最多问 1–3 个高价值问题。低风险缺口写成假设；已有源图的 run 不得误报缺少源图。

## Quality floor

以下规则不可因性能优化而放宽：

- 不编造商品事实、材质、尺寸、认证、安全/医疗、防水/防火/承重/兼容、品牌授权、销量或促销；无证据 claim 必须移除或标风险。
- 竞品仅用于模式分析；不得复制品牌、文案、商品身份或具体视觉构图。
- 源商品身份必须保持：轮廓、颜色、材质、结构、组件、五金、开口、肩带/提手路径、内里、比例、纹理、走线和可见微细节。模糊小字/刻字/Logo 只保留位置与不可读形状，不脑补。
- 参考图先做 preflight：保留 byte-identical `analysis_path`；仅在超字节/尺寸或格式不兼容时创建高质量 `provider_path`。逐图深读并写 full evidence、annotations 和不超过 12 KB 的 compact summary。
- 每个角色按最终 prompt/逐图贡献/provider cap 选择 1–2 张用户自有图并写 selection report；不得附带全部输入，竞品或归属未确认图不得进入产品生成请求。
- 源图文字 AI 视觉优先；只有不确定、小字、风险规格或用户明确要求时才 OCR。确认与不确定事实都要进入 identity/geometry/physical/copy/prompt/QA。
- 物理功能、安装、使用动作或尺度敏感商品，provider 前必须有 physical truth lock 与 fact gate；禁止生造磁吸、胶粘、按压锁定、防水、承重、活动件、尺寸和错误动作。
- 印花/提花/织物、穿戴甲、美甲贴、纹身贴、贴纸等使用 canonical surface material。锁定色彩、色温、亮度、渐变、纹理、形状与目标表面；生成后做逐材质/逐区域 transfer proof 与 visual gate。
- 正式可见文案先过 copy strategy 与低成本 text-layout proof；俄/德/阿等本地化还需 translation QA、回译/语义/脚本方向检查和最终 raster visible-text review。
- 使用/场景图必须有真实 generated/photo scene 证据；矢量装饰、重复图案、白卡贴图或确定性合成不得冒充真实场景。
- card/信息图/白卡优先使用透明或 card-safe 母版；可见矩形灰白底残留或 card 背景不一致必须局部返工。
- 最终图默认禁止平台套图角标、水印、AI/系统标记、SellerPilot/Codex 等非买家信息。精确可见水印必须有用户明确的文本、位置、用途与适用图片授权。
- 所有生成、修复、复用、裁切、local overlay、personalized compositor 都要记录 lineage。历史缺失 lineage 先 backfill，不得整套重生图掩盖元数据缺口。
- 每个 run 独立 `run_id`、目录、manifest、progress、QA、overview（多图）与 final gate；不得读取父目录、共享 outputs 或其他任务图片。
- 不自动发布/上传平台，不承诺 CTR/CVR/ROAS/ACOS/排名/销量。

细节规范按触发加载 [references/quality-critical-contract.md](references/quality-critical-contract.md) 及对应 source/identity/physical/surface/copy/scene/QA reference。

## Generation and repair

- 单张正式图允许直接生成；仍需独立 final image、manifest、触发 QA、final gate 和 tldraw ready/blocked 结果。
- 多图必须 anchor-first：fast 低风险 1 张、普通 quality 2 张、高风险 identity/physical/surface 组合最多 3 张。Anchor QA 未记录 `continue/pass/approved` 时不得调度剩余角色。
- Anchor 后剩余独立角色并发最多 2。不得在方向未验证前并发整套。
- provider retry 必须有 prompt/source/provider/model 或上游证据变化；同签名超过预算进入 `blocked_retry_budget_exhausted`。
- 同类 provider 失败达阈值后运行 circuit breaker；停止堆同类 prompt。可复核批准资产、局部降级场景、合规衍生或等待明确高成本重试决定。
- QA 失败返回最早责任节点，只重跑受影响角色/区域/布局。Final Delivery Gate 只聚合，不是根因节点；delivery closure 不得生成图片。
- 已批准资产复用必须写 reuse manifest，provider 时间、asset reuse 与 local compositor 时间分别统计。

## Provider boundary

- resolver 输出的 `selected_mode` 是唯一执行权限。run-state 中的 provider digest 与 resolution 不一致时 fail closed。
- native 只使用系统 `imagegen` / `image_gen`，并通过 handoff + host callback + ledger 记录真实证据。
- third-party 只执行已固定的 runtime/profile/model/endpoint。ready 配置已覆盖参考图上传、请求、下载、重试与交付，不再次询问用户是否发送参考图。
- dispatch/native/third-party runtime 均强制参考图数量、单图和总字节上限；超限返回 preparation/selection，不静默删图、压原图或继续发送。
- host/组织阻止既定 route 记 `external_provider_host_policy_blocked`；普通不可达记 `external_provider_transport_unavailable`。均不算远端失败、不耗 failure retry、不换 route 或生成本地假正式图。
- API key、raw endpoint、请求/响应体、curl/network 细节与本机路径仅进内部诊断，不进入用户消息。

## QA and delivery

正式交付至少验证：

- source/identity/geometry/physical/surface（按触发）；
- copy/text layout/localized final raster（按触发）；
- marketing diversity、真实场景、card/background；
- export count/name/resolution/platform ratio、run-local manifest；
- progress 与 anchor decision 一致；
- lineage、provider/native ledger、artifact integrity；
- QA loop routing、overview（多图）、tldraw、final delivery。

总览不替代独立 final。导出后说明 final 数量及 overview/tldraw/final gate 收口且不会重生图；超过 15 分钟或 export 后运行 watchdog，`ready_but_not_closed` 只补 closure。

tldraw 复用预热服务，生产时不装依赖；workspace 不复制 `node_modules`，图片优先 hardlink，同 fingerprint 复用 session。原图是 DOM floor，tldraw 仅承载标注，未标注图默认批准。

## Telemetry and performance

- `telemetry/phase-events.jsonl` 是真实 task/provider span；mtime 只能标 `estimate_only`，不得作为 SLA。
- 收集 wall time、input/output bytes、provider first byte/response/download、context bytes、agent estimated/actual tokens、cache hit、provider usage/cost source 与状态转换。
- `planning/production-efficiency-plan.json` 的秒数是 run-local budget，不是实测 SLA；不得用它证明性能提升。
- `agent-context-ledger.jsonl` 记录 context pack 与 host usage。Token 优化使用 rule IDs 与依赖证据，禁止粗暴 output-token cap 或删质量 schema。
- 全局 timeout/concurrency/retry 只能基于 `provider-telemetry-summary.mjs` 的多 run 样本；报告为 `insufficient_sample` 时不得改全局 provider 参数，只能做 run-local 修复或继续采样。

## Permission and user communication

权限不足且必要动作无法继续时，必须用用户能理解的能力名请求授权（如启动本地审核服务、联网检查更新、同步 skill）；不暴露 sandbox、raw network/curl、本机路径或 key。ready 第三方 route 不重复问上传授权，host policy block 只要求环境/组织允许同一路由。

长耗时过程至少每 5 分钟给出简短状态；只报告已完成、待处理、当前阶段和最小下一步，不输出内部诊断。失败时说明受影响资产、已保留资产与安全下一步。

## Definition of done

开发/修复任务完成需满足：

1. 相关 producer -> persisted artifact -> consumer -> state/user-visible decision 已闭环。
2. 新行为有聚焦测试；默认静态/unit/proxy 与适用 integration suite 通过。
3. `verify:all` 或明确登记的全量套件无陈旧源码 token 断言；子进程有 timeout/cleanup。
4. `git diff --check` 通过，未改动无关用户工作。
5. 明确区分当前验证、历史证据、推断和仍需真实 provider/人工盲评的数据。

生产图片 Definition of Done 见 [references/output-contract.md](references/output-contract.md)；完整命令见 [references/production-runtime-runbook.md](references/production-runtime-runbook.md)。
