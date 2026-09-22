# 功能边界:模板只随锚点生效、顺带支持内置 provider、不做 provider 级 extends

我们确定了插件的作用范围:(1) 模板条目永远是被动方,仅当 opencode.json 中存在写了 extends 的模型配置项(锚点)时才被合并注入,模板绝不凭空注册模型;(2) 内置 provider 的模型配置项同样可以挂 extends 覆写 catalog 参数——机制上对来源一视同仁,零额外成本,文档如实承诺;(3) provider 级 extends(共享 package/settings/baseURL)明确列为 Non-goal:v1 的痛点是模型参数重复,provider 级继承是另一件事,禁止顺手实现以免语义膨胀。

## Consequences

- (3) 是刻意为之的拒绝。半年后有人(包括作者自己)想"顺便支持一下 provider 级"时,应以本 ADR 为准重新立决策,而不是悄悄扩面。
