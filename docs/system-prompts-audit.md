# AINovel 系统提示词清单与优化审计（待审核）

> 生成于 2026-07-24。本文仅做**清单与优化空间分析**，**未改动任何代码**。
> 所有定位基于当前代码。原文请按"文件:行号"在编辑器跳转查看。

## 一、总览表

| # | 提示词（函数） | 位置 | 注入时机 | 估算中文字 | 每请求必发？ | 缓存属性 |
|---|---|---|---|---|---|---|
| 1 | 意图分析 `buildIntentionAnalyzerPrompt` | prompt-builder.ts:21-106 | 阶段一，每请求 1 次独立调用 | ~3500 | 是（1 次/请求） | 独立调用，不在主循环前缀 |
| 2 | 静态铁律 `buildStaticSystemMessage` | prompt-builder.ts:264-370 | 主循环第 1 条 system，每轮重发 | ~4000 | 是 | **稳定前缀，命中缓存** |
| 3 | 极简系统 `buildMinimalSystemMessage` | prompt-builder.ts:232-235 | A 类闲聊 | ~40 | 否 | 已最优 |
| 4 | 工具目录 `getToolCatalogPrompt` | tool-prompts.ts:303-318 | 初始聊天（无 predicted 时） | ~500 | 视情况 | 稳定 |
| 5 | 各工具详细提示词 `TOOL_PROMPTS`(11个) | tool-prompts.ts:17-284 | predicted 命中 + auto-resume 按映射 | 最大 write_chapter_content ~3500；其余 250-1200 | 写正文时注入 write_chapter_content | 按需注入，位置稳定可缓存 |
| 6 | JSON 模式调用说明 `jsonModeToolCallInstruction` | prompt-builder.ts:168-224 | 仅 `!useNativeFunctionCalling`（降级） | ~1800 | 否（仅降级） | 同 #2 分支 |
| 7 | 动态上下文 `buildDynamicContextMessage` | prompt-builder.ts:398-427 | 随书/记忆变化 | ~300（外加 memoryText） | 视情况 | 设计为非缓存段 |
| 8 | 工具 schema（description） | tools/*.ts（21 个） | 走 `tools` 参数，非 system | 每 schema ~100-400 | 是（每轮 tools 参数） | 稳定，命中缓存 |

> 注：#2/#4/#8 属主循环稳定前缀，已被前缀缓存覆盖，压缩主要收益是"首次未命中成本 + 模型注意力聚焦"。
> #5 的 `write_chapter_content` 按需注入、是每轮真实体积来源之一，精简它直接省 token。

---

## 二、逐项说明与优化观察

### 1. 意图分析提示词 — `buildIntentionAnalyzerPrompt`
- **位置**：`electron/agent/prompt-builder.ts:21-106`
- **注入**：每次请求的阶段一，单独发 1 次模型调用（不在主循环缓存前缀内，压缩直接影响这 1 次 token）。
- **观察**：
  - 【可优化】示例过多（94-104 共 11 条），部分结构一致可合并（如"写第5章""写一百零二章""写下一章"保留 3-4 条代表性即可）。
  - 【可优化】"上下文需求定义"(55-67) 与"预测工具定义"(69-73) 中，因 JSON schema 已自解释 `true|false`，纯文字定义略冗余，可压成紧凑说明。
  - 【保留】`target` 归一成数字的规则（75-80）很重要，且是你定的铁律（禁止正则），**不能删**。

### 2. 静态铁律系统提示词 — `buildStaticSystemMessage` ⭐最大块
- **位置**：`electron/agent/prompt-builder.ts:264-370`（~4000 字）
- **注入**：主循环第 1 条 system，每轮重发；**稳定前缀，命中缓存**。
- **观察（重复/冗余较多）**：
  - 【重复】意图分类 A/B/C（271-287）与意图分析提示词的意图定义（51-53）重复 → 静态里可删分类大段，分类已由阶段一完成。
  - 【重复】JSON 格式规范（337-345）在**原生 FC 模式**下冗余（模型不手写 JSON 转义），且每个工具提示词又讲一遍 → 静态里精简为"遵循对应工具提示词的格式要求"。
  - 【重复】工具调用铁律（289-320）与 `jsonModeToolCallInstruction` 部分重叠；原生 FC 下 jsonMode 不注入，但"禁止预告文字/自然语言描述意图"等在静态讲即可。
  - 【重复】`is_prerequisite` 在静态（347-354）+ 每个写工具提示词 + jsonMode 各讲一遍 → 静态统一讲一次，工具提示词去重。
  - 【可优化】措辞规范（322-328）术语映射可压成紧凑表。

### 3. 极简系统提示词 — `buildMinimalSystemMessage`
- **位置**：`prompt-builder.ts:232-235`（~40 字）
- 已最优，无需动。

### 4. 工具目录提示词 — `getToolCatalogPrompt`
- **位置**：`tool-prompts.ts:303-318`（~500 字）
- **观察**：
  - 【Bug】末尾 `delete_entity — 删除实体谨慎使用）` 括号不匹配（应为 `（谨慎使用）` 或去掉括号）。
  - 【可优化】与静态铁律/工具 schema 的工具名列表重复，但作为轻量概览可接受，优先级低。

### 5. 各工具详细提示词 — `TOOL_PROMPTS`（11 个）
- **位置**：`tool-prompts.ts:17-284`
- **注入**：`predictedTools` 命中时注入 + auto-resume 按 `NEXT_TOOLS_MAP`（290-299）注入。一次"写第7章正文"主要注入 `write_chapter_content`（~3500 字）。
- **观察**：
  - 【重复】每个工具都重讲 JSON 转义 / `is_prerequisite` / 引号 → 已在静态铁律讲，可精简。
  - 【重复】`write_chapter_content` 写作指南（52-93）与静态"输出格式"（330-335）部分重叠（纯叙事、禁标题行等）。
  - 【重复】`create_volumes`(130-159) 与 `update_volume_outline`(247-257) 的 outline 5 点结构讲了两遍 → 后者统一引用前者。
  - 【可优化】`write_chapter_content` 6 大段写作指南（52-93）很长，可压缩冗余表述；但写作质量依赖它，**谨慎精简**。
  - 注：这部分按需注入、是每轮真实体积，精简收益最直接。

### 6. JSON 模式调用说明 — `jsonModeToolCallInstruction`
- **位置**：`prompt-builder.ts:168-224`（~1800 字）
- **注入**：仅 `!useNativeFunctionCalling`（降级模式）。
- **观察**：与 #2 的 JSON 规范重复（见 #2）。降级模式才用，影响面小，可最后处理。

### 7. 动态上下文消息 — `buildDynamicContextMessage`
- **位置**：`prompt-builder.ts:398-427`（~300 字 + memoryText 体积）
- 已正确设计为**非缓存段**（随书/记忆变化），不影响静态前缀缓存命中，无需动。

### 8. 工具 schema（description）— 走 `tools` 参数
- **位置**：`electron/agent/tools/*.ts`（21 个工具定义）
- **观察**：
  - 【可优化】9 个写工具 schema 被逐个注入 `is_prerequisite` 参数（重复）→ 可改为静态铁律统一说明，schema 移除该参数（省每轮 tools 参数 token）。
  - 【可优化】参数 `description` 可压缩。
  - 注：schema 属 `tools` 参数、稳定前缀、已缓存，压缩收益主要是首次未命中 + 聚焦。

---

## 三、优化优先级建议（均不裁剪上下文、不影响续写连贯性）

| 优先级 | 改动 | 预计省（每请求） | 风险 | 缓存影响（是否动前缀字节） |
|---|---|---|---|---|
| **P0** | **缓存稳定性修复**：① next-step 提示词移到 predicted 工具**之后**；② predicted 遍历按固定注册顺序排序 | 不直接省 token，但保住跨请求缓存命中 | 低 | 改 messages 组装顺序 → 已建缓存一次性重置，之后跨请求稳定不抖动 |
| P1 | #2 删与意图分析重复的"意图分类"大段 + JSON 规范精简 | 静态前缀 ~600-800 字 | 低 | 改静态铁律 → 前缀字节变 → 已建缓存一次性失效后更短更稳 |
| P2 | #5 工具提示词去重（JSON/is_prerequisite/重复 outline 结构），主攻 write_chapter_content | 写正文时 ~500-1500 字 | 低（保写作指南核心） | 改 TOOL_PROMPTS + 注入顺序 → 前缀变 → 一次性重置 |
| P3 | #8 写工具 schema 移除 `is_prerequisite` 参数（统一到铁律） | 每轮 tools ~150-250 字 ×9 | 低 | 改 tools 参数 schema → 重置一次 |
| P4 | #4 修 TOOL_CATALOG 括号 bug | 0（质量） | 无 | 改工具目录文本 → 前缀变 → 重置一次（极短） |
| P5 | #1 意图分析示例合并 | 阶段一 ~500-800 字 | 低（保 target 规则） | 阶段一独立调用，**不影响主循环前缀** |
| — | #6 降级模式 JSON 说明 | 仅降级模式 | 低，可最后做 | 仅降级分支，影响面小 |

---

## 四、关键提醒
- #2/#4/#8 已在前缀缓存内，账单已是折扣价；压缩它们的价值是"降低首次未命中成本 + 让模型注意力更聚焦 + 缩短稳定前缀"。
- #5（尤其 write_chapter_content）是按需注入的真实体积，精简收益最直接、最值得先做。
- 全部为**未改动代码**的现状清单，等你确认要改哪些后再动。

---

## 五、缓存稳定性硬约束（用户提醒：上下文位置不能变动）

### 5.1 规则
前缀缓存（prompt caching）只认 `messages` 数组**从开头起的连续前缀**，且字节必须逐字一致。只要前缀中任一条变动（增 / 删 / 改 / 顺序调整），从该位置往后的缓存**全部失效、按全价重算**。推论：
- 任何优化都**不能改变稳定前缀的相对顺序**；
- 不能把"有时有、有时无"的块插进稳定前缀**中间**；
- 任何对提示词 / 工具 schema 的修改本身 = 改变前缀字节 = **一次性缓存重置**（改完首次请求全价，但之后是更短前缀、更稳，长期收益为正）。

### 5.2 当前实现已合规 ✅
- `messages` 在**循环外构建一次**（agent-runner.ts:868），主循环内只追加 assistant / tool 结果 → 同一请求的多轮之间前缀字节完全不变，缓存跨轮续命。
- 顺序设计正确：`铁律 → 工具目录 → next-step → predicted 工具 → 预加载 → 历史 → 用户`（稳定块在前、历史在后、用户在最后）。
- 预加载 `contextParts` 由 `buildWriteContextParts` 等按**固定代码顺序** push（卷纲 → 章纲 → 上章纲 → 上章正文 → 下章纲 → 记忆），顺序固定 ✅。
- 工具 schema 走 `tools` 参数（非 system 文本），单独命中缓存，与 system 前缀解耦。

### 5.3 需要修的隐患 ⚠️
1. **【顺序抖动】next-step 提示词插在 predicted 工具提示词之前**（agent-runner.ts:879-884 位于 888-894 之前）。auto-resume 场景下它"有时有、有时无"，且插入位置在 predicted 工具之前，会把后面所有块（predicted、预加载、历史）整体推后 → 跨请求前缀分叉、缓存失效。**修复**：移到 predicted 工具提示词**之后**（或预加载之后）。
2. **【顺序抖动】predicted 工具提示词遍历顺序依赖 LLM 返回数组顺序**（agent-runner.ts:889 `for (const toolName of predictedTools)`）。模型若返回 `[a,b]` 与 `[b,a]` 顺序不同 → 前缀字节变 → 缓存失效。**修复**：按固定注册顺序排序后再注入。
3. **【改则重置】所有提示词 / schema 精简**都会改变前缀字节，导致已建缓存一次性失效（非持续失效，改后更短更稳）。应**批量合并修改**，避免反复小改导致反复重置。

### 5.4 结论
当前主循环已遵循"稳定前缀在前"的核心规则，缓存能跨轮续命；上述 #1/#2 属"跨请求抖动"隐患，优先级**高于**纯文本精简（已列为 P0）。建议先修 P0 再动提示词文本，且所有文本改动合并到一次提交。
