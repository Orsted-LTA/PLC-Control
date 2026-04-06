async function deleteFile(req, res) {
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!file) return res.status(404).json({ message: 'File not found' });

  // Only admin or the creator can delete
  if (req.user.role !== 'admin' && file.created_by !== req.user.id) {
    return res.status(403).json({ message: 'Not authorized to delete this file' });
  }

  // Delete physical version files from disk
  const versions = db.prepare('SELECT storage_path FROM versions WHERE file_id = ?').all(file.id);
  for (const v of versions) {
    try { fs.unlinkSync(v.storage_path); } catch (err) {
      logger.warn('Failed to delete version file', { path: v.storage_path, error: err.message });
    }
  }
  // Remove the file's storage directory
  const storageDir = path.join(config.uploadDir, file.id);
  try { fs.rmSync(storageDir, { recursive: true }); } catch (err) {
    logger.warn('Failed to remove storage directory', { dir: storageDir, error: err.message });
  }

  // Delete child records in correct FK order
  // 1. Delete version_comments for all versions of this file
  const versionIds = db.prepare('SELECT id FROM versions WHERE file_id = ?').all(file.id);
  for (const v of versionIds) {
    db.prepare('DELETE FROM version_comments WHERE version_id = ?').run(v.id);
  }
  // 2. Delete file_tags
  db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(file.id);
  // 3. Delete file_subscriptions
  db.prepare('DELETE FROM file_subscriptions WHERE file_id = ?').run(file.id);
  // 4. Delete version records
  db.prepare('DELETE FROM versions WHERE file_id = ?').run(file.id);

  db.prepare(`
    UPDATE files SET is_deleted = 1, deleted_by = ?, deleted_at = datetime('now') || 'Z', updated_at = datetime('now') || 'Z'
    WHERE id = ?
  `).run(req.user.id, file.id);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'delete_file', 'file', ?, ?)
  `).run(uuidv4(), req.user.id, file.id, file.name);

  logger.info('File deleted', { fileId: file.id, fileName: file.name, userId: req.user.id });

  // Broadcast notification
  broadcast({
    type: 'file_deleted',
    fileId: file.id,
    fileName: file.name,
    userName: req.user.display_name,
    timestamp: new Date().toISOString(),
  });

  res.json({ message: 'File deleted' });
}