# extends 字段放在 settings/options 内而非模型顶层

用户希望模型配置里能写 `extends` 引用模板,但 V2 的模型条目 schema 是 `additionalProperties: false`:顶层未知字段会被 OpenCode 以「unsupported 字段」警告后丢弃,污染启动日志且可能触发编辑器 schema 标红。我们决定把 `extends` 放进模型级 `settings`(V1 的 `options`)——唯一允许任意键的槽位——由插件读取原始配置文件获取该值,并在注入模型前将其删除,避免透传给 AI SDK provider。

## Considered options

- 模型条目顶层:写法最直观,但警告噪声无解,会掩盖真实配置错误。放弃。
- 插件 options / 旁车映射文件:对 opencode 配置零侵入,但引用关系脱离模型定义,改一个模型要跨文件。放弃。

## Consequences

- 插件必须自行解析原始 `opencode.json(c)`(域数据里看不到 `extends`),并同时识别 `settings.extends` 与 V1 的 `options.extends` 两种写法。
- 用户在 `settings` 里写的 `extends` 在 `/api/model` 等域读取中不可见,这是预期行为。
