const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

async function listUsers(req, res) {
  const db = getDb();
  const users = db
    .prepare('SELECT id, username, display_name, role, is_active, avatar_url, created_at FROM users ORDER BY created_at DESC')
    .all();
  res.json(users.map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    isActive: !!u.is_active,
    avatarUrl: u.avatar_url,
    createdAt: u.created_at,
  })));
}

async function createUser(req, res) {
  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ message: 'username, password, displayName required' });
  }
  if (!['admin', 'user', 'viewer'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role. Use: admin, user, viewer' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ message: 'Username already exists' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, username.trim().toLowerCase(), passwordHash, displayName.trim(), role);

  // Log activity
  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'create_user', 'user', ?, ?)
  `).run(uuidv4(), req.user.id, id, username);

  logger.info('User created', { createdBy: req.user.id, newUser: username });
  res.status(201).json({ id, username: username.trim().toLowerCase(), displayName: displayName.trim(), role });
}

async function getUser(req, res) {
  const db = getDb();
  const user = db
    .prepare('SELECT id, username, display_name, role, is_active, avatar_url, created_at FROM users WHERE id = ?')
    .get(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isActive: !!user.is_active,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
  });
}

async function updateUser(req, res) {
  const { displayName, role, isActive } = req.body;
  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Prevent admin from deactivating themselves
  if (req.params.id === req.user.id && isActive === false) {
    return res.status(400).json({ message: 'Cannot deactivate yourself' });
  }

  const updates = [];
  const values = [];

  if (displayName !== undefined) { updates.push('display_name = ?'); values.push(displayName.trim()); }
  if (role !== undefined) {
    if (!['admin', 'user', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    updates.push('role = ?'); values.push(role);
  }
  if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'update_user', 'user', ?, ?)
  `).run(uuidv4(), req.user.id, req.params.id, user.id);

  res.json({ message: 'User updated' });
}

async function deleteUser(req, res) {
  const db = getDb();
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'Cannot delete yourself' });
  }
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  db.prepare('UPDATE users SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);

  db.prepare(`
    INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, entity_name)
    VALUES (?, ?, 'delete_user', 'user', ?, ?)
  `).run(uuidv4(), req.user.id, req.params.id, user.username);

  res.json({ message: 'User deactivated' });
}

async function updateProfile(req, res) {
  const { displayName, avatarUrl } = req.body;
  const db = getDb();

  const updates = ["updated_at = datetime('now')"];
  const values = [];

  if (displayName !== undefined) { updates.unshift('display_name = ?'); values.push(displayName.trim()); }
  if (avatarUrl !== undefined) { updates.unshift('avatar_url = ?'); values.push(avatarUrl || null); }

  if (values.length === 0) return res.status(400).json({ message: 'Nothing to update' });

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  res.json({ message: 'Profile updated' });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newHash, req.user.id);

  // Revoke all refresh tokens
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);

  res.json({ message: 'Password changed successfully' });
}

module.exports = { listUsers, createUser, getUser, updateUser, deleteUser, updateProfile, changePassword };
