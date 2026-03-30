const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const config = require('../config');
const { computeChecksum, detectBinary } = require('../utils/fileUtils');
const logger = require('../utils/logger');
const { runCleanup } = require('../utils/cleanup');

async function listFiles(req, res) {
  const db = getDb();
  const { search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `
    SELECT f.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM versions v WHERE v.file_id = f.id) as version_count,
      (SELECT v2.created_at FROM versions v2 WHERE v2.file_id = f.id ORDER BY v2.version_number DESC LIMIT 1) as last_modified,
      (SELECT v3.size FROM versions v3 WHERE v3.file_id = f.id ORDER BY v3.version_number DESC LIMIT 1) as current_size
    FROM files f
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.is_deleted = 0
  `;

  const params = [];
  if (search) {
    query += ' AND (f.name LIKE ? OR f.path LIKE ? OR f.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM (${query})`).get(...params).cnt;

  query += ' ORDER BY f.updated_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const files = db.prepare(query).all(...params);

  res.json({
    data: files.map(f => ({
      id: f.id,
      name: f.name,
      path: f.path,
      description: f.description,
      versionCount: f.version_count,
      lastModified: f.last_modified,
      currentSize: f.current_size,
      createdBy: f.creator_name,
      createdAt: f.created_at,
    })),
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  });
}

async function uploadFile(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const db = getDb();
  const { commitMessage, description, filePath = '/' } = req.body;
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;

  // Check if file with same name in same path already exists
  let file = db
    .prepare("SELECT * FROM files WHERE name = ? AND path = ? AND is_deleted = 0")
    .get(originalName, normalizedPath);

  let isNewFile = false;
  if (!file) {
    // Create new file record
    file = {
      id: uuidv4(),
      name: originalName,
      path: normalizedPath,
      description: description || null,
      created_by: req.user.id,
    };
    db.prepare(`
      INSERT INTO files (id, name, path, description, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(file.id, file.name, file.path, file.description, file.created_by);
    isNewFile = true;
  } else if (description !== undefined) {
    db.prepare("UPDATE files SET description = ?, updated_at = datetime('now') || 'Z' WHERE id = ?")
      .run(description, file.id);
  }

  // Get next version number
  const lastVersion = db
    .prepare('SELECT version_number FROM versions WHERE file_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(file.id);
  const versionNumber = lastVersion ? lastVersion.version_number + 1 : 1;

  // Compute checksum
  const checksum = await computeChecksum(req.file.path);

  // Check if content is identical to last version
  if (!isNewFile) {
    const lastVer = db
      .prepare('SELECT checksum FROM versions WHERE file_id = ? ORDER BY version_number DESC LIMIT 1')
      .get(file.id);
    if (lastVer && lastVer.checksum === checksum) {
      // Cleanup the temp uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ message: 'File content is identical to the latest version' });
    }
  }

  // Determine binary type
  const isBinary = detectBinary(req.file.path, req.file.mimetype);

  // Move file to versioned storage
  const versionId = uuidv4();
  const storageDir = path.join(config.uploadDir, file.id);
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  const storagePath = path.join(storageDir, `v${versionNumber}_${versionId}`);
  fs.copyFileSync(req.file.path, storagePath);
  try { fs.unlinkSync(req.file.path); } catch {}

  // Create version record
  db.prepare(`
    INSERT INTO versions (id, file_id, version_number, storage_path, size, checksum, mime_type, is_binary, commit_message, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, file.id, versionNumber, storagePath,
    req.file.size, checksum,
    req.file.mimetype || null,
    isBinary ? 1 : 0,
    commitMessage || null,
    req.user.id
  );

  // Update file updated_at
  db.prepare("UPDATE files SET updated_at = datetime('now') || 'Z' WHERE id = ?").run(file.id);

  // Log activity
  const action = isNewFile ? 'add_file' : 'update_file';
  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name, details)
    VALUES (?, ?, ?, 'file', ?, ?, ?)
  `).run(
    uuidv4(), req.user.id, action, file.id, originalName,
    JSON.stringify({ versionNumber, commitMessage })
  );

  logger.info('File uploaded', { fileId: file.id, fileName: originalName, version: versionNumber, user: req.user.id });

  // Run cleanup asynchronously
  setImmediate(() => {
    try { runCleanup(); } catch (err) { logger.warn('Post-upload cleanup failed', { error: err.message }); }
  });

  res.status(isNewFile ? 201 : 200).json({
    message: isNewFile ? 'File added successfully' : 'File updated successfully',
    file: { id: file.id, name: originalName, path: normalizedPath },
    version: { id: versionId, versionNumber, isBinary: !!isBinary },
  });
}

async function getFile(req, res) {
  const db = getDb();
  const file = db.prepare(`
    SELECT f.*, u.display_name as creator_name
    FROM files f
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.id = ? AND f.is_deleted = 0
  `).get(req.params.id);

  if (!file) return res.status(404).json({ message: 'File not found' });

  const versions = db.prepare(`
    SELECT v.id, v.version_number, v.size, v.checksum, v.mime_type, v.is_binary,
           v.commit_message, v.created_at, u.display_name as uploaded_by_name, u.id as uploaded_by_id
    FROM versions v
    LEFT JOIN users u ON v.uploaded_by = u.id
    WHERE v.file_id = ?
    ORDER BY v.version_number DESC
  `).all(file.id);

  res.json({
    id: file.id,
    name: file.name,
    path: file.path,
    description: file.description,
    createdBy: file.creator_name,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    versions: versions.map(v => ({
      id: v.id,
      versionNumber: v.version_number,
      size: v.size,
      checksum: v.checksum,
      mimeType: v.mime_type,
      isBinary: !!v.is_binary,
      commitMessage: v.commit_message,
      uploadedBy: v.uploaded_by_name,
      uploadedById: v.uploaded_by_id,
      createdAt: v.created_at,
    })),
  });
}

async function deleteFile(req, res) {
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!file) return res.status(404).json({ message: 'File not found' });

  // Only admin or the creator can delete
  if (req.user.role !== 'admin' && file.created_by !== req.user.id) {
    return res.status(403).json({ message: 'Not authorized to delete this file' });
  }

  db.prepare(`
    UPDATE files SET is_deleted = 1, deleted_by = ?, deleted_at = datetime('now') || 'Z', updated_at = datetime('now') || 'Z'
    WHERE id = ?
  `).run(req.user.id, file.id);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'delete_file', 'file', ?, ?)
  `).run(uuidv4(), req.user.id, file.id, file.name);

  logger.info('File deleted', { fileId: file.id, fileName: file.name, userId: req.user.id });
  res.json({ message: 'File deleted' });
}

async function getActivityLog(req, res) {
  const db = getDb();
  const { page = 1, limit = 50, fileId } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `
    SELECT a.*, u.display_name as user_name, u.username
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
  `;
  const params = [];

  if (fileId) {
    query += ' WHERE a.entity_id = ?';
    params.push(fileId);
  }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM (${query})`).get(...params).cnt;

  query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const logs = db.prepare(query).all(...params);

  res.json({
    data: logs.map(l => ({
      id: l.id,
      userId: l.user_id,
      userName: l.user_name,
      username: l.username,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      entityName: l.entity_name,
      details: l.details ? JSON.parse(l.details) : null,
      createdAt: l.created_at,
    })),
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  });
}

async function getDashboardStats(req, res) {
  const db = getDb();

  const stats = {
    totalFiles: db.prepare('SELECT COUNT(*) as cnt FROM files WHERE is_deleted = 0').get().cnt,
    totalVersions: db.prepare('SELECT COUNT(*) as cnt FROM versions').get().cnt,
    totalUsers: db.prepare('SELECT COUNT(*) as cnt FROM users WHERE is_active = 1').get().cnt,
    totalSize: db.prepare('SELECT SUM(size) as total FROM versions').get().total || 0,
  };

  const recentActivity = db.prepare(`
    SELECT a.*, u.display_name as user_name
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
    LIMIT 10
  `).all();

  res.json({
    stats,
    recentActivity: recentActivity.map(l => ({
      id: l.id,
      userName: l.user_name,
      action: l.action,
      entityName: l.entity_name,
      createdAt: l.created_at,
    })),
  });
}

module.exports = { listFiles, uploadFile, getFile, deleteFile, getActivityLog, getDashboardStats };
