const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const PYTHON_BASE = process.env.BATTERY_SERVICE_URL || 'http://127.0.0.1:8765';

const TEMPLATES_DIR = path.join(__dirname, '../../templates');
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMPLATES_DIR),
  filename: (_req, _file, cb) => cb(null, 'battery_template.xlsx'),
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are accepted'));
    }
  },
});

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

// POST /api/battery/upload-template — save uploaded .xlsx template
router.post('/upload-template', upload.single('template'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded or invalid file type' });
  }
  logger.info('Battery template uploaded', { filename: req.file.filename });
  res.json({ ok: true, message: 'Template saved' });
});

// POST /api/battery/download-report — inject test data into template and return xlsx
router.post('/download-report', async (req, res) => {
  const templatePath = path.join(TEMPLATES_DIR, 'battery_template.xlsx');

  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: 'Template not found. Please upload battery_template.xlsx first.' });
  }

  const { records } = req.body;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'records must be an array' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    // Build lookup map by id
    const dataMap = {};
    for (const rec of records) {
      dataMap[rec.id] = rec;
    }

    const fullTagRegex = /^\{\{(OCV|CCV|Time)_(\d+)\}\}$/i;
    const inlineTagRegex = /\{\{(OCV|CCV|Time)_(\d+)\}\}/gi;

    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const val = cell.value;
          if (typeof val !== 'string') return;

          const fullMatch = val.match(fullTagRegex);
          if (fullMatch) {
            const field = fullMatch[1].toLowerCase();
            const id = parseInt(fullMatch[2], 10);
            const rec = dataMap[id];
            if (rec) {
              if (field === 'ocv') cell.value = parseFloat(rec.ocv);
              else if (field === 'ccv') cell.value = parseFloat(rec.ccv);
              else if (field === 'time') cell.value = String(rec.time);
            } else {
              cell.value = '';
            }
            return;
          }

          // Inline tags embedded in a string
          const replaced = val.replace(inlineTagRegex, (_match, field, idStr) => {
            const id = parseInt(idStr, 10);
            const rec = dataMap[id];
            if (!rec) return '';
            const f = field.toLowerCase();
            if (f === 'ocv') return rec.ocv != null ? rec.ocv : '';
            if (f === 'ccv') return rec.ccv != null ? rec.ccv : '';
            if (f === 'time') return rec.time != null ? rec.time : '';
            return '';
          });

          if (replaced !== val) cell.value = replaced;
        });
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="battery_report.xlsx"');
    res.send(buffer);
  } catch (e) {
    logger.error('Battery download-report error', { error: e.message });
    res.status(500).json({ error: 'Failed to generate report', detail: e.message });
  }
});

module.exports = router;
