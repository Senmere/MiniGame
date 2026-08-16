import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as IOServer } from 'socket.io';
import { registerRoutes } from './routes/index.js';
import { attachSocket } from './sessions.js';
import { getDb } from './db/index.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

async function main() {
  // 初始化数据库
  getDb();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true, credentials: true });
  await registerRoutes(app);

  const io = new IOServer(app.server, {
    cors: { origin: WEB_ORIGIN, methods: ['GET', 'POST'] },
  });
  attachSocket(io);

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`AIchess Arena 后端已启动: http://localhost:${PORT}`);
    app.log.info(`WebSocket 已启用，前端来源: ${WEB_ORIGIN}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // 优雅退出：Ctrl+C / kill 时关闭 HTTP + Socket.IO，避免残留监听
  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，正在关闭…`);
    io.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main();
