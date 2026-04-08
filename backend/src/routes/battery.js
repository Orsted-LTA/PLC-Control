const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const PYTHON_BASE = process.env.BATTERY_SERVICE_URL || 'http://127.0.0.1:8765';

// All battery routes require authentication
router.use(authenticateToken);

// GET /api/battery/ports — list COM ports
router.get('/ports', async (req, res) => {
  try {
    const result = await axios.get(`${PYTHON_BASE}/ports`);
    res.json(result.data);
  } catch (e) {
    logger.error('Battery /ports proxy error', { error: e.message });
    res.status(503).json({ error: 'Battery service unavailable', detail: e.message });
  }
});

// GET /api/battery/status — session status
router.get('/status', async (req, res) => {
  try {
    const result = await axios.get(`${PYTHON_BASE}/status`);
    res.json(result.data);
  } catch (e) {
    res.status(503).json({ error: 'Battery service unavailable', detail: e.message });
  }
});

// GET /api/battery/report/download — stream Excel file to client
router.get('/report/download', async (req, res) => {
  try {
    const result = await axios.get(`${PYTHON_BASE}/report/download`, {
      responseType: 'stream',
    });
    const contentDisposition = result.headers['content-disposition'] || 'attachment; filename="report.xlsx"';
    const contentType = result.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Content-Type', contentType);
    result.data.pipe(res);
  } catch (e) {
    if (e.response?.status === 404) {
      return res.status(404).json({ error: 'No report available for current session' });
    }
    logger.error('Battery report download proxy error', { error: e.message });
    res.status(503).json({ error: 'Battery service unavailable', detail: e.message });
  }
});

// GET /api/battery/health — check if Python service is reachable
router.get('/health', async (req, res) => {
  try {
    await axios.get(`${PYTHON_BASE}/ports`, { timeout: 3000 });
    res.json({ ok: true, service: 'battery', url: PYTHON_BASE });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'battery', error: e.message });
  }
});

module.exports = router;
