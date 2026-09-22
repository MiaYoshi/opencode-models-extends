// 把合并后的 partial 写入模型草稿(Model.Info 的可变副本)。
// 规则(ADR-0003):settings/body/capabilities/limit/compatibility 逐子键合并;
// headers 按 key(大小写不敏感)覆盖;cost 整值替换;variants 按 id 对齐;标量替换。
//
// 注意(v2.0.14 实测):editor.update 的草稿只追踪「属性重赋值」,
// 对既有嵌套对象的原地 mutate(增删改 key)不会进入 override ——
// 因此这里所有嵌套字段都必须整体赋新对象。

import { deepMerge, isPlainObject, mergeVariants, type Dict } from "./merge.ts"

/** Model.Info 的结构化视图(品牌字符串按普通 string 处理)。 */
export interface ModelDraft {
  name?: string
  modelID?: string
  package?: string
  enabled?: boolean
  settings?: Dict
  options?: Dict
  headers?: Record<string, string>
  body?: Dict
  capabilities?: { tools?: boolean; input?: string[]; output?: string[] }
  limit?: { context?: number; input?: number; output?: number }
  compatibility?: Dict
  variants?: Array<Dict & { id: string }>
  cost?: unknown[]
}

function mergeHeaders(existing: Record<string, string> | undefined, incoming: Dict): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const key of Object.keys(incoming)) {
    if (typeof incoming[key] === "string") taken.add(key.toLowerCase())
  }
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!taken.has(key.toLowerCase())) out[key] = value
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

export function applyModelPartial(draft: ModelDraft, partial: Dict): void {
  if (typeof partial.name === "string") draft.name = partial.name
  if (typeof partial.modelID === "string") draft.modelID = partial.modelID
  if (typeof partial.package === "string") draft.package = partial.package
  if (typeof partial.disabled === "boolean") draft.enabled = !partial.disabled

  if (isPlainObject(partial.settings)) draft.settings = deepMerge(draft.settings ?? {}, partial.settings)
  if (isPlainObject(partial.headers)) draft.headers = mergeHeaders(draft.headers, partial.headers)
  if (isPlainObject(partial.body)) draft.body = deepMerge(draft.body ?? {}, partial.body)

  if (isPlainObject(partial.capabilities)) {
    const caps = { ...draft.capabilities }
    if (typeof partial.capabilities.tools === "boolean") caps.tools = partial.capabilities.tools
    if (Array.isArray(partial.capabilities.input)) caps.input = [...partial.capabilities.input] as string[]
    if (Array.isArray(partial.capabilities.output)) caps.output = [...partial.capabilities.output] as string[]
    draft.capabilities = caps
  }

  if (isPlainObject(partial.limit)) {
    const limit = { ...draft.limit }
    for (const key of ["context", "input", "output"] as const) {
      const v = partial.limit[key]
      if (typeof v === "number") limit[key] = v
    }
    draft.limit = limit
  }

  if (isPlainObject(partial.compatibility)) {
    draft.compatibility = deepMerge(draft.compatibility ?? {}, partial.compatibility)
  }

  if (Array.isArray(partial.cost)) draft.cost = partial.cost.map((x) => (isPlainObject(x) ? { ...x } : x))
  // v2.0.14 实测:OpenCode 在 transform 之后按「配置条目 variants ?? 包启发式自动装配」重建最终
  // variants,draft.variants 被忽略(见 ADR-0007)。这里仍写入,是为未来版本若改读 draft 时前向兼容;
  // 当前版本生效与否由 dataset.ts 构建期的警告负责告知用户。
  if (Array.isArray(partial.variants)) {
    draft.variants = (mergeVariants(draft.variants, partial.variants) ?? []) as Array<Dict & { id: string }>
  }
}

/** 剥掉 extends 指针(ADR-0001)。必须整体重赋值(见文件头注释)。 */
export function stripExtendsKey(draft: ModelDraft): void {
  for (const slot of ["settings", "options"] as const) {
    const obj = draft[slot]
    if (isPlainObject(obj) && "extends" in obj) {
      const copy = { ...obj }
      delete copy.extends
      draft[slot] = copy
    }
  }
}
