require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./src/config');
const { initDb } = require('./src/models/database');
const logger = require('./src/utils/logger');
const { scheduleCleanup } = require('./src/utils/cleanup');
const { scheduleBackup } = require('./src/utils/backup');
const { addClient, removeClient, broadcast } = require('./src/utils/notifications');
const errorHandler = require('./src/middleware/errorHandler');
const { authenticateToken } = require('./src/middleware/auth');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const fileRoutes = require('./src/routes/files');
const versionRoutes = require('./src/routes/versions');
const folderRoutes = require('./src/routes/folders');
const adminRoutes = require('./src/routes/admin');

// Initialize database
initDb();

const app = express();

// Security headers
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS
const corsOptions = {
  origin: config.corsOrigins
    ? config.corsOrigins
    : (origin, callback) => callback(null, true),
  credentials: true,
};
app.use(cors(corsOptions));

// Compression (exclude SSE streams to prevent buffering real-time events)
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream') return false;
    if (res.getHeader && res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/versions', versionRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/admin', adminRoutes);

// SSE notifications endpoint
app.get('/api/notifications/stream', authenticateToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial heartbeat
  res.write(': connected\n\n');

  addClient(res);
  logger.info('SSE stream opened', { userId: req.user.id, username: req.user.username });

  // Heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res);
    logger.info('SSE stream closed', { userId: req.user.id, username: req.user.username });
  });
});

// Serve uploaded avatars
const avatarsDir = path.join(config.dataDir, 'avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}
app.use('/uploads/avatars', express.static(avatarsDir));

// Rate limiting for static file serving (SPA fallback)
const staticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve frontend static files in production
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', staticLimiter, (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    }
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// Schedule cleanup
scheduleCleanup();

// Schedule backup
scheduleBackup();

// Start server
app.listen(config.port, config.host, () => {
  logger.info(`PLC Control server started`, {
    host: config.host,
    port: config.port,
    url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
  });
});

module.exports = app;
