require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

require('./config/firebase');
const { startTelegramBot } = require('./services/tgService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/chats', require('./routes/chat'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/du', require('./routes/du'));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'firebase-firestore',
    time: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
  startTelegramBot().catch((err) => {
    console.error('Telegram bot start error:', err);
  });
});
