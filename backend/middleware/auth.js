const jwt = require('jsonwebtoken');
const repo = require('../services/firestoreRepository');

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: '��������� �����������' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await repo.getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: '������������ �� ������' });
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: '���������������� �����' });
  }
};
