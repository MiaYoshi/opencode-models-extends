// 数据集聚合:配置锚点发现 + 模板查找链 + 解析/归一化/合并结果
// 层叠顺序与 OpenCode 配置发现一致:全局 < 祖先 direct < 祖先 .opencode;每层内 .jsonc 覆盖 .json。

import { existsSync, readFileSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseJsonc } from "./jsonc.ts"
import { normalizeModelEntry, readAnchorExtends, type Warn } from "./normalize.ts"
import { deepMerge, isPlainObject, mergeModelPartial, substituteEnv, type Dict } from "./merge.ts"

export interface Anchor {
  providerID: string
  modelID: string
  partial: Dict
  /** 锚点写了 extends(即使无效),需要从运行时 settings 里剥掉 extends 键 */
  stripExtends: boolean
}

interface TrackedFile {
  path: string
  mtimeMs: number
  size: number
}

export interface Dataset {
  anchors: Anchor[]
  stale(): boolean
}

const CONFIG_NAMES = ["opencode.json", "opencode.jsonc"]
const TEMPLATE_NAMES = ["extends.models.json", "extends.models.jsonc"]

function ancestorsFarToNear(startDir: string): string[] {
  const out: string[] = []
  let cur = path.resolve(startDir)
  for (;;) {
    out.push(cur)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out.reverse()
}

function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config")
  return path.join(base, "opencode")
}

/** 返回按优先级(低→高)排列的候选文件路径(含不存在的,过滤后读取)。 */
function layerCandidates(names: string[], locationDir: string, globalDir: string): string[] {
  const dirs = ancestorsFarToNear(locationDir)
  const out: string[] = []
  const pushLayer = (getDir: (d: string) => string | undefined) => {
    for (const dir of dirs) {
      const base = getDir(dir)
      if (base === undefined) continue
      for (const name of names) out.push(path.join(base, name))
    }
  }
  // 0. 全局(仅 direct 层;全局目录下再分 .opencode 无意义)
  for (const name of names) out.push(path.join(globalDir, name))
  // 1. 所有祖先的 direct 层(远→近)
  pushLayer((d) => d)
  // 2. 所有祖先的 .opencode 层(远→近)
  pushLayer((d) => path.join(d, ".opencode"))
  return out
}

class FileReader {
  tracked: TrackedFile[] = []
  seen = new Set<string>()

  read(filePath: string, warn: Warn): unknown | undefined {
    if (!existsSync(filePath)) return undefined
    if (!this.seen.has(filePath)) {
      this.seen.add(filePath)
      try {
        const st = statSync(filePath)
        this.tracked.push({ path: filePath, mtimeMs: st.mtimeMs, size: st.size })
      } catch {
        /* 竞态:忽略跟踪 */
      }
    }
    try {
      return parseJsonc(readFileSync(filePath, "utf8"))
    } catch (err) {
      warn(`${filePath}: 解析失败,整份跳过 —— ${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  }

  stale(): boolean {
    for (const f of this.tracked) {
      try {
        const st = statSync(f.path)
        if (st.mtimeMs !== f.mtimeMs || st.size !== f.size) return true
      } catch {
        return true
      }
    }
    return false
  }
}

interface TemplateEntry {
  partial: Dict
  extendsId?: string
}

function loadTemplates(reader: FileReader, locationDir: string, globalDir: string, warn: Warn): Map<string, TemplateEntry> {
  const map = new Map<string, TemplateEntry>()
  for (const file of layerCandidates(TEMPLATE_NAMES, locationDir, globalDir)) {
    const doc = reader.read(file, warn)
    if (doc === undefined || !isPlainObject(doc)) continue
    for (const [id, rawEntry] of Object.entries(doc)) {
      const norm = normalizeModelEntry(rawEntry, `${path.basename(file)} 模板 "${id}"`, "template", warn)
      if (!norm) continue
      const existing = map.get(id)
      map.set(id, {
        partial: existing ? mergeModelPartial(existing.partial, norm.partial) : norm.partial,
        extendsId: norm.extendsId ?? existing?.extendsId,
      })
    }
  }
  return map
}

interface RawAnchorEntry {
  providerID: string
  modelID: string
  raw: Dict
}

/** 收集所有写了 models 的 provider 条目(含无 extends 的,后筛)。V1 provider 与 V2 providers 都读。 */
function collectAnchorRaw(reader: FileReader, locationDir: string, globalDir: string, warn: Warn): Map<string, RawAnchorEntry> {
  const map = new Map<string, RawAnchorEntry>()
  for (const file of layerCandidates(CONFIG_NAMES, locationDir, globalDir)) {
    const doc = reader.read(file, warn)
    if (doc === undefined || !isPlainObject(doc)) continue
    const providerMaps = [doc.provider, doc.providers] // V1 先,V2 同值赢
    for (const providers of providerMaps) {
      if (!isPlainObject(providers)) continue
      for (const [providerID, provider] of Object.entries(providers)) {
        if (!isPlainObject(provider)) continue
        const models = (provider as Dict).models
        if (!isPlainObject(models)) continue
        for (const [modelID, entry] of Object.entries(models)) {
          if (!isPlainObject(entry)) continue
          const key = `${providerID}\u0000${modelID}`
          const existing = map.get(key)
          const merged = existing ? deepMerge(existing.raw, entry) : { ...entry }
          map.set(key, { providerID, modelID, raw: merged })
        }
      }
    }
  }
  return map
}

function resolveChain(  id: string,
  templates: Map<string, TemplateEntry>,
  stack: string[],
  warn: Warn,
): Dict | undefined {
  if (stack.includes(id)) {
    warn(`extends 链成环: ${[...stack, id].join(" -> ")},停止展开`)
    return undefined
  }
  const entry = templates.get(id)
  if (!entry) {
    warn(`extends 引用 "${id}" 未找到对应模板条目,跳过继承`)
    return undefined
  }
  const parent = entry.extendsId ? resolveChain(entry.extendsId, templates, [...stack, id], warn) : undefined
  return parent ? mergeModelPartial(parent, entry.partial) : { ...entry.partial }
}

export interface DatasetOptions {
  /** 测试注入用;默认与 OpenCode 全局配置目录一致(XDG_CONFIG_HOME/opencode) */
  globalConfigDir?: string
}

export function buildDataset(locationDir: string, warn: Warn, opts: DatasetOptions = {}): Dataset {
  const globalDir = opts.globalConfigDir ?? globalConfigDir()
  const reader = new FileReader()
  const templates = loadTemplates(reader, locationDir, globalDir, warn)
  const rawAnchors = collectAnchorRaw(reader, locationDir, globalDir, warn)

  const anchors: Anchor[] = []
  for (const { providerID, modelID, raw } of rawAnchors.values()) {
    const hasExtendsKey =
      (isPlainObject(raw.settings) && "extends" in raw.settings) || (isPlainObject(raw.options) && "extends" in raw.options)
    const extendsId = readAnchorExtends(raw)
    if (!hasExtendsKey) continue // 无锚点声明,插件完全不碰

    const label = `provider "${providerID}" model "${modelID}"`
    const userNorm = normalizeModelEntry(raw, label, "anchor", warn)
    const templateResolved = extendsId ? resolveChain(extendsId, templates, [], (m) => warn(`${label}: ${m}`)) : undefined
    // v2.0.14 实测:OpenCode 对 variants 的最终装配 = 配置条目原始 variants ?? 按包与模型名的自动装配,
    // 完全忽略 transform 写入的 draft.variants → 模板提供的 variants 不会生效(见 ADR-0007)。
    // 仍会写入 draft(前向兼容),但必须警告,避免用户误以为已注入。
    if (Array.isArray(templateResolved?.variants) && templateResolved.variants.length > 0) {
      warn(`${label}: 模板提供的 variants 会被 OpenCode 忽略(v2.0.14 装配规则),请将 variants 写在模型配置条目里`)
    }
    const merged = templateResolved && userNorm ? mergeModelPartial(templateResolved, userNorm.partial) : (userNorm?.partial ?? {})
    const final = substituteEnv(merged, (m) => warn(`${label}: ${m}`))
    const partial: Dict = isPlainObject(final) ? final : {}

    anchors.push({ providerID, modelID, partial, stripExtends: hasExtendsKey })
  }

  return { anchors, stale: () => reader.stale() }
}
