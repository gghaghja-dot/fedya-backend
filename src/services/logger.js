const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFile = path.join(logsDir, 'app.log');

function write(level, message, meta) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  });
  fs.appendFile(logFile, `${line}\n`, () => {});
  if (level === 'error') console.error(message, meta || '');
  else if (process.env.NODE_ENV !== 'production') console.log(`[${level}]`, message, meta || '');
}

const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  readTail(limit = 200) {
    try {
      if (!fs.existsSync(logFile)) return [];
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { message: l };
        }
      });
    } catch {
      return [];
    }
  },
  logFile,
};

module.exports = logger;
