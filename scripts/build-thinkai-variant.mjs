#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const variantName = "sellerpilot-product-image-industrial-thinkai";
const outDir = path.join(root, "dist", variantName);

const excludedDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "runs",
  "outputs",
  ".cache",
]);
const excludedFiles = new Set([
  ".DS_Store",
  ".sellerpilot-skill-release.json",
  ".thinkai-image-runtime.json",
]);

fs.rmSync(outDir, { recursive: true, force: true });
copyTree(root, outDir);
applyThinkAiVariant(outDir);

console.log(JSON.stringify({
  status: "built",
  variant: variantName,
  out_dir: outDir,
}, null, 2));

function copyTree(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const name = path.basename(src);
    if (src !== root && excludedDirs.has(name)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (excludedDirs.has(entry.name) || excludedFiles.has(entry.name)) continue;
      copyTree(path.join(src, entry.name), path.join(dest, entry.name));
    }
    return;
  }
  fs.copyFileSync(src, dest);
}

function applyThinkAiVariant(baseDir) {
  replaceInFile(path.join(baseDir, "SKILL.md"), [
    [/^name:\s*sellerpilot-product-image-industrial$/m, `name: ${variantName}`],
    [
      /^description: (.+)$/m,
      "description: ThinkAI gpt-image-2 variant of SellerPilot Product Image Industrial. Use when Codex needs to create, plan, review, or revise ecommerce product image sets and store unified visual style memory through the ThinkAI OpenAI-compatible image runtime with model gpt-image-2. Trigger for 店铺统一风格, store style memory, 商品图, 产品图, and ecommerce image-set production.",
    ],
    [
      /Actual production image generation defaults to Codex-native GPT built-in image generation[\s\S]*?Use that native path for real raster outputs unless the user explicitly selects the ThinkAI `gpt-image-2` provider\./,
      "Actual production image generation defaults to the ThinkAI OpenAI-compatible image runtime in this package, using model `gpt-image-2`. In Codex chat/project contexts, the normal execution layer is `scripts/thinkai-image-runtime.mjs`; do not use the Codex `imagegen` skill / `image_gen` tool as the production default for this ThinkAI variant.",
    ],
    [
      /It may call the system `imagegen` skill \/ built-in `image_gen` as the default production execution layer, or the repo-local ThinkAI runtime when explicitly selected; it must not create one-off image-generation wrappers, silently switch to API\/CLI fallback, or claim deterministic layout drafts as final generated product images\./,
      "It may call only the repo-local ThinkAI runtime as the production execution layer; it must not create one-off image-generation wrappers, silently switch to another API/CLI fallback, or claim deterministic layout drafts as final generated product images.",
    ],
    [/attempt Codex-native built-in image generation through the system `imagegen` skill \/ built-in `image_gen` tool when available, unless the user explicitly selects ThinkAI `gpt-image-2`/, "attempt ThinkAI `gpt-image-2` generation through `scripts/thinkai-image-runtime.mjs` when available"],
    [/Codex-native image generation/g, "ThinkAI `gpt-image-2` generation"],
    [/sellerpilot-product-image-industrial\/scripts\/thinkai-image-runtime\.mjs/g, "sellerpilot-product-image-industrial-thinkai/scripts/thinkai-image-runtime.mjs"],
    [/sellerpilot-product-image-industrial\/\.thinkai-image-runtime\.json/g, "sellerpilot-product-image-industrial-thinkai/.thinkai-image-runtime.json"],
    [/\$\{CODEX_HOME:-\$HOME\/\.codex\}\/skills\/sellerpilot-product-image-industrial(?!-thinkai)/g, "${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial-thinkai"],
    [/Use bundled scripts for deterministic support work\. They do not replace Codex-native image generation\./, "Use bundled scripts for deterministic support work. They do not replace the ThinkAI `gpt-image-2` production runtime."],
  ]);

  replaceInFile(path.join(baseDir, "AGENTS.md"), [
    [/Codex-Native GPT Built-In Image Generation Anchor Batch/g, "ThinkAI gpt-image-2 Anchor Batch"],
    [
      /生产级生图目标提供方默认是 Codex\/GPT 内置生图能力。Codex chat\/project 中默认通过系统 `imagegen` skill \/ 内置 `image_gen` 工具执行真实栅格生图。用户明确选择 ThinkAI 版或 `gpt-image-2` provider 时，才使用本仓库 `scripts\/thinkai-image-runtime\.mjs`。/,
      "生产级生图目标提供方必须是 ThinkAI OpenAI-compatible 图片运行时，固定模型使用 `gpt-image-2`。Codex chat/project 中默认通过本包 `scripts/thinkai-image-runtime.mjs` 执行真实栅格生图，不使用 Codex 的 `imagegen` skill / `image_gen` 工具作为生产默认路径。",
    ],
    [
      /不得自造一次性生图 wrapper、静默切换 API\/CLI fallback，或把确定性 layout draft 冒充最终生成图。允许把系统 `imagegen` \/ `image_gen` 作为 Codex 原生执行层；用户显式选择 ThinkAI provider 时，允许使用本仓库 `scripts\/thinkai-image-runtime\.mjs`。/,
      "不得自造一次性生图 wrapper、静默切换其他 API/CLI fallback，或把确定性 layout draft 冒充最终生成图。允许且仅允许把本包 ThinkAI `gpt-image-2` runtime 作为生产执行层；运行时不可用时必须标记 blocked 或输出 request pack。",
    ],
    [/Codex-native imagegen\/image_gen anchor batch execution/g, "ThinkAI gpt-image-2 runtime anchor batch execution"],
  ]);

  replaceInFile(path.join(baseDir, "references", "gpt-built-in-image-generation-policy.md"), [
    [
      /The required production generation provider[\s\S]*?runtime with model `gpt-image-2`\./,
      "The required production generation provider for this ThinkAI variant is the ThinkAI OpenAI-compatible image runtime in this package, using model `gpt-image-2`. In Codex chat/project contexts, the exposed native execution layer is `scripts/thinkai-image-runtime.mjs`.",
    ],
    [
      /Do not create ad-hoc SDK\/API wrappers[\s\S]*?or emit the request pack as audit evidence\./,
      "Do not create ad-hoc SDK/API wrappers, silently use another CLI/API fallback, or treat deterministic renderers as model generation. If the ThinkAI runtime cannot execute the request, stop with `blocked_runtime_unavailable` or emit the request pack as audit evidence.",
    ],
    [/codex_native_imagegen_or_host_app_executes_generation/g, "thinkai_gpt_image_2_runtime_executes_generation"],
    [/  - system imagegen skill\n  - built-in image_gen tool\n  - scripts\/thinkai-image-runtime\.mjs when ThinkAI provider is explicitly selected/, "  - scripts/thinkai-image-runtime.mjs\n  - ThinkAI OpenAI-compatible images API"],
    [/silent CLI\/API fallback/g, "silent non-ThinkAI CLI/API fallback"],
    [/After Codex, ThinkAI, or the host app executes generation/, "After the ThinkAI runtime or the host app executes generation"],
    [/Codex-native `imagegen` \/ `image_gen`/g, "ThinkAI `gpt-image-2` runtime"],
  ]);

  replaceInFile(path.join(baseDir, "templates", "gpt-built-in-image-generation-prompt-template.md"), [
    [/codex_native_imagegen_or_host_app_executes_generation/g, "thinkai_gpt_image_2_runtime_executes_generation"],
    [/system imagegen skill \/ built-in image_gen tool when running in Codex/g, "scripts/thinkai-image-runtime.mjs with gpt-image-2 when running in Codex"],
  ]);

  for (const workflow of fs.readdirSync(path.join(baseDir, "workflows")).filter((file) => file.endsWith(".yaml"))) {
    const file = path.join(baseDir, "workflows", workflow);
    replaceInFile(file, [
      [/execute through Codex-native imagegen\/image_gen/g, "execute through ThinkAI gpt-image-2 runtime"],
      [/execute generation through Codex-native or host runtime/g, "execute generation through the ThinkAI gpt-image-2 runtime or host runtime"],
      [/  - generation-runtime-execution-boundary\n/g, "  - generation-runtime-execution-boundary\n  - thinkai-gpt-image-2-runtime-execution-if-runtime-available\n"],
      [/use_codex_native_imagegen_image_gen_when_available: true/g, "use_thinkai_gpt_image_2_runtime: true"],
    ]);
  }

  replaceInFile(path.join(baseDir, "scripts", "create-run-skeleton.mjs"), [
    [/codex_native_imagegen_or_host_app_executes_generation/g, "thinkai_gpt_image_2_runtime_executes_generation"],
    [/system imagegen skill \/ built-in image_gen tool when running in Codex/g, "scripts/thinkai-image-runtime.mjs with model gpt-image-2"],
    [/"  generation_status: request_pack_pending_only_for_fallback_or_audit",/, [
      '"  generation_status: request_pack_pending_only_for_fallback_or_audit",',
      '  "  runtime:",',
      '  "    base_url: https://www.thinkai.tv/v1",',
      '  "    model: gpt-image-2",',
      '  "    script: scripts/thinkai-image-runtime.mjs",',
    ].join("\n")],
    [/silent CLI\/API fallback/g, "silent non-ThinkAI CLI/API fallback"],
    [/Codex-native `imagegen` \/ `image_gen` or host app executes generation/g, "ThinkAI `gpt-image-2` runtime or host app executes generation"],
    [/In Codex, use the system `imagegen` skill \/ built-in `image_gen` tool when available\./g, "In Codex, use `scripts/thinkai-image-runtime.mjs`; do not use the Codex `imagegen` skill / `image_gen` tool as the production default."],
    [/execution_boundary: "codex_native_imagegen_or_host_app_executes_generation",/, [
      'execution_boundary: "thinkai_gpt_image_2_runtime_executes_generation",',
      '        runtime_script: "scripts/thinkai-image-runtime.mjs",',
      '        model: "gpt-image-2",',
    ].join("\n")],
  ]);

  replaceInFile(path.join(baseDir, "scripts", "production-mode-router.mjs"), [
    [/"imagegen"/g, '"thinkai-gpt-image-2"'],
    [/"anchor-batch-imagegen"/g, '"anchor-batch-thinkai-gpt-image-2"'],
  ]);

  replaceInFile(path.join(baseDir, "README.md"), [
    [/sellerpilot-product-image-industrial/g, variantName],
    [/Codex imagegen 原版/g, "ThinkAI gpt-image-2 版"],
  ]);

  replaceInFile(path.join(baseDir, "agents", "openai.yaml"), [
    [/display_name:\s*"SellerPilot Product Image"/, 'display_name: "SellerPilot Product Image ThinkAI"'],
    [/short_description:\s*".+"/, 'short_description: "Generate and review ecommerce product images with the ThinkAI gpt-image-2 runtime, industrial workflow, QA gates, and optional tldraw canvas."'],
    [/default_prompt:\s*".+"/, `default_prompt: "Use $${variantName} to generate an ecommerce product image or image set with ThinkAI gpt-image-2 from my product image, product facts, and target platform."`],
  ]);

  replaceInFile(path.join(baseDir, "package.json"), [
    [/"name": "sellerpilot-product-image-industrial"/, `"name": "${variantName}"`],
  ]);

  applyGlobalVariantText(baseDir);
}

function replaceInFile(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  fs.writeFileSync(file, text);
}

function applyGlobalVariantText(baseDir) {
  for (const file of listTextFiles(baseDir)) {
    replaceInFile(file, [
      [/execute through Codex-native imagegen\/image_gen when available/g, "execute through ThinkAI gpt-image-2 runtime when available"],
      [/execute real image generation through the system `imagegen` skill \/ built-in `image_gen` tool when available/g, "execute real image generation through the ThinkAI OpenAI-compatible image runtime (`scripts/thinkai-image-runtime.mjs`) with `gpt-image-2` when available"],
      [/execute real raster generation through the system `imagegen` skill \/ built-in `image_gen` tool when available/g, "execute real raster generation through the ThinkAI OpenAI-compatible image runtime (`scripts/thinkai-image-runtime.mjs`) with `gpt-image-2` when available"],
      [/the system `imagegen` skill \/ built-in `image_gen` tool as the execution layer/g, "`scripts/thinkai-image-runtime.mjs` with model `gpt-image-2` as the execution layer"],
      [/system `imagegen` skill \/ built-in `image_gen` tool/g, "ThinkAI OpenAI-compatible image runtime (`scripts/thinkai-image-runtime.mjs`) with `gpt-image-2`"],
      [/system imagegen skill \/ built-in image_gen tool/g, "ThinkAI OpenAI-compatible runtime script with gpt-image-2"],
      [/Codex-native image generation/g, "ThinkAI `gpt-image-2` generation"],
      [/Codex-native `imagegen` \/ `image_gen`/g, "ThinkAI `gpt-image-2` runtime"],
      [/Codex-native imagegen\/image_gen/g, "ThinkAI gpt-image-2 runtime"],
      [/codex_native_imagegen_or_host_app_executes_generation/g, "thinkai_gpt_image_2_runtime_executes_generation"],
      [/codex_native_imagegen_or_host_runtime_executes_generation/g, "thinkai_gpt_image_2_runtime_executes_generation"],
      [/use_codex_native_imagegen_image_gen_when_available/g, "use_thinkai_gpt_image_2_runtime"],
      [/anchor-batch-imagegen/g, "anchor-batch-thinkai-gpt-image-2"],
      [/silent CLI\/API fallback/g, "silent non-ThinkAI CLI/API fallback"],
    ]);
  }
}

function listTextFiles(baseDir) {
  const found = [];
  const stack = [baseDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (/\.(md|mjs|json|ya?ml|txt)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  }
  return found;
}
