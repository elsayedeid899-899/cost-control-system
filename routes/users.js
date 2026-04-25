const express = require('express');
const router = express.Router();
const { listUsers, createUser, updateUser, getUserById } = require('../services/authService');
const { createAuditLog } = require('../services/auditLogService');

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'هذه الشاشة متاحة لمدير النظام فقط.' });
  }

  next();
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  try {
    const users = await listUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const role = String(req.body.role || '').trim();
  const password = String(req.body.password || '');
  const isActive = req.body.is_active !== false;

  try {
    const user = await createUser({
      username,
      displayName,
      role,
      password,
      isActive
    });

    await createAuditLog({
      req,
      actionType: 'create',
      entityType: 'user',
      entityId: user.id,
      entityCode: user.username,
      summary: `تم إنشاء المستخدم ${user.display_name}.`,
      afterData: user
    });

    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const userId = Number(req.params.id || 0);

  if (!userId) {
    return res.status(400).json({ error: 'رقم المستخدم مطلوب.' });
  }

  try {
    const beforeUser = await getUserById(userId);

    if (!beforeUser) {
      return res.status(404).json({ error: 'المستخدم غير موجود.' });
    }

    if (beforeUser.id === req.currentUser.id && req.body.is_active === false) {
      return res.status(400).json({ error: 'لا يمكن تعطيل المستخدم الحالي.' });
    }

    const user = await updateUser(userId, {
      displayName: req.body.display_name,
      role: req.body.role,
      isActive: req.body.is_active,
      password: req.body.password
    });

    await createAuditLog({
      req,
      actionType: 'update',
      entityType: 'user',
      entityId: user.id,
      entityCode: user.username,
      summary: `تم تعديل المستخدم ${user.display_name}.`,
      beforeData: beforeUser,
      afterData: user
    });

    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
