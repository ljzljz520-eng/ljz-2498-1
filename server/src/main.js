import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const app = await createApp();
app.listen(port, () => {
  console.log(`合同条款排版器服务已启动: http://localhost:${port}`);
  console.log(`数据模式: ${process.env.DATABASE_URL && process.env.DATABASE_URL !== 'memory' ? 'PostgreSQL' : 'memory'}`);
});
