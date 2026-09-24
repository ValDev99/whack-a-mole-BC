// server.js
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Init DB
const dbPath = path.join(dataDir, 'scores.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.prepare(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player TEXT NOT NULL,
    score INTEGER NOT NULL,
    circle_time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`).run();

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/scores', (req, res) => {
  try {
    const { player, score, circleTime } = req.body || {};
    if (typeof player !== 'string' || player.trim() === '') {
      return res.status(400).json({ error: 'player is required' });
    }
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) {
      return res.status(400).json({ error: 'score must be a number' });
    }
    let ct = Array.isArray(circleTime) ? circleTime : [];
    // sanitize to numbers
    ct = ct.map(x => Number(x)).filter(x => Number.isFinite(x));
    const insert = db.prepare(
      'INSERT INTO scores (player, score, circle_time) VALUES (?, ?, ?)'
    );
    const info = insert.run(player.trim(), Math.floor(numericScore), JSON.stringify(ct));
    const row = db.prepare('SELECT id, player, score, circle_time AS circleTime, created_at AS createdAt FROM scores WHERE id = ?').get(info.lastInsertRowid);
    row.circleTime = JSON.parse(row.circleTime || '[]');
    return res.status(201).json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/scores', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, player, score, created_at AS createdAt
      FROM scores
      ORDER BY score DESC, created_at DESC
      LIMIT 50
    `).all();
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/scores/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const row = db.prepare(`
      SELECT id, player, score, circle_time AS circleTime, created_at AS createdAt
      FROM scores WHERE id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    row.circleTime = JSON.parse(row.circleTime || '[]');
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Serve static frontend
app.use('/', express.static(path.join(__dirname, 'play')));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'play', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});