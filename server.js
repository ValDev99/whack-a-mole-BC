// server.js
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { ethers } = require('ethers');

const PORT = process.env.PORT || 3000;
const app = express();

const TOKEN_ID = '0xc97dc948F4e1ced7a0Fc953Bb61Df6c5fCDAA4dd';
const RPC_URL = 'https://polygon-amoy.drpc.org';
const CHAIN_ID = 80002n;
const MAX_SCORE = 100000;

const TOKEN_ABI = [
  'function mint(address recipient, uint256 amount)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const tokenIface = new ethers.Interface(TOKEN_ABI);

const chain = { provider: null, ready: false, decimals: 18, symbol: '', error: null };

async function initChain() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const net = await provider.getNetwork();
    if (net.chainId !== CHAIN_ID) {
      throw new Error(`RPC sur la chaîne ${net.chainId}, attendu ${CHAIN_ID}`);
    }
    if ((await provider.getCode(TOKEN_ID)) === '0x') {
      throw new Error(`aucun contrat à l'adresse ${TOKEN_ID}`);
    }
    const token = new ethers.Contract(TOKEN_ID, TOKEN_ABI, provider);
    try { chain.decimals = Number(await token.decimals()); } catch (_) { }
    try { chain.symbol = await token.symbol(); } catch (_) { chain.symbol = ''; }

    chain.provider = provider;
    chain.ready = true;
    console.log(`[chain] prêt — jeton ${chain.symbol || '?'} ${TOKEN_ID} (decimals ${chain.decimals})`);
  } catch (err) {
    chain.error = err.shortMessage || err.message;
    console.error('[chain] RPC indisponible, les transactions ne seront pas vérifiées : ' + chain.error);
  }
}

async function verifyMint(id, txHash, to, score) {
  if (!chain.ready) return;
  try {
    const tx = await chain.provider.getTransaction(txHash);
    if (!tx) throw new Error('transaction introuvable');
    if (!tx.to || tx.to.toLowerCase() !== TOKEN_ID.toLowerCase()) throw new Error('transaction vers un autre contrat');

    const call = tokenIface.parseTransaction({ data: tx.data });
    const expected = ethers.parseUnits(String(score), chain.decimals);
    if (!call || call.name !== 'mint' ||
        ethers.getAddress(call.args[0]) !== to || call.args[1] !== expected) {
      throw new Error('la transaction ne correspond pas au score');
    }

    const receipt = await tx.wait(1, 10 * 60 * 1000);
    setMint.run(receipt && receipt.status === 1 ? 'confirmed' : 'failed', null, id);
  } catch (err) {
    const msg = err.shortMessage || err.reason || err.message;
    setMint.run('failed', msg, id);
    console.error(`[mint] #${id} ${txHash} : ${msg}`);
  }
}

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

const existingCols = db.prepare('PRAGMA table_info(scores)').all().map(c => c.name);
for (const [col, type] of [['address', 'TEXT'], ['tx_hash', 'TEXT'], ['mint_status', 'TEXT'], ['mint_error', 'TEXT']]) {
  if (!existingCols.includes(col)) db.prepare(`ALTER TABLE scores ADD COLUMN ${col} ${type}`).run();
}

const setMint = db.prepare('UPDATE scores SET mint_status = ?, mint_error = ? WHERE id = ?');
const selectOne = db.prepare(`
  SELECT id, player, score, address, circle_time AS circleTime, created_at AS createdAt,
         tx_hash AS txHash, mint_status AS mintStatus, mint_error AS mintError
  FROM scores WHERE id = ?
`);

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, chainReady: chain.ready, chainError: chain.error });
});

app.get('/api/config', (_req, res) => {
  res.json({
    tokenId: TOKEN_ID,
    symbol: chain.symbol,
    decimals: chain.decimals,
    chainId: '0x' + CHAIN_ID.toString(16)
  });
});

app.post('/api/scores', (req, res) => {
  try {
    
    const { address, score, circleTime, player, txHash, mintError } = req.body || {};
    if (typeof address !== 'string' || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'address must be a valid wallet address' });
    }
    const to = ethers.getAddress(address);
    const numericScore = Number(score);
    if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > MAX_SCORE) {
      return res.status(400).json({ error: `score must be an integer between 0 and ${MAX_SCORE}` });
    }
    const hash = typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? txHash : null;
    let ct = Array.isArray(circleTime) ? circleTime : [];
    // sanitize to numbers
    ct = ct.map(x => Number(x)).filter(x => Number.isFinite(x));
    
    const name = (typeof player === 'string' && player.trim()) ? player.trim().slice(0, 40) : to.slice(0, 6) + '…' + to.slice(-4);
    let status;
    if (hash) status = 'sent';
    else if (numericScore === 0) status = 'skipped';
    else status = 'not_minted';
    const err = !hash && typeof mintError === 'string' ? mintError.slice(0, 200) : null;
    const insert = db.prepare(
      'INSERT INTO scores (player, score, circle_time, address, tx_hash, mint_status, mint_error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const info = insert.run(name, numericScore, JSON.stringify(ct), to, hash, status, err);
    if (hash) {
      console.log(`[mint] #${info.lastInsertRowid} ${numericScore} → ${to} tx ${hash}`);
      verifyMint(info.lastInsertRowid, hash, to, numericScore);
    }
    const row = selectOne.get(info.lastInsertRowid);
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
      SELECT id, player, score, address, tx_hash AS txHash, mint_status AS mintStatus, created_at AS createdAt
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
    //ici modif
    const row = selectOne.get(id);
    //jusqu'a ici modif
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

initChain().finally(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
});
