# 合同条款排版器（Contract Clause Typesetter）

从空仓库建设的合同排版系统：**Vue 双栏（编辑 / 实时预览）**、**Fastify 服务端**
管理模板继承与渲染、**PostgreSQL** 持久化条款身份 / 模板版本 / 审阅记录。

> 软件只对用户提供的内容进行排版，**不判断条款的法律效力**。预览与正式件
> （打印 / PDF）均带有该免责声明。

## 核心不变量

1. **编号是显示属性，身份才是稳定引用目标。**
   每个条款有稳定 `id`；交叉引用写成 `[[#id]]`。插入 / 移动条款后按树顺序
   重新编号（第一条、第二条 …，附件 A/B/C…），引用标签自动更新，但引用
   始终指向同一条款的同一身份与内容。
2. **文档 = 模板基线版本 + 差异层**（edits / deletes / moves / inserts / values）。
   与"整文档复制"相比，两者渲染等价，差异层极小且支持模板升级三路合并。
3. **复用模板保留来源并做字段迁移。** 文档带 `lineage`；来源变量通过
   `varMap` 映射到目标字段或字面值；**未映射的必填变量显式阻止正式导出**
   （HTTP 422，列出每个变量）。
4. **模板升级 = base / head / 本地差异层三路合并**：同一字段两侧都改 →
   冲突，UI 必须逐项人工选择（保留本地 / 采用上游），不静默覆盖；
   新增变量需提供值后才能完成升级。
5. **页眉页脚随"节"作用域生效**：在某条款上设置方向 / 页眉 / 页脚，只级联
   到其子树；DFS 离开该子树时自动恢复。横向附件（landscape）后会显式输出
   新的纵向 `@page` 边界，**不会污染后续纵向正文**。
6. **审阅快照不可变**：打印与 PDF 共用同一份快照与同一个 HTML 渲染器。
   审阅之后任何修改（**包括导出期间改动落款**）都会使快照哈希失效，导出被
   409 阻止，必须重新审阅。
7. **缺失字体是显式警告**（中文 `Noto Serif CJK SC` 缺失 → 回退 DejaVu），
   不阻塞；长附件表（>60 行）自动在每页重复表头。
8. 交叉引用**成环** / 悬空引用为阻断错误；**验收拆分**保留原条款 id，拆出的
   续条为新身份，原引用不跳到续条。

## 目录

```
packages/core    纯 JS 领域逻辑（零运行时依赖，node --test 12 项验收）
  materialize.js 基线+差异层物化 / 整复制对比
  numbering.js   显示编号 / [[#id]] 引用解析 / 成环检测
  variables.js   {{name}} 变量、varMap 迁移、严格替换
  split.js       验收拆分（保留原身份）
  pages.js       节作用域 / 横向附件隔离 / 恢复边界
  upgrade.js     三路合并 + 人工采纳
  snapshot.js    不可变快照 + FNV 内容哈希 / 陈旧检测
  validate.js    导出前阻断/告警规则
  render.js      预览=打印=PDF 的唯一 HTML 渲染器
packages/server  Fastify API；repo/pg.js 与 repo/memory.js 同接口
  db/schema.sql  PG 表：条款身份 / 模板版本 / 差异层 / 快照 / 审阅记录 / 导出
packages/web     Vue3 + Vite 双栏：条款附件、变量映射、升级冲突、审阅导出
```

## 快速开始

```bash
npm install
npm test                 # core 12 项 + server 3 项端到端
npm run build:web
npm run dev:server       # http://localhost:8787（默认文件存储，自动播种演示模板）
# 前端开发： npm run dev:web （http://localhost:5173，代理 /api）
```

演示模板含：`{{party_a}}` 等必填变量、`[[#scope]]` 交叉引用、81 行横向长表
附件、落款块。

### PostgreSQL

```bash
createdb contract_ts && psql -d contract_ts -f packages/server/db/schema.sql
CT_STORAGE=pg DATABASE_URL=postgres://user:pass@localhost:5432/contract_ts \
  npm run dev:server
```

### PDF

PDF 由可选的 `puppeteer-core` 驱动系统 Chromium，且**与打印共用快照 HTML**。
无 Chromium 时接口返回 `pdfUnavailable:true` 与同一 HTML（显式降级，不会产生
与打印不一致的排版）。设置 `CHROMIUM_PATH` 指定浏览器。

## 关键 API

| 方法 & 路径 | 作用 |
| --- | --- |
| `POST /api/docs` | 从版本复用建文档（返回字段迁移建议） |
| `POST /api/docs/:id/blocks` / `/move` | 插入 / 移动（重编号，身份不变） |
| `PATCH /api/docs/:id/blocks/:bid` | 编辑差异层（含 page 节设置） |
| `PUT /api/docs/:id/values`、`/varmap` | 变量取值 / 字段迁移映射 |
| `GET /api/docs/:id/validate` | 阻断错误 + 字体/长表告警 |
| `GET /api/docs/:id/comparison` | 整复制 vs 基线+差异层对比 |
| `GET/POST /api/docs/:id/upgrade/:vid` | 三路冲突预览 / 人工采纳 |
| `POST /api/docs/:id/snapshots` | 生成不可变审阅快照 + 审阅记录 |
| `GET /api/snapshots/:sid/print` | 打印 HTML（快照） |
| `POST /api/docs/:id/export` | 校验 → 快照陈旧检测 → PDF/HTML（409/422 阻断） |

## 验收场景对应测试

- 验收拆分 / 交叉引用成环 / 长表 / 缺字体 / 导出期间改落款 / 打印=PDF：
  `packages/core/test/acceptance.test.js`
- 复用→变量阻断→移动重编号→快照→篡改 409→重新审阅导出；升级冲突人工采纳；
  两种策略对比：`packages/server/test/api.test.js`
