const express = require('express');
const router = express.Router();
const {
  authenticateUser,
  createSession,
  markUserLogin,
  destroySession,
  buildSessionCookie,
  buildClearSessionCookie
} = require('../services/authService');
const { createAuditLog } = require('../services/auditLogService');

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان.' });
  }

  try {
    const user = await authenticateUser(username, password);

    if (!user) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    const session = await createSession(user.id);
    await markUserLogin(user.id);
    const nextUser = {
      ...user,
      last_login_at: new Date().toISOString()
    };

    res.setHeader('Set-Cookie', buildSessionCookie(session.token));
    req.currentUser = nextUser;

    await createAuditLog({
      req,
      actionType: 'login',
      entityType: 'user',
      entityId: user.id,
      entityCode: user.username,
      summary: `تم تسجيل الدخول بواسطة ${user.display_name}.`,
      afterData: nextUser
    });

    res.json({
      user: nextUser
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const currentUser = req.currentUser;

    if (req.sessionToken) {
      await destroySession(req.sessionToken);
    }

    if (currentUser) {
      await createAuditLog({
        req,
        actionType: 'logout',
        entityType: 'user',
        entityId: currentUser.id,
        entityCode: currentUser.username,
        summary: `تم تسجيل الخروج بواسطة ${currentUser.display_name}.`,
        beforeData: currentUser
      });
    }

    res.setHeader('Set-Cookie', buildClearSessionCookie());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', async (req, res) => {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول.' });
  }

  res.json({
    user: req.currentUser
  });
});

module.exports = router;
