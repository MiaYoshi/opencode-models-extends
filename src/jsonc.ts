// JSONC 解析(允许注释与尾逗号),出错抛异常由调用方降级为警告
import { parse, type ParseError } from "jsonc-parser"

export function parseJsonc(text: string): unknown {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) {
    throw new Error(
      errors.map((e) => `code=${e.error} offset=${e.offset} length=${e.length}`).join("; "),
    )
  }
  if (value === undefined) throw new Error("空文档或非 JSON 值")
  return value
}
