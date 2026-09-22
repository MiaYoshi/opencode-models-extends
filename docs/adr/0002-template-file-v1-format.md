# 模板文件条目采用 V1 catalog 风格,由插件归一化到 V2

用户的现有配置习惯与样例 `extends.models.jsonc` 都是 V1 catalog 写法(`tool_call`、`modalities`、`limit`、variants 对象等)。我们决定模板文件条目只收 V1 风格,插件消费时映射到 V2 域:`tool_call`→`capabilities.tools`,`modalities.input/output`→`capabilities.input/output`,variants 对象→带 `id` 的数组,顶层生成参数→`settings`。`attachment` 与布尔 `temperature` 在 V2 无任何对应效果,插件忽略并警告。

## Considered options

- 只收 V2 原生形态:规则单一,但迫使用户重写模板,且与用户 opencode 配置仍用 V1 键的现状割裂。放弃。

## Consequences

- 模板格式与插件内部域模型是两套词汇,插件必须维护一个稳定的映射层;日后 OpenCode 若变更 `Model.Info` 字段,受影响的是映射层而不是用户的模板文件。
- 若将来想同时接受 V2 原生写法,是纯增量扩展,不破坏已写模板。
