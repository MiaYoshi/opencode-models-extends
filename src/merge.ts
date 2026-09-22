// 深合并、variants 按 id 对齐、null 删除、{env:VAR} 替换(ADR-0003 / ADR-0005)

export type Dict = Record<string, unknown>

export function isPlainObject(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** override 赢;override 的显式 null 删除 base 的键;纯对象递归;数组/标量整值替换。 */
export function deepMerge(base: Dict, override: Dict): Dict {
  const out: Dict = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete out[key]
      continue
    }
    const existing = out[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value)
    } else {
      out[key] = value
    }
  }
  return out
}

/** variants 按 id 对齐深合并;base 顺序保留,override 新增的 id 追加。 */
export function mergeVariants(base: unknown, override: unknown): unknown[] | undefined {
  if (!Array.isArray(base) && !Array.isArray(override)) return undefined
  const list: Dict[] = []
  for (const item of Array.isArray(base) ? base : []) {
    if (isPlainObject(item) && typeof item.id === "string") list.push({ ...item })
  }
  for (const item of Array.isArray(override) ? override : []) {
    if (!isPlainObject(item) || typeof item.id !== "string") continue
    const idx = list.findIndex((v) => v.id === item.id)
    if (idx >= 0) list[idx] = deepMerge(list[idx]!, item)
    else list.push({ ...item })
  }
  return list
}

/** 模型 partial 层的合并:variants 走按 id 对齐,其余走 deepMerge。 */
export function mergeModelPartial(base: Dict, override: Dict): Dict {
  const merged = deepMerge(base, override)
  const variants = mergeVariants(base.variants, override.variants)
  if (variants !== undefined) merged.variants = variants
  else delete merged.variants
  return merged
}

const ENV_RE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)(?::-([\s\S]*))?\}$/

const UNSET = Symbol("env-unset")
type Unset = typeof UNSET

/** 整值匹配的 {env:VAR}(可带 :-default)按环境变量替换;未设且无默认 → 删除所在键。 */
export function substituteEnv<T>(value: T, warn: (msg: string) => void): T | Unset {
  if (typeof value === "string") {
    const m = ENV_RE.exec(value)
    if (!m) return value
    const raw = process.env[m[1]!]
    if (raw !== undefined) return raw as unknown as T
    if (m[2] !== undefined) return m[2] as unknown as T
    warn(`环境变量 ${m[1]} 未设置(无默认值),删除键值 ${value}`)
    return UNSET
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      const r = substituteEnv(item, warn)
      if (r !== UNSET) out.push(r)
    }
    return out as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Dict = {}
    for (const [key, item] of Object.entries(value)) {
      const r = substituteEnv(item, warn)
      if (r !== UNSET) out[key] = r
    }
    return out as unknown as T
  }
  return value
}
