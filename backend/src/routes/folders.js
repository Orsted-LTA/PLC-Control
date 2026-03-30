const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { listFolders, createFolder, updateFolder, deleteFolder } = require('../controllers/folderController');

router.get('/', authenticateToken, listFolders);
router.post('/', authenticateToken, requireAdmin, createFolder);
router.put('/:id', authenticateToken, requireAdmin, updateFolder);
router.delete('/:id', authenticateToken, requireAdmin, deleteFolder);

module.exports = router;
