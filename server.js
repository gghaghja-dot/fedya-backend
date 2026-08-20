require('dotenv').config();

const http = require('http');
const app = require('./src/app');
const { initSocket } = require('./src/socket');
const logger = require('./src/services/logger');

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  logger.info(`FedyaLM backend listening on port ${PORT}`, {
    env: process.env.NODE_ENV,
  });
  console.log(`🚀 FedyaLM backend on http://localhost:${PORT}`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err.message, stack: err.stack });
});
