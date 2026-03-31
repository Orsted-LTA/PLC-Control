const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { runBackup, listBackups, deleteBackup, getDirSize } = require('../utils/backup');
const logger = require('../utils/logger');

// POST /api/admin/backup — trigger manual backup
router.post('/backup', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = runBackup();
    logger.info('Manual backup triggered', { user: req.user.id, backup: result.name });
    res.json({
      message: 'Backup created successfully',
      backup: {
        name: result.name,
        size: result.size,
        createdAt: result.createdAt,
      },
    });
  } catch (err) {
    logger.error('Manual backup failed', { error: err.message });
    res.status(500).json({ message: 'Backup failed', error: err.message });
  }
});

// GET /api/admin/backups — list available backups
router.get('/backups', authenticateToken, requireAdmin, (req, res) => {
  try {
    const backups = listBackups();
    res.json({
      data: backups.map(b => ({
        name: b.name,
        size: b.size,
        createdAt: b.createdAt,
      })),
    });
  } catch (err) {
    logger.error('Failed to list backups', { error: err.message });
    res.status(500).json({ message: 'Failed to list backups', error: err.message });
  }
});

// DELETE /api/admin/backups/:name — delete a specific backup
router.delete('/backups/:name', authenticateToken, requireAdmin, (req, res) => {
  try {
    deleteBackup(req.params.name);
    logger.info('Backup deleted', { user: req.user.id, backup: req.params.name });
    res.json({ message: 'Backup deleted successfully' });
  } catch (err) {
    if (err.message === 'Backup not found') {
      return res.status(404).json({ message: 'Backup not found' });
    }
    if (err.message === 'Invalid backup name' || err.message === 'Invalid backup path') {
      return res.status(400).json({ message: err.message });
    }
    logger.error('Failed to delete backup', { error: err.message });
    res.status(500).json({ message: 'Failed to delete backup', error: err.message });
  }
});

module.exports = router;
