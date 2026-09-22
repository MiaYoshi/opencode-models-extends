// 插件入口。opencode 的 Host.resolve() 对本地目录插件只解析 <dir>/index 与 <dir>/server,
// 不看 package.json#main —— 此文件必须保持在仓库根。实现细节在 src/ 下。
export { default } from "./src/index.ts"
