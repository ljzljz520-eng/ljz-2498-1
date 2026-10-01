# 合同条款排版器 Contract Layout Studio

双栏 Vue 编辑/预览，服务端管理模板继承、版本升级、渲染、审阅快照与导出，PostgreSQL 持久化稳定身份与审计记录。

## 快速开始

```bash
npm install
npm test
npm run dev
```

默认使用内存数据，便于无数据库演示。生产使用 PostgreSQL：

```bash
createdb contract_layout
DATABASE_URL=postgres://user:pass@localhost:5432/contract_layout npm run migrate
DATABASE_URL=postgres://... npm start
npm run build
```

打开 Vite 地址（开发时 `/api` 代理到 3000）。生产模式会直接托管 `dist/`。

## 核心不变量

- 条款编号是从文档树位置实时计算的显示属性；正文交叉引用保存稳定 `clauseId`。
- 插入、拖拽移动、重排只改变位置，不改变稳定 ID；编号重算，引用仍指向原条款。
- 文档采用“模板基线 + 本地差异层”。整文档复制可作为迁移方案比较，但不是默认模型。
- 模板升级执行三方比较；冲突逐条预览，必须人工选择后才能采纳。
- 拆分条款保留来源，旧引用仍解析到原稳定条款。
- 交叉引用成环、断链、未映射变量、缺失必需字体会阻止正式导出。
- 页眉页脚和横向/纵向由节作用域控制；横向附件结束后自动回到纵向正文。
- 打印和 PDF 使用同一个 `review_snapshot`；导出期间修改落款不会进入快照。
- 软件只排版用户提供的内容，不判断条款法律效力。
