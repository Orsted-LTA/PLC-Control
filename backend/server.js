require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./src/config');
const { initDb } = require('./src/models/database');
const logger = require('./src/utils/logger');
const { scheduleCleanup } = require('./src/utils/cleanup');
const errorHandler = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const fileRoutes = require('./src/routes/files');
const versionRoutes = require('./src/routes/versions');

// Initialize database
initDb();

const app = express();

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS
const corsOptions = {
  origin: config.corsOrigins
    ? config.corsOrigins
    : (origin, callback) => callback(null, true),
  credentials: true,
};
app.use(cors(corsOptions));

// Compression
app.use(compression());

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

// Rate limiting for static file serving (SPA fallback)
const staticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve frontend static files in production
const frontendDist = path.join(__dirname, '../frontend/dist');
const fs = require('fs');
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

// Start server
app.listen(config.port, config.host, () => {
  logger.info(`PLC Control server started`, {
    host: config.host,
    port: config.port,
    url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
  });
});

module.exports = app;
