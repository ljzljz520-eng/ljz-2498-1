# API 摘要

所有响应均为 JSON；错误格式 `{ "error": { "code", "message", "details" } }`。

## 模板

- `GET /api/templates`：列出模板及当前版本
- `POST /api/templates`：创建根模板版本
- `GET /api/templates/:templateId/versions`：版本历史
- `POST /api/templates/:parentVersionId/child-versions`：在父版本上创建继承差异层
- `GET /api/templates/versions/:versionId`：服务端解析继承，返回完整节点
- `POST /api/templates/fork`：复用其他模板，校验字段迁移与未映射变量

## 文档编辑

- `POST /api/documents`：从模板版本创建文档（保存基线版本，不复制模板）
- `GET /api/documents/:id`：解析“模板基线 + 本地差异层”并返回实时编号
- `POST /api/documents/:id/mutate`：`insert/update/move/delete` 树操作
- `POST /api/documents/:id/split`：拆分验收条款，旧 ID 保留
- `POST /api/documents/:id/move`：移动条款；编号重算，引用不变
- `POST /api/documents/:id/variables`：写入变量值
- `POST /api/documents/:id/signoff`：修改当前草稿落款（不改旧快照）
- `POST /api/documents/:id/reuse-comparison`：比较整文档复制与基线差异层
- `POST /api/documents/:id/upgrades`：生成三方升级冲突预览
- `POST /api/documents/:id/upgrades/:versionId/adopt`：提交人工冲突选择并采纳

## 审阅、打印、PDF

- `POST /api/documents/:id/snapshots`：冻结当前文档版本、变量、落款、字体策略和完整节点
- `GET /api/documents/:id/snapshots`：快照列表
- `GET /api/snapshots/:snapshotId`：快照 JSON
- `GET /api/snapshots/:snapshotId/render`：同一快照 HTML（打印/PDF共同来源）
- `POST /api/snapshots/:snapshotId/review`：记录批准、退回、评论
- `GET /api/snapshots/:snapshotId/records`：审阅记录
- `POST /api/snapshots/:snapshotId/export`：`{ "format": "print|pdf|html" }`

正式 `pdf/html` 要求快照验证通过：断链、成环、未映射变量、缺失必需字体均阻止导出。`print` 会保留可见错误标记，避免用户误判；前端从同一个 `/render` URL 调起浏览器“打印/另存 PDF”。
