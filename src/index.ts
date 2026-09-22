// opencode-models-extends:通过 extends 引用模板文件,消除跨 provider 的模型配置重复。
// 设计见 CONTEXT.md 与 docs/adr/0001..0006。
//
// 注入点(v2.0.14 实测):
// - config 注入的模型只在 model 阶段(ctx.model.transform)可见,provider 阶段(editor)看不到它们;
// - provider 阶段保留用于内置 provider 的目录模型(ADR-0006)。
// 两处应用同一 partial 幂等(settings 递归、cost 替换、variants 按 id),重复无害。
// 转换回调必须同步,数据在 setup/轮询里异步重建后经 reload 重放。

import { Plugin } from "@opencode/plugin"
import { buildDataset, type Anchor, type Dataset } from "./dataset.ts"
import { applyModelPartial, stripExtendsKey, type ModelDraft } from "./apply.ts"

const TAG = "[opencode-models-extends]"
const POLL_MS = 2000

const warn = (msg: string) => console.warn(`${TAG} ${msg}`)

const anchorKey = (a: Pick<Anchor, "providerID" | "modelID">) => `${a.providerID}/${a.modelID}`

function editAnchor(anchor: Anchor, model: unknown): void {
  const draft = model as ModelDraft
  if (anchor.stripExtends) stripExtendsKey(draft) // ADR-0001
  applyModelPartial(draft, anchor.partial)
}

export default Plugin.define({
  id: "opencode-models-extends",
  async setup(ctx) {
    console.log(`${TAG} 已加载 (location: ${ctx.location.directory})`)
    let dataset: Dataset = { anchors: [], stale: () => false }
    try {
      dataset = buildDataset(ctx.location.directory, warn)
    } catch (err) {
      warn(`构建数据失败,插件暂不生效:${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    }
    if (dataset.anchors.length > 0) {
      console.log(`${TAG} 解析出 ${dataset.anchors.length} 个 extends 锚点`)
    }

    // 警告去重:每个数据集世代内,每个锚点只警告一次
    let warnedMissing = new Set<string>()

    // 主注入点:config 注入的模型在 model 阶段可见
    await ctx.model.transform((editor) => {
      const cold = editor.list().length === 0 // 冷启动:候选还没就绪,静待下次重放
      for (const anchor of dataset.anchors) {
        if (!editor.get(anchor.providerID, anchor.modelID)) {
          const key = anchorKey(anchor)
          if (!cold && !warnedMissing.has(key)) {
            warnedMissing.add(key)
            warn(`模型注册表中找不到 ${key},该锚点未生效`)
          }
          continue
        }
        editor.update(anchor.providerID, anchor.modelID, (model) => editAnchor(anchor, model))
      }
    })

    // 兜底:内置 provider 的目录模型(锚点若指向 catalog 模型,在 model 阶段同样可见,
    // 这里只处理 model 阶段没看到、但 provider 源里存在的情况)
    await ctx.provider.transform((editor) => {
      for (const anchor of dataset.anchors) {
        const key = anchorKey(anchor)
        if (!warnedMissing.has(key)) continue // model 阶段命中或已警告过
        const record = editor.get(anchor.providerID)
        if (!record || !record.models.has(anchor.modelID)) continue
        editor.models.update(anchor.providerID, anchor.modelID, (model) => editAnchor(anchor, model))
      }
    })

    const timer = setInterval(() => {
      try {
        if (!dataset.stale()) return
        const next = buildDataset(ctx.location.directory, warn)
        dataset = next
        warnedMissing = new Set()
        console.log(`${TAG} 检测到配置/模板变化,重新应用 ${next.anchors.length} 个锚点`)
        void ctx.provider.reload()
        void ctx.model.reload()
      } catch (err) {
        warn(`重建数据失败,保留上一份:${err instanceof Error ? err.message : String(err)}`)
      }
    }, POLL_MS)
    ;(timer as { unref?: () => void }).unref?.()

    return () => clearInterval(timer)
  },
})
