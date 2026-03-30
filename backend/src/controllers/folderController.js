const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

async function listFolders(req, res) {
  const db = getDb();

  const lines = db.prepare(`
    SELECT f.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id AND fi.is_deleted = 0) as file_count
    FROM folders f
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.type = 'line' AND f.is_deleted = 0
    ORDER BY f.name
  `).all();

  const machines = db.prepare(`
    SELECT f.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM files fi WHERE fi.folder_id = f.id AND fi.is_deleted = 0) as file_count
    FROM folders f
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.type = 'machine' AND f.is_deleted = 0
    ORDER BY f.name
  `).all();

  const machinesByParent = {};
  for (const m of machines) {
    if (!machinesByParent[m.parent_id]) machinesByParent[m.parent_id] = [];
    machinesByParent[m.parent_id].push({
      id: m.id,
      name: m.name,
      description: m.description,
      createdBy: m.creator_name,
      createdAt: m.created_at,
      fileCount: m.file_count,
    });
  }

  const result = lines.map(l => ({
    id: l.id,
    name: l.name,
    description: l.description,
    createdBy: l.creator_name,
    createdAt: l.created_at,
    fileCount: l.file_count,
    machines: machinesByParent[l.id] || [],
  }));

  res.json({ lines: result });
}

async function createFolder(req, res) {
  const db = getDb();
  const { name, type, parentId, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Folder name is required' });
  }

  if (!type || !['line', 'machine'].includes(type)) {
    return res.status(400).json({ message: 'type must be "line" or "machine"' });
  }

  if (type === 'machine' && !parentId) {
    return res.status(400).json({ message: 'parentId (line id) is required for machine folders' });
  }

  if (type === 'line' && parentId) {
    return res.status(400).json({ message: 'Line folders cannot have a parent' });
  }

  if (type === 'machine' && parentId) {
    const parent = db.prepare('SELECT id, type FROM folders WHERE id = ? AND is_deleted = 0').get(parentId);
    if (!parent) return res.status(404).json({ message: 'Parent line not found' });
    if (parent.type !== 'line') return res.status(400).json({ message: 'Parent must be a line folder' });
  }

  const id = uuidv4();
  try {
    db.prepare(`
      INSERT INTO folders (id, name, type, parent_id, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), type, parentId || null, description || null, req.user.id);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ message: 'A folder with this name already exists in the same location' });
    }
    throw err;
  }

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'create_folder', 'folder', ?, ?)
  `).run(uuidv4(), req.user.id, id, name.trim());

  logger.info('Folder created', { folderId: id, name, type, userId: req.user.id });

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
  res.status(201).json({
    id: folder.id,
    name: folder.name,
    type: folder.type,
    parentId: folder.parent_id,
    description: folder.description,
    createdAt: folder.created_at,
  });
}

async function updateFolder(req, res) {
  const db = getDb();
  const { name, description } = req.body;
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0').get(req.params.id);

  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ message: 'Folder name cannot be empty' });
  }

  const newName = name !== undefined ? name.trim() : folder.name;
  const newDescription = description !== undefined ? description : folder.description;

  try {
    db.prepare(`
      UPDATE folders SET name = ?, description = ?, updated_at = datetime('now') || 'Z'
      WHERE id = ?
    `).run(newName, newDescription, folder.id);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ message: 'A folder with this name already exists in the same location' });
    }
    throw err;
  }

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'update_folder', 'folder', ?, ?)
  `).run(uuidv4(), req.user.id, folder.id, newName);

  logger.info('Folder updated', { folderId: folder.id, name: newName, userId: req.user.id });

  res.json({ id: folder.id, name: newName, description: newDescription });
}

async function deleteFolder(req, res) {
  const db = getDb();
  const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND is_deleted = 0').get(req.params.id);

  if (!folder) return res.status(404).json({ message: 'Folder not found' });

  // Reject if there are active files in this folder
  const fileCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM files WHERE folder_id = ? AND is_deleted = 0'
  ).get(folder.id).cnt;

  if (fileCount > 0) {
    return res.status(409).json({ message: 'Cannot delete folder with active files' });
  }

  // For line folders, also check if any child machine has files
  if (folder.type === 'line') {
    const childFileCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM files fi
      INNER JOIN folders fo ON fi.folder_id = fo.id
      WHERE fo.parent_id = ? AND fo.is_deleted = 0 AND fi.is_deleted = 0
    `).get(folder.id).cnt;

    if (childFileCount > 0) {
      return res.status(409).json({ message: 'Cannot delete line folder: machines inside still have active files' });
    }

    // Soft-delete child machines too
    db.prepare(`
      UPDATE folders SET is_deleted = 1, updated_at = datetime('now') || 'Z'
      WHERE parent_id = ? AND is_deleted = 0
    `).run(folder.id);
  }

  db.prepare(`
    UPDATE folders SET is_deleted = 1, updated_at = datetime('now') || 'Z'
    WHERE id = ?
  `).run(folder.id);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'delete_folder', 'folder', ?, ?)
  `).run(uuidv4(), req.user.id, folder.id, folder.name);

  logger.info('Folder deleted', { folderId: folder.id, name: folder.name, userId: req.user.id });

  res.json({ message: 'Folder deleted' });
}

module.exports = { listFolders, createFolder, updateFolder, deleteFolder };
