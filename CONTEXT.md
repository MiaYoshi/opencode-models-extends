# Provider Model Extends(opencode 插件)

为 opencode 自定义 provider 的模型配置提供「模板继承」能力的插件:模型配置只需声明一个引用,即可复用集中存放的模板,消除跨 provider 的重复参数。

## Language

**extends 字段**:
字符串引用,指向模板条目(id)。两种出现位置:opencode.json 的模型配置里藏在 `settings`(V1 为 `options`,注入前由插件移除,ADR-0001);模板条目里写在顶层、构成链式继承(ADR-0004)。
_Avoid_: inherit、reference

**模板文件**:
集中存放模型参数的 JSONC 文件(`extends.models.jsonc`,也接受 `.opencode/` 下同名文件)。项目侧从启动目录向上到文件系统根收集**全部**命中,就近者优先;最末位是全局文件(`~/.config/opencode/`,随 XDG 配置)。
_Avoid_: 基础文件、公共配置

**模板条目**:
模板文件中以 id 为键的一项配置内容。永远是被动方:仅被锚点引用时生效,绝不凭空注册模型。接受 V1 风格与 V2 原生两种书写格式,插件内统一归一化为 V2 形态(见 ADR-0002)。
_Avoid_: 模板定义、preset

**锚点**:
opencode.json 中书写了 extends 字段的模型配置项,是模板生效的唯一入口。内置 provider 的模型配置项同样可作锚点(ADR-0006)。
_Avoid_: 引用方、宿主

**用户配置**:
用户在 `opencode.json(c)` 的 provider/models 下书写的模型配置项。合并时优先级高于模板条目。
_Avoid_: 本地配置

**合并**:
用户配置覆盖到模板条目上得到最终模型配置的过程:对象逐层叠加,数组与标量整值替换,variants 按 id 对齐(v2.0.14 下模板 variants 需配置条目空标记 `variants: []`/`{}` 配合才生效,见 ADR-0007);用户侧显式 `null` 表示删除该键。
_Avoid_: 叠加、fallback

**变量替换**:
模板文件中 `{env:VAR}` 占位符由插件按进程环境变量替换;变量未设时警告并删除所在键。
_Avoid_: 插值、占位符解析
