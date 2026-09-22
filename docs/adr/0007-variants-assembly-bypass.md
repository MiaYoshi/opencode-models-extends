# variants 经 transform 注入会被覆盖,用配置条目空标记绕过

v2.0.14 黑盒实验 + 源码确认(`packages/core/src/config/plugin/provider.ts`,内置插件 `opencode.config.provider`):模型 `variants` 的最终装配发生在**外部插件 `ctx.model.transform` 之后**(该插件注释明言 "late registration position, after external model transforms",transform 重放按注册顺序,见 `packages/core/src/state.ts`)。规则以**配置条目**为数据源,分两条路径:

- 条目**声明过** `variants`(哪怕空数组/空对象)→ 按 id merge 到当前 draft.variants 之上(不删除插件已写入的其它条目);
- 条目**完全没声明** → 按 `FL[package]` 表 + 模型名启发式**自动装配并整字段覆盖**(openai 包 = effort 六件套;openai-compatible 兜底 = low/medium/high;deepseek-v4/qwen/kimi/glm 等有专属模板),插件注入值全灭。

`Model.Info.variants` 不读 transform 的 draft 写入本身(draft 值确实在 transform 内可见,但装配层从不回读它作 fallback——伪造 `package` 使自动装配返回 `[]` 后,最终 variants 是 `[]` 而非 draft 的那份)。

**绕过方案(实测全绿)**:锚点模型条目加一个空标记 —— V2 `"variants": []` 或 V1 `"variants": {}`(V1 迁移把 `{}` 变成 `[]`,两者都让 `config.variants !== undefined` 成立)。装配即切到 merge 路径:空数组无条目可叠、自动装配被跳过,模板注入的 variants 原样存活;若条目声明了真实 variants,则按"用户 > 模板"的既有优先级叠在模板值上。limit/settings/capabilities 等其它字段不受影响(本就走 transform)。

据此:插件仍把模板 variants 合并写进 draft(绕过生效时的实际载荷);数据集构建期对「模板链提供了 variants 且条目无空标记」的锚点输出一条警告,文案直接给出加标记的方法。

## Consequences

- 模板去重对 variants **可用**,代价是每个使用模板 variants 的配置条目多一行空标记;这行标记是 OpenCode 侧的装配开关,不是插件自定义语义,README 必须解释清楚,否则用户会以为是冗余噪声随手删掉。
- 该行为是 v2.0.14 的实现细节(内置插件在 transform 链尾部合并 config 条目),若官方未来把 variants 装配也改为读 transform 输出或提供开关,警告文案可撤、标记可废弃,插件合并逻辑无需改动。
- 警告放在构建期并区分「条目有无标记」:带标记时一切正常必须静默;V1 `options` 里放 `variants` 键无效(顶层字段),normalize 层的既有键校验会提示。
