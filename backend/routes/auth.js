const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const authGuard = require('../middleware/auth');
const repo = require('../services/firestoreRepository');

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, group, calendar_url } = req.body;

    if (!name || !email || !password || !group) {
      return res.status(400).json({ error: '��������� ��� ����' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '������ ������ ���� ������� 6 ��������' });
    }

    const exists = await repo.findUserByEmail(email);
    if (exists) {
      return res.status(409).json({ error: 'Email ��� ���������������' });
    }

    const user = await repo.createUser({ name, email, password, group, calendar_url });
    const token = signToken(user._id);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '������ �������' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '��������� ��� ����' });
    }

    const userRecord = await repo.findUserByEmail(email);
    if (!userRecord) {
      return res.status(401).json({ error: '�������� ����� ��� ������' });
    }

    const ok = await repo.verifyPassword(userRecord, password);
    if (!ok) {
      return res.status(401).json({ error: '�������� ����� ��� ������' });
    }

    const token = signToken(userRecord.id);
    res.json({ token, user: userRecord.safe });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '������ �������' });
  }
});

router.post('/telegram', async (req, res) => {
  try {
    const { telegram_id, name = 'Telegram Student', group = '' } = req.body;
    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id ����������' });
    }

    let userRecord = await repo.findUserByTelegramId(telegram_id);
    let user = userRecord?.safe;

    if (!user) {
      user = await repo.createUser({
        name,
        email: '',
        password: '',
        group,
        telegram_id
      });
    }

    const token = signToken(user._id);
    res.json({ token, user });
  } catch (err) {
    console.error('Telegram auth error:', err);
    res.status(500).json({ error: '������ �������' });
  }
});

router.get('/me', authGuard, async (req, res) => {
  res.json({ user: req.user });
});

router.patch('/profile', authGuard, async (req, res) => {
  try {
    const allowed = ['name', 'group', 'avatar', 'settings', 'calendar_url', 'telegram_id'];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    const user = await repo.updateUser(req.user._id, updates);
    res.json({ user });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: '������ �������' });
  }
});

module.exports = router;
