import './lib/env.js';
import { createPool } from './db/index.js';
import { loadConfig } from './lib/config.js';
// The integration lead supplies the verified chain adapter after Gate 1. Never silently broadcast before then.
loadConfig();
const pool=createPool(process.env.DATABASE_URL!);
try {await pool.query('SELECT 1');console.log('Worker database ready; Testnet broadcast adapter is blocked until Gate 1 integration');}
finally {await pool.end();}
