// 模型配置条目归一化:V1 catalog 风格与 V2 原生形态 → V2 partial(ADR-0002)
// 校验失败的字段:警告并丢弃该字段,条目其余保留(失败面策略 A)。

import { isPlainObject, type Dict } from "./merge.ts"

export type Warn = (msg: string) => void

export interface Normalized {
  partial: Dict
  extendsId?: string
}

const IGNORED_V1 = ["attachment", "reasoning", "release_date", "experimental"]

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

function readStringMap(v: unknown, warn: Warn, label: string): Dict | undefined {
  if (!isPlainObject(v)) {
    warn(`${label}: 期望对象,已忽略`)
    return undefined
  }
  return v
}

/** 合并 settings(V2 settings 键赢过 V1 options 同名键)。 */
function buildSettings(raw: Dict, out: Dict, warn: Warn): void {
  const options = raw.options
  const settings = raw.settings
  if (options !== undefined && !isPlainObject(options)) warn("options: 期望对象,已忽略")
  if (settings !== undefined && !isPlainObject(settings)) warn("settings: 期望对象,已忽略")
  const merged: Dict = {}
  if (isPlainObject(options)) Object.assign(merged, options)
  if (isPlainObject(settings)) Object.assign(merged, settings)
  delete merged.extends // 锚点指针,绝不注入(ADR-0001)
  if (typeof raw.temperature === "number") {
    if (merged.temperature === undefined) merged.temperature = raw.temperature
  } else if (raw.temperature !== undefined) {
    warn("temperature(非数值): V2 无对应布尔语义,已忽略;需要温度请在 settings 中给数值")
  }
  if (Object.keys(merged).length > 0) out.settings = merged
}

function buildCapabilities(raw: Dict, out: Dict, warn: Warn): void {
  const caps: Dict = {}
  const v2 = isPlainObject(raw.capabilities) ? raw.capabilities : undefined
  if (v2) {
    if (typeof v2.tools === "boolean") caps.tools = v2.tools
    else if (v2.tools !== undefined) warn("capabilities.tools: 期望 boolean,已忽略")
    if (isStringArray(v2.input)) caps.input = [...v2.input]
    else if (v2.input !== undefined) warn("capabilities.input: 期望字符串数组,已忽略")
    if (isStringArray(v2.output)) caps.output = [...v2.output]
    else if (v2.output !== undefined) warn("capabilities.output: 期望字符串数组,已忽略")
  }
  if (raw.tool_call !== undefined) {
    if (caps.tools === undefined && typeof raw.tool_call === "boolean") caps.tools = raw.tool_call
    else warn("tool_call: 与 capabilities.tools 冲突或类型不对,已忽略")
  }
  if (isPlainObject(raw.modalities)) {
    const m = raw.modalities
    if (caps.input === undefined && isStringArray(m.input)) caps.input = [...m.input]
    if (caps.output === undefined && isStringArray(m.output)) caps.output = [...m.output]
  }
  if (Object.keys(caps).length > 0) out.capabilities = caps
}

function buildLimit(raw: Dict, out: Dict, warn: Warn): void {
  if (!isPlainObject(raw.limit)) {
    if (raw.limit !== undefined) warn("limit: 期望对象,已忽略")
    return
  }
  const limit: Dict = {}
  for (const key of ["context", "input", "output"]) {
    const v = raw.limit[key]
    if (v === undefined) continue
    if (isPositiveInt(v)) limit[key] = v
    else warn(`limit.${key}: 期望正整数,收到 ${JSON.stringify(v)},已忽略`)
  }
  if (Object.keys(limit).length > 0) out.limit = limit
}

function normalizeCostItem(item: unknown, warn: Warn): Dict | undefined {
  if (!isPlainObject(item)) {
    warn("cost: 期望对象(或对象数组),已忽略")
    return undefined
  }
  const out: Dict = {}
  if (isPlainObject(item.tier)) out.tier = { ...item.tier }
  for (const key of ["input", "output"]) {
    if (typeof item[key] === "number") out[key] = item[key]
  }
  const cache: Dict = {}
  if (isPlainObject(item.cache)) {
    if (typeof item.cache.read === "number") cache.read = item.cache.read
    if (typeof item.cache.write === "number") cache.write = item.cache.write
  }
  if (typeof item.cache_read === "number") cache.read = item.cache_read // V1
  if (typeof item.cache_write === "number") cache.write = item.cache_write // V1
  if (Object.keys(cache).length > 0) out.cache = cache
  return Object.keys(out).length > 0 ? out : undefined
}

function buildCost(raw: Dict, out: Dict, warn: Warn): void {
  if (raw.cost === undefined) return
  const items = Array.isArray(raw.cost) ? raw.cost : [raw.cost]
  const list: Dict[] = []
  for (const item of items) {
    const n = normalizeCostItem(item, warn)
    if (n) list.push(n)
  }
  if (list.length > 0) out.cost = list
}

function normalizeVariantValue(id: string, value: unknown, warn: Warn): Dict | undefined {
  if (!isPlainObject(value)) {
    warn(`variants.${id}: 期望对象,已忽略`)
    return undefined
  }
  // V2 形态:含 settings/headers/body 槽位
  if (value.settings !== undefined || value.headers !== undefined || value.body !== undefined) {
    const out: Dict = { id }
    if (isPlainObject(value.settings)) out.settings = { ...value.settings }
    if (isPlainObject(value.headers)) out.headers = { ...value.headers }
    if (isPlainObject(value.body)) out.body = { ...value.body }
    return out
  }
  // V1 形态:整个对象就是 options
  return { id, settings: { ...value } }
}

function buildVariants(raw: Dict, out: Dict, warn: Warn): void {
  if (raw.variants === undefined) return
  const list: Dict[] = []
  if (Array.isArray(raw.variants)) {
    for (const item of raw.variants) {
      if (isPlainObject(item) && typeof item.id === "string") {
        const n = normalizeVariantValue(item.id, { ...item }, warn)
        if (n) list.push(n)
      } else warn("variants: 数组项缺少字符串 id,已忽略")
    }
  } else if (isPlainObject(raw.variants)) {
    for (const [id, value] of Object.entries(raw.variants)) {
      const n = normalizeVariantValue(id, value, warn)
      if (n) list.push(n)
    }
  } else {
    warn("variants: 期望对象或数组,已忽略")
  }
  if (list.length > 0) out.variants = list
}

function buildCompatibility(raw: Dict, out: Dict, warn: Warn): void {
  if (raw.compatibility === undefined) return
  if (!isPlainObject(raw.compatibility)) {
    warn("compatibility: 期望对象,已忽略")
    return
  }
  const c: Dict = {}
  if (typeof raw.compatibility.reasoningField === "string") c.reasoningField = raw.compatibility.reasoningField
  if (raw.compatibility.maxTokensField === "max_completion_tokens" || raw.compatibility.maxTokensField === "max_tokens")
    c.maxTokensField = raw.compatibility.maxTokensField
  if (Object.keys(c).length > 0) out.compatibility = c
}

const CONSUMED = new Set<string>([
  "id",
  "modelID",
  "name",
  "package",
  "settings",
  "options",
  "headers",
  "body",
  "capabilities",
  "tool_call",
  "modalities",
  "limit",
  "cost",
  "variants",
  "compatibility",
  "disabled",
  "status",
  "temperature",
  ...IGNORED_V1,
])

/**
 * 归一化一个模型配置条目(可能是 V1 或 V2 形态)。
 * mode=anchor:extends 从 settings/options 里取;mode=template:extends 在条目顶层。
 */
export function normalizeModelEntry(raw: unknown, label: string, mode: "anchor" | "template", warn: Warn): Normalized | undefined {
  if (!isPlainObject(raw)) {
    warn(`${label}: 模型条目期望对象,已忽略`)
    return undefined
  }
  const out: Dict = {}
  let extendsId: string | undefined

  if (mode === "template" && raw.extends !== undefined) {
    if (typeof raw.extends === "string" && raw.extends.length > 0) extendsId = raw.extends
    else warn(`${label}: extends 期望非空字符串,已忽略`)
  }

  if (typeof raw.name === "string") out.name = raw.name
  else if (raw.name !== undefined) warn(`${label}: name 期望字符串,已忽略`)

  const modelID = raw.modelID !== undefined ? raw.modelID : raw.id // V2 键优先于 V1 id
  if (typeof modelID === "string" && modelID.length > 0) out.modelID = modelID
  else if (modelID !== undefined) warn(`${label}: modelID/id 期望非空字符串,已忽略`)

  if (typeof raw.package === "string") out.package = raw.package
  else if (raw.package !== undefined) warn(`${label}: package 期望字符串,已忽略`)

  buildSettings(raw, out, warn)

  if (raw.headers !== undefined) {
    const h = readStringMap(raw.headers, warn, `${label}: headers`)
    if (h && Object.values(h).every((v) => typeof v === "string")) out.headers = { ...h }
    else if (h) warn(`${label}: headers 只允许字符串值,已忽略`)
  }
  if (raw.body !== undefined) {
    const b = readStringMap(raw.body, warn, `${label}: body`)
    if (b) out.body = { ...b }
  }

  buildCapabilities(raw, out, warn)
  buildLimit(raw, out, warn)
  buildCost(raw, out, warn)
  buildVariants(raw, out, warn)
  buildCompatibility(raw, out, warn)

  if (raw.disabled !== undefined) {
    if (typeof raw.disabled === "boolean") out.disabled = raw.disabled
    else warn(`${label}: disabled 期望 boolean,已忽略`)
  }
  if (raw.status !== undefined) {
    if (raw.status === "deprecated") out.disabled = true
    else warn(`${label}: status(${JSON.stringify(raw.status)}) 在 V2 无对应,已忽略`)
  }

  for (const key of IGNORED_V1) {
    if (raw[key] !== undefined) warn(`${label}: ${key} 在 V2 中无对应字段,已忽略`)
  }
  for (const key of Object.keys(raw)) {
    if (!CONSUMED.has(key) && key !== "extends") warn(`${label}: 未知字段 ${key},已忽略`)
  }

  return { partial: out, extendsId }
}

/** 从锚点(配置文件里的模型条目)读取 extends 引用。 */
export function readAnchorExtends(raw: Dict): string | undefined {
  if (isPlainObject(raw.settings) && typeof raw.settings.extends === "string" && raw.settings.extends.length > 0)
    return raw.settings.extends
  if (isPlainObject(raw.options) && typeof raw.options.extends === "string" && raw.options.extends.length > 0)
    return raw.options.extends
  return undefined
}
