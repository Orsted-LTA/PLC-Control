const path = require('path');
const fs = require('fs');
const { getDb } = require('../models/database');
const { createUnifiedDiff } = require('../utils/diff');
const logger = require('../utils/logger');

async function getVersion(req, res) {
  const db = getDb();
  const version = db.prepare(`
    SELECT v.*, u.display_name as uploaded_by_name
    FROM versions v
    LEFT JOIN users u ON v.uploaded_by = u.id
    WHERE v.id = ?
  `).get(req.params.id);

  if (!version) return res.status(404).json({ message: 'Version not found' });

  res.json({
    id: version.id,
    fileId: version.file_id,
    versionNumber: version.version_number,
    size: version.size,
    checksum: version.checksum,
    mimeType: version.mime_type,
    isBinary: !!version.is_binary,
    commitMessage: version.commit_message,
    uploadedBy: version.uploaded_by_name,
    createdAt: version.created_at,
  });
}

async function downloadVersion(req, res) {
  const db = getDb();
  const version = db.prepare(`
    SELECT v.*, f.name as file_name
    FROM versions v
    LEFT JOIN files f ON v.file_id = f.id
    WHERE v.id = ?
  `).get(req.params.id);

  if (!version) return res.status(404).json({ message: 'Version not found' });

  if (!fs.existsSync(version.storage_path)) {
    return res.status(410).json({ message: 'Version file not found on disk' });
  }

  const ext = path.extname(version.file_name);
  const downloadName = `${path.basename(version.file_name, ext)}_v${version.version_number}${ext}`;

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
  res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', version.size);
  fs.createReadStream(version.storage_path).pipe(res);
}

async function diffVersions(req, res) {
  const { fromId, toId } = req.query;
  if (!fromId || !toId) {
    return res.status(400).json({ message: 'fromId and toId required' });
  }

  const db = getDb();
  const fromVersion = db.prepare('SELECT * FROM versions WHERE id = ?').get(fromId);
  const toVersion = db.prepare('SELECT * FROM versions WHERE id = ?').get(toId);

  if (!fromVersion || !toVersion) {
    return res.status(404).json({ message: 'One or both versions not found' });
  }

  // Both must belong to the same file
  if (fromVersion.file_id !== toVersion.file_id) {
    return res.status(400).json({ message: 'Versions must belong to the same file' });
  }

  // For binary files, return metadata diff only
  if (fromVersion.is_binary || toVersion.is_binary) {
    return res.json({
      isBinary: true,
      from: {
        id: fromVersion.id,
        versionNumber: fromVersion.version_number,
        size: fromVersion.size,
        checksum: fromVersion.checksum,
        createdAt: fromVersion.created_at,
      },
      to: {
        id: toVersion.id,
        versionNumber: toVersion.version_number,
        size: toVersion.size,
        checksum: toVersion.checksum,
        createdAt: toVersion.created_at,
      },
    });
  }

  // Text diff
  try {
    const fromContent = fs.readFileSync(fromVersion.storage_path, 'utf8');
    const toContent = fs.readFileSync(toVersion.storage_path, 'utf8');

    const diff = createUnifiedDiff(
      fromContent,
      toContent,
      `v${fromVersion.version_number}`,
      `v${toVersion.version_number}`
    );

    res.json({
      isBinary: false,
      from: {
        id: fromVersion.id,
        versionNumber: fromVersion.version_number,
        size: fromVersion.size,
        createdAt: fromVersion.created_at,
      },
      to: {
        id: toVersion.id,
        versionNumber: toVersion.version_number,
        size: toVersion.size,
        createdAt: toVersion.created_at,
      },
      diff,
    });
  } catch (err) {
    logger.error('Diff failed', { error: err.message });
    res.status(500).json({ message: 'Failed to compute diff' });
  }
}

async function restoreVersion(req, res) {
  const { v4: uuidv4 } = require('uuid');
  const config = require('../config');
  const { computeChecksum, detectBinary } = require('../utils/fileUtils');

  const db = getDb();
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(req.params.id);
  if (!version) return res.status(404).json({ message: 'Version not found' });

  const file = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0').get(version.file_id);
  if (!file) return res.status(404).json({ message: 'File not found' });

  // Check if already latest version
  const latestVersion = db
    .prepare('SELECT id, checksum FROM versions WHERE file_id = ? ORDER BY version_number DESC LIMIT 1')
    .get(file.id);

  if (latestVersion && latestVersion.checksum === version.checksum) {
    return res.status(409).json({ message: 'This version is already the latest' });
  }

  // Copy the version file to a new version
  const newVersionNumber = latestVersion ? latestVersion.version_number + 1 : 1;
  const newVersionId = uuidv4();
  const storageDir = path.join(config.uploadDir, file.id);
  const newStoragePath = path.join(storageDir, `v${newVersionNumber}_${newVersionId}`);

  fs.copyFileSync(version.storage_path, newStoragePath);

  db.prepare(`
    INSERT INTO versions (id, file_id, version_number, storage_path, size, checksum, mime_type, is_binary, commit_message, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newVersionId, file.id, newVersionNumber, newStoragePath,
    version.size, version.checksum, version.mime_type, version.is_binary,
    `Restored from v${version.version_number}`,
    req.user.id
  );

  db.prepare("UPDATE files SET updated_at = datetime('now') WHERE id = ?").run(file.id);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name, details)
    VALUES (?, ?, 'restore_version', 'file', ?, ?, ?)
  `).run(
    uuidv4(), req.user.id, file.id, file.name,
    JSON.stringify({ restoredFrom: version.version_number, newVersion: newVersionNumber })
  );

  res.json({
    message: `Restored to v${version.version_number} as new v${newVersionNumber}`,
    version: { id: newVersionId, versionNumber: newVersionNumber },
  });
}

module.exports = { getVersion, downloadVersion, diffVersions, restoreVersion };
