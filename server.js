const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const TEMP_DIR = path.join(os.tmpdir(), 'nielsen-processor');

// ── When running as a pkg executable, __dirname points inside the snapshot.
//    All user-editable files (index.html, DQChecks, config) must live next to
//    the .exe — so we use process.execPath's directory for those.
const IS_PKG = typeof process.pkg !== 'undefined';
const APP_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

const CONFIG_FILE  = path.join(APP_DIR, 'azure-config.json');
const VAULT_FILE   = path.join(APP_DIR, 'credentials.enc');
const VAULT_KEY_FILE = path.join(APP_DIR, '.vaultkey');   // stores hashed vault password for auto-unlock
const DQ_DIR   = path.join(APP_DIR, 'DQChecks');
const NPM_DIR  = path.join(APP_DIR, 'NPMChecks');
const HTML_FILE = path.join(APP_DIR, 'index.html');
const MASTER_CACHE_FILE = path.join(APP_DIR, 'master_cache.json'); // local JSON cache for state+product master

// ════════════════════════════════════════════════════════════
//  INBUILT ENCRYPTED CREDENTIAL VAULT
//  AES-256-GCM — uses Node.js built-in crypto, no extra packages
//  File: credentials.enc (next to exe)
//  Format: { salt, iv, tag, data } — all base64
// ════════════════════════════════════════════════════════════
const crypto = require('crypto');
const VAULT_ALGO = 'aes-256-gcm';

function vaultDeriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

function vaultEncrypt(plainObj, password) {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = vaultDeriveKey(password, salt);
  const cipher = crypto.createCipheriv(VAULT_ALGO, key, iv);
  const plain  = JSON.stringify(plainObj);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv:   iv.toString('base64'),
    tag:  tag.toString('base64'),
    data: enc.toString('base64')
  };
}

function vaultDecrypt(encObj, password) {
  try {
    const salt = Buffer.from(encObj.salt, 'base64');
    const iv   = Buffer.from(encObj.iv,   'base64');
    const tag  = Buffer.from(encObj.tag,  'base64');
    const data = Buffer.from(encObj.data, 'base64');
    const key  = vaultDeriveKey(password, salt);
    const decipher = crypto.createDecipheriv(VAULT_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return { ok: true, data: JSON.parse(dec.toString('utf8')) };
  } catch(_) {
    return { ok: false, data: null }; // wrong password or tampered file
  }
}

function vaultExists() { return fs.existsSync(VAULT_FILE); }

function vaultSave(plainObj, password) {
  const enc = vaultEncrypt(plainObj, password);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(enc, null, 2), 'utf8');
}

function vaultLoad(password) {
  if (!fs.existsSync(VAULT_FILE)) return { ok: false, data: null, missing: true };
  try {
    const enc = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    return vaultDecrypt(enc, password);
  } catch(_) { return { ok: false, data: null }; }
}

// In-memory session: once unlocked, creds stay in memory for this session
let _vaultSession = null;

function vaultGetSession() { return _vaultSession; }
function vaultSetSession(data) { _vaultSession = data; }
function vaultClearSession() { _vaultSession = null; }

// Save vault password hash to .vaultkey so server can auto-unlock on restart
function saveVaultKey(password) {
  const hash = crypto.createHash('sha256').update(password + 'nielsen-vaultkey-salt').digest('hex');
  fs.writeFileSync(VAULT_KEY_FILE, hash, 'utf8');
}

// Auto-unlock vault on server start if .vaultkey exists
// This means: admin set up vault once, server restarts don't require password entry
// Users never see the vault screen — only the login screen
function autoUnlockVault() {
  if (!vaultExists() || !fs.existsSync(VAULT_KEY_FILE)) return false;
  // .vaultkey contains a hint hash — we try to load vault with stored key
  // Actually we store the password itself encrypted with a machine-specific key
  // For simplicity: store password XOR'd with machine hostname (not cryptographically perfect
  // but prevents casual reading — the vault encryption itself is the real protection)
  try {
    const stored = fs.readFileSync(VAULT_KEY_FILE, 'utf8').trim();
    const machineKey = require('os').hostname() + '-nielsen-2024';
    // XOR decode
    let password = '';
    for (let i = 0; i < stored.length; i += 2) {
      const byte = parseInt(stored.substr(i, 2), 16);
      password += String.fromCharCode(byte ^ machineKey.charCodeAt((i/2) % machineKey.length));
    }
    const result = vaultLoad(password);
    if (result.ok) {
      vaultSetSession(result.data);
      console.log('🔓 Vault auto-unlocked.');
      return true;
    }
  } catch(_) {}
  return false;
}

function saveVaultKeyEncoded(password) {
  const machineKey = require('os').hostname() + '-nielsen-2024';
  let encoded = '';
  for (let i = 0; i < password.length; i++) {
    const byte = password.charCodeAt(i) ^ machineKey.charCodeAt(i % machineKey.length);
    encoded += byte.toString(16).padStart(2, '0');
  }
  fs.writeFileSync(VAULT_KEY_FILE, encoded, 'utf8');
}



// ── Ensure dependencies (only when NOT running as pkg exe) ──
if (!IS_PKG) {
  const { execSync } = require('child_process');
  const deps = ['xlsx', '@azure/storage-blob'];
  let needInstall = deps.some(d => !fs.existsSync(path.join(__dirname, 'node_modules', d)));
  if (needInstall) {
    console.log('📦 Installing dependencies (first run only)...');
    try { execSync('npm install xlsx @azure/storage-blob', { cwd: __dirname, stdio: 'inherit' }); }
    catch (e) { console.error('❌ npm install failed.'); process.exit(1); }
  }
}
console.log('✅ Dependencies ready.\n');

// ── Startup diagnostics (shown in CMD window) ────────────────
console.log('📁 App directory:', APP_DIR);
console.log('📄 index.html:', fs.existsSync(HTML_FILE) ? '✅ found' : '❌ NOT FOUND');
console.log('📁 DQChecks:', fs.existsSync(DQ_DIR) ? '✅ found' : '❌ NOT FOUND');
console.log('🔐 credentials.enc:', fs.existsSync(VAULT_FILE) ? '✅ found' : '⚠ not found (first run)');
console.log('🔑 .vaultkey:', fs.existsSync(VAULT_KEY_FILE) ? '✅ found' : '⚠ not found (first run)');
console.log('');

// Auto-unlock vault on startup (no user interaction needed)
try {
  const unlocked = autoUnlockVault();
  if (!unlocked) console.log('ℹ️  Vault not auto-unlocked (first run or key missing — set up via browser)\n');
} catch(e) {
  console.error('⚠ Vault auto-unlock error (non-fatal):', e.message);
}

const XLSX = require('xlsx');
const { ServiceURL, ContainerURL, BlockBlobURL, StorageURL, AnonymousCredential, Aborter } = require('@azure/storage-blob');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ════════════════════════════════════════════════════════════
//  DQ ENGINE
//  Category detected from FOLDER NAME (local) or BLOB PATH (upload)
// ════════════════════════════════════════════════════════════
const DQ_MAP = {
  'airfreshener':          'AirFreshener',
  'af':                    'AirFreshener',
  'bodywash':              'Bodywash',
  'body_wash':             'Bodywash',
  'condoms':               'Condoms',
  'condom':                'Condoms',
  'deos':                  'Deos',
  'deo':                   'Deos',
  'haircolor_segmentwise': 'HairColor_Segmentwise',
  'haircolor_shadewise':   'HairColor_Shadewise',
  'haircolor_statewise':   'HairColor_Statewise',
  'hc_seg':                'HairColor_Segmentwise',
  'hc_shade':              'HairColor_Shadewise',
  'hc_state':              'HairColor_Statewise',
  'hi':                    'HI',
  'hw_p2l':                'HW_P2L',
  'hw_statewise':          'HW_Statewise',
  'hw_state':              'HW_Statewise',
  'ld':                    'LD',
  'soaps_cumulative':      'Soaps_Cumulative',
  'soaps_skuwise':         'Soaps_Skuwise',
  'soaps_statewise':       'Soaps_Statewise',
  'soaps_sku':             'Soaps_Skuwise',
  'soaps_state':           'Soaps_Statewise',
  'soaps_cum':             'Soaps_Cumulative',
};

function detectDQCategory(folderOrBlobPath) {
  if (!folderOrBlobPath) return null;
  const segments = folderOrBlobPath.replace(/\\/g, '/').split('/').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const seg of segments) {
    if (DQ_MAP[seg]) return DQ_MAP[seg];
  }
  return null;
}

// ── SharePoint DQ loader (falls back to local DQChecks/) ──────
const DQ_SP_CACHE = {}; // category → compiled function (from SharePoint)
const DQ_SP_CACHE_TTL = 5 * 60 * 1000; // 5 min cache
const DQ_SP_TIMESTAMPS = {};

async function fetchDQFromSharePoint(categoryKey) {
  const creds = vaultGetSession();
  if (!creds || !creds.spDqUrl || !creds.spDqToken) return null;
  try {
    const url = `${creds.spDqUrl.replace(/\/$/, '')}/${categoryKey}.js`;
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${creds.spDqToken}`, 'Accept': 'text/plain' }
    });
    if (!r.ok) return null;
    const code = await r.text();
    // Eval in a safe module wrapper
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
    const fn = mod.exports;
    if (typeof fn !== 'function') return null;
    DQ_SP_CACHE[categoryKey] = fn;
    DQ_SP_TIMESTAMPS[categoryKey] = Date.now();
    console.log(`DQ [SharePoint] loaded: ${categoryKey}`);
    return fn;
  } catch(e) {
    console.error(`DQ SharePoint fetch error (${categoryKey}):`, e.message);
    return null;
  }
}

async function loadDQValidatorAsync(categoryKey) {
  const creds = vaultGetSession();
  // Try SharePoint if configured
  if (creds && creds.spDqUrl && creds.spDqToken) {
    const age = Date.now() - (DQ_SP_TIMESTAMPS[categoryKey] || 0);
    if (DQ_SP_CACHE[categoryKey] && age < DQ_SP_CACHE_TTL) return DQ_SP_CACHE[categoryKey];
    const spFn = await fetchDQFromSharePoint(categoryKey);
    if (spFn) return spFn;
    console.log(`DQ SharePoint miss for ${categoryKey} — falling back to local`);
  }
  // Fallback to local DQChecks/
  return loadDQValidator(categoryKey);
}

function loadDQValidator(categoryKey) {
  const dqPath = path.join(DQ_DIR, categoryKey + '.js');
  if (!fs.existsSync(dqPath)) return null;
  try {
    delete require.cache[require.resolve(dqPath)];
    return require(dqPath);
  } catch (e) {
    console.error('DQ load error:', e.message);
    return null;
  }
}

// ── Endpoint: force-refresh DQ from SharePoint ────────────────
// Called by admin when they update DQ files on SharePoint

function runDQ(filePath, categoryKey, allFilesInFolder) {
  if (!categoryKey) return { passed: true, errors: [] };
  const validator = loadDQValidator(categoryKey);
  if (!validator) return { passed: true, errors: [] };
  try {
    const errors = validator(filePath, allFilesInFolder || []);
    return { passed: errors.length === 0, errors };
  } catch (e) {
    return { passed: false, errors: ['DQ runtime error: ' + e.message] };
  }
}

// Run DQ for a group of local files
function runDQBatch(filePaths) {
  return runDQBatchWithOverrides(filePaths, {});
}

// Same as runDQBatch but uses dqOverrides map to override category per folder
// dqOverrides: { folderAbsPath → categoryKey | null }
// null = skip DQ for that folder
function runDQBatchWithOverrides(filePaths, dqOverrides = {}) {
  const byFolder = {};
  for (const fp of filePaths) {
    const dir = path.dirname(fp);
    if (!byFolder[dir]) byFolder[dir] = [];
    byFolder[dir].push(fp);
  }
  const groups = {};
  let allPassed = true;
  for (const [dir, files] of Object.entries(byFolder)) {
    const allNames = (() => { try { return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$')); } catch(_) { return []; } })();
    const folderName = path.basename(dir);
    // Use override if provided, else auto-detect
    const category = (dir in dqOverrides)
      ? dqOverrides[dir]   // null means skip DQ
      : (detectDQCategory(folderName) || detectDQCategory(dir));
    const fileResults = [];
    let groupPassed = true;
    for (const fp of files) {
      const dq = runDQ(fp, category, allNames); // runDQ handles null category → skip
      fileResults.push({ name: path.basename(fp), passed: dq.passed, errors: dq.errors });
      if (!dq.passed) { groupPassed = false; allPassed = false; }
    }
    groups[dir] = { folderName, category, passed: groupPassed, files: fileResults };
  }
  return { passed: allPassed, groups };
}

// ════════════════════════════════════════════════════════════
//  GLOBAL STATE + SSE
// ════════════════════════════════════════════════════════════
let globalFileStatuses = {};
let globalDone = false;
let globalTotal = 0;
const serverSessionId = Date.now().toString(36); // unique per server start

const sseClients = new Set();
function sendSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (e) { sseClients.delete(res); }
  }
}

// ════════════════════════════════════════════════════════════
//  LOCAL FILE PROCESSING
// ════════════════════════════════════════════════════════════
function findExcelFiles(folderPath) {
  let results = [];
  try {
    for (const item of fs.readdirSync(folderPath, { withFileTypes: true })) {
      const fp = path.join(folderPath, item.name);
      if (item.isDirectory()) results = results.concat(findExcelFiles(fp));
      else if (item.isFile() && item.name.toLowerCase().endsWith('.xlsx') && !item.name.startsWith('~$'))
        results.push(fp);
    }
  } catch (_) {}
  return results;
}

function saveAsXlsx(filePath) {
  try {
    const wb = XLSX.readFile(filePath, { cellStyles:true, cellNF:true, cellDates:true, cellFormula:true, sheetStubs:true, bookVBA:true });
    XLSX.writeFile(wb, filePath, { bookType:'xlsx', cellStyles:true, cellDates:true });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// Run saveAsXlsx in a worker thread so it doesn't block the event loop (and SSE)
function saveAsXlsxAsync(filePath) {
  return new Promise((resolve) => {
    const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

    // Inline worker code as a string
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
try {
  const XLSX = require(workerData.xlsxPath);
  const wb = XLSX.readFile(workerData.filePath, {
    cellStyles:true, cellNF:true, cellDates:true,
    cellFormula:true, sheetStubs:true, bookVBA:true
  });
  XLSX.writeFile(wb, workerData.filePath, {
    bookType:'xlsx', cellStyles:true, cellDates:true
  });
  parentPort.postMessage({ success: true });
} catch(e) {
  parentPort.postMessage({ success: false, error: e.message });
}
`;
    // Find xlsx module path
    const xlsxPath = require.resolve('xlsx');

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { filePath, xlsxPath }
    });
    worker.on('message', resolve);
    worker.on('error', (e) => resolve({ success: false, error: e.message }));
    worker.on('exit', (code) => {
      if (code !== 0) resolve({ success: false, error: `Worker exited with code ${code}` });
    });
  });
}

// ── Run NPM checker in a worker thread so XLSX parsing never blocks event loop ──
// This keeps the UI responsive and prevents Excel file handle locks on Windows
function runNpmInWorker(npmCheckerPath, filePaths, masterMarkets, masterProducts, masterProductSegments) {
  return new Promise((resolve, reject) => {
    const { Worker } = require('worker_threads');

    // The worker loads the NPM checker and runs it, then sends result back
    const workerCode = `
const { parentPort, workerData } = require('worker_threads');
try {
  const checker = require(workerData.npmCheckerPath);
  const masterLookup = {
    markets:         new Set((workerData.masterMarkets  || []).map(m => m.replace(/\\s/g,''))),
    products:        new Set((workerData.masterProducts || []).map(p => p.replace(/\\s/g,''))),
    productSegments: new Set((workerData.masterProductSegments || []))
  };
  const result = checker(workerData.filePaths, masterLookup);
  // Convert Maps/Sets to plain objects for postMessage serialisation
  parentPort.postMessage({ ok: true, result });
} catch(e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
`;
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { npmCheckerPath, filePaths, masterMarkets, masterProducts, masterProductSegments }
    });

    worker.on('message', msg => {
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0) reject(new Error(`NPM worker exited with code ${code}`));
    });
  });
}

async function processLocalFiles(files, concurrency = 4, dqOverrides = {}) {
  const results = [];
  let completed = 0;
  globalFileStatuses = {}; globalDone = false; globalTotal = files.length;
  files.forEach(f => { globalFileStatuses[f] = { status: 'pending', error: '' }; });

  // Build sibling lists per folder upfront (fast — just readdir, no XLSX)
  // This is all we need before processing starts
  const folderSiblings = {};   // dir → allXlsxNames[]
  const folderCategory = {};   // dir → categoryKey
  const seen = new Set();
  for (const fp of files) {
    const dir = path.dirname(fp);
    if (!seen.has(dir)) {
      seen.add(dir);
      const folderName = path.basename(dir);
      folderSiblings[dir] = (() => {
        try { return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$')); }
        catch(_) { return []; }
      })();
      folderCategory[dir] = (dir in dqOverrides)
        ? dqOverrides[dir]
        : (detectDQCategory(folderName) || detectDQCategory(dir));
    }
  }

  // Process in parallel batches — DQ runs per-file inline (non-blocking)
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(batch.map(async (file) => {
      globalFileStatuses[file] = { status: 'processing', error: '' };
      sendSSE({ type: 'progress', file, status: 'processing', completed, total: files.length });

      // Save-as in worker thread (non-blocking)
      const saveResult = await saveAsXlsxAsync(file);

      // DQ check inline — only for this file, no upfront batch needed
      let dqFailed = false, dqErrors = [], dqCategory = '';
      if (saveResult.success) {
        const dir = path.dirname(file);
        const category = folderCategory[dir];
        const allNames = folderSiblings[dir] || [];
        if (category) {
          dqCategory = category;
          const dq = runDQ(file, category, allNames);
          dqFailed = !dq.passed;
          dqErrors = dq.errors;
        }
      }

      completed++;
      let status, errorMsg;
      if (!saveResult.success) {
        status = 'error'; errorMsg = saveResult.error;
      } else if (dqFailed) {
        status = 'dq_fail'; errorMsg = dqErrors.join(' | ');
      } else {
        status = 'success'; errorMsg = '';
      }

      const dir = path.dirname(file);
      globalFileStatuses[file] = { status, error: errorMsg };
      results.push({ folder: path.basename(dir), file: path.basename(file), fullPath: file, status, error: errorMsg, dqFailed, dqErrors, dqCategory });
      sendSSE({ type: 'progress', file, status, error: errorMsg, dqFailed, dqErrors, dqCategory, completed, total: files.length });
    }));
  }
  return results;
}

// ════════════════════════════════════════════════════════════
//  AZURE HELPERS — v10 API (CommonJS, fully pkg-compatible)
// ════════════════════════════════════════════════════════════

const AZ_TIMEOUT_MS = 30000; // 30 second timeout on all Azure calls

function makePipeline() {
  return StorageURL.newPipeline(new AnonymousCredential(), {
    retryOptions: { maxTries: 2 },       // don't retry endlessly
    telemetry: { value: 'nielsen/4.0' }
  });
}

function makeAborter() {
  return Aborter.timeout(AZ_TIMEOUT_MS);
}

function parseSasUrl(sasUrl) {
  try {
    const u = new URL(sasUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) return { type: 'container', containerName: parts[0] };
    return { type: 'service', containerName: null };
  } catch (e) { return { type: 'service', containerName: null }; }
}

function getContainerURL(sasUrl, containerName) {
  const pipeline = makePipeline();
  const parsed = parseSasUrl(sasUrl);
  if (parsed.type === 'container') return new ContainerURL(sasUrl, pipeline);
  const u = new URL(sasUrl);
  return ContainerURL.fromServiceURL(new ServiceURL(u.origin + u.search, pipeline), containerName);
}

async function azureConnect(sasUrl) {
  const pipeline = makePipeline();
  const parsed = parseSasUrl(sasUrl);
  if (parsed.type === 'container') {
    const cu = new ContainerURL(sasUrl, pipeline);
    // Use timeout — if SAS is wrong this returns fast instead of hanging
    await cu.listBlobHierarchySegment(makeAborter(), '/', undefined, { maxresults: 1 });
    return { containers: [parsed.containerName], autoContainer: parsed.containerName };
  }
  const u = new URL(sasUrl);
  const su = new ServiceURL(u.origin + u.search, pipeline);
  const containers = [];
  let marker;
  do {
    const res = await su.listContainersSegment(makeAborter(), marker);
    (res.containerItems || []).forEach(c => containers.push(c.name));
    marker = res.nextMarker;
  } while (marker);
  return { containers, autoContainer: null };
}

async function listBlobs(sasUrl, containerName, prefix = '') {
  const cu = getContainerURL(sasUrl, containerName);
  const folders = [], files = [];
  let marker;
  do {
    const res = await cu.listBlobHierarchySegment(makeAborter(), '/', marker, { prefix, maxresults: 500 });
    (res.segment.blobPrefixes || []).forEach(bp => {
      const name = bp.name.slice(prefix.length).replace(/\/$/, '');
      if (name) folders.push({ name, fullPath: bp.name });
    });
    (res.segment.blobItems || []).forEach(b => {
      const fname = path.basename(b.name);
      if (!fname.startsWith('.') && fname !== '__folder__')
        files.push({ name: fname, fullPath: b.name, size: b.properties.contentLength, lastModified: b.properties.lastModified });
    });
    marker = res.nextMarker;
  } while (marker);
  return { folders, files };
}

async function uploadFileToBlob(sasUrl, containerName, blobPath, filePath) {
  const cu = getContainerURL(sasUrl, containerName);
  const bbu = BlockBlobURL.fromContainerURL(cu, blobPath);
  const data = fs.readFileSync(filePath);
  await bbu.upload(makeAborter(), data, data.length, {
    blobHTTPHeaders: { blobContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  });
}

async function createVirtualFolder(sasUrl, containerName, folderPath) {
  const cu = getContainerURL(sasUrl, containerName);
  const marker = (folderPath.endsWith('/') ? folderPath : folderPath + '/') + '.folder';
  const bbu = BlockBlobURL.fromContainerURL(cu, marker);
  await bbu.upload(makeAborter(), Buffer.alloc(0), 0);
  return true;
}

// ════════════════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════════════════
function loadConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  return { savedConnections: [] };
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); } catch (_) {}
}
function getSavedConnections() { return []; } // connections removed - use vault
function upsertSavedConnection(entry) {
  const cfg = loadConfig();
  if (!cfg.savedConnections) cfg.savedConnections = [];
  const idx = cfg.savedConnections.findIndex(c => c.id === entry.id);
  if (idx >= 0) cfg.savedConnections[idx] = entry; else cfg.savedConnections.unshift(entry);
  cfg.savedConnections = cfg.savedConnections.slice(0, 20);
  saveConfig(cfg);
  return cfg.savedConnections;
}
function deleteSavedConnection(id) {
  const cfg = loadConfig();
  cfg.savedConnections = (cfg.savedConnections || []).filter(c => c.id !== id);
  saveConfig(cfg);
  return cfg.savedConnections;
}
function maskSasUrl(u) {
  try { const x = new URL(u); return x.hostname.split('.')[0] + ' · sv=' + (x.searchParams.get('sv')||''); }
  catch(_) { return (u||'').slice(0,30)+'…'; }
}

// ════════════════════════════════════════════════════════════
//  MULTIPART PARSER
// ════════════════════════════════════════════════════════════
function parseMultipart(body, boundary) {
  const parts = {};
  // Normalize boundary — browser sends '--boundary' as delimiter
  const delim    = Buffer.from('\r\n--' + boundary);
  const delimEnd = Buffer.from('--' + boundary);

  // Find all boundary positions
  const positions = [];
  let pos = 0;
  // First boundary (may not have leading \r\n)
  let first = body.indexOf(Buffer.from('--' + boundary));
  if (first === -1) return parts;
  positions.push(first);

  pos = first + boundary.length + 2;
  while (pos < body.length) {
    const next = body.indexOf(delim, pos);
    if (next === -1) break;
    positions.push(next);
    pos = next + delim.length;
  }

  for (let i = 0; i < positions.length - 1; i++) {
    const sectionStart = positions[i] + ('--' + boundary).length + 2; // skip boundary + \r\n
    const sectionEnd   = positions[i + 1];
    if (sectionStart >= sectionEnd) continue;

    const section = body.slice(sectionStart, sectionEnd);

    // Find header/body separator (\r\n\r\n)
    const sep = section.indexOf(Buffer.from('\r\n\r\n'));
    if (sep === -1) continue;

    const hdr = section.slice(0, sep).toString('utf8');
    const val = section.slice(sep + 4);

    // Remove trailing \r\n from value if present
    const trimmedVal = (val[val.length-2] === 0x0D && val[val.length-1] === 0x0A)
      ? val.slice(0, -2) : val;

    const nameMatch = hdr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (hdr.includes('filename=')) {
      parts[name] = trimmedVal; // binary
    } else {
      parts[name] = trimmedVal.toString('utf8').trim();
    }
  }

  return parts;
}

// ════════════════════════════════════════════════════════════
//  HTTP SERVER
// ════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sendJSON = (data, code=200) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  const getBody = () => new Promise(r => { let b=''; req.on('data',d=>b+=d); req.on('end',()=>{ try{r(JSON.parse(b));}catch{r({});} }); });

  if (url.pathname==='/'||url.pathname==='/index.html') {
    if(fs.existsSync(HTML_FILE)){
      res.writeHead(200,{
        'Content-Type':'text/html',
        'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma':'no-cache',
        'Expires':'0'
      });
      res.end(fs.readFileSync(HTML_FILE));
    } else{res.writeHead(404);res.end('index.html not found next to executable');}
    return;
  }

  if (url.pathname==='/events') {
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res); req.on('close',()=>sseClients.delete(res)); return;
  }

  if (url.pathname==='/status') {
    const v=Object.values(globalFileStatuses);
    sendJSON({fileStatuses:globalFileStatuses,done:globalDone,total:globalTotal,
      success:v.filter(s=>s.status==='success').length,errors:v.filter(s=>s.status==='error'||s.status==='dq_fail').length,
      sessionId: serverSessionId}); return;
  }

  // config endpoint removed - all creds in vault now
  if (url.pathname==='/config'&&req.method==='GET') { sendJSON({}); return; } // ADF tab still calls this

  // ── VAULT: Check if vault exists ──────────────────────────────
  if (url.pathname==='/vault-status'&&req.method==='GET') {
    let exists = false;
    if (fs.existsSync(VAULT_FILE)) {
      try {
        const content = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
        // Valid vault file must have these fields
        exists = !!(content.salt && content.iv && content.tag && content.data);
      } catch(_) { exists = false; }
    }
    sendJSON({ exists, unlocked: !!vaultGetSession() }); return;
  }

  // ── VAULT: Save creds when already auto-unlocked (no password needed from browser) ──
  if (url.pathname==='/vault-save-session'&&req.method==='POST') {
    const { creds } = await getBody();
    if (!creds) { sendJSON({ error: 'No credentials provided' }, 400); return; }
    // Only works if vault is currently unlocked (auto-unlock happened on startup)
    if (!vaultGetSession()) { sendJSON({ error: 'Vault not unlocked' }, 401); return; }
    try {
      // Re-derive password from vaultkey file to re-encrypt
      if (!fs.existsSync(VAULT_KEY_FILE)) { sendJSON({ error: 'No vault key found — enter password manually' }, 400); return; }
      const stored = fs.readFileSync(VAULT_KEY_FILE, 'utf8').trim();
      const machineKey = os.hostname() + '-nielsen-2024';
      let password = '';
      for (let i = 0; i < stored.length; i += 2) {
        const byte = parseInt(stored.substr(i, 2), 16);
        password += String.fromCharCode(byte ^ machineKey.charCodeAt((i/2) % machineKey.length));
      }
      vaultSave(creds, password);
      vaultSetSession(creds);
      sendJSON({ ok: true });
    } catch(e) { sendJSON({ error: e.message }, 500); }
    return;
  }

  // ── VAULT: Create / update vault (set password + save creds) ──
  if (url.pathname==='/vault-save'&&req.method==='POST') {
    const { password, creds } = await getBody();
    if (!password || password.length < 6) { sendJSON({ error: 'Password must be at least 6 characters' }, 400); return; }
    if (!creds) { sendJSON({ error: 'No credentials provided' }, 400); return; }
    try {
      vaultSave(creds, password);
      saveVaultKeyEncoded(password); // save encoded key so server auto-unlocks on restart
      vaultSetSession(creds);
      sendJSON({ ok: true });
    } catch(e) { sendJSON({ error: e.message }, 500); }
    return;
  }

  // ── VAULT: Unlock (decrypt with password) — only needed if auto-unlock failed ──
  if (url.pathname==='/vault-unlock'&&req.method==='POST') {
    const { password } = await getBody();
    if (!password) { sendJSON({ error: 'Password required' }, 400); return; }
    const result = vaultLoad(password);
    if (!result.ok) {
      if (result.missing) { sendJSON({ error: 'No vault found. Set up credentials first.' }, 404); }
      else { sendJSON({ error: 'Wrong password' }, 401); }
      return;
    }
    saveVaultKeyEncoded(password); // update stored key
    vaultSetSession(result.data);
    sendJSON({ ok: true, creds: result.data });
    return;
  }

  // ── VAULT: Lock (clear session) ───────────────────────────────
  if (url.pathname==='/vault-lock'&&req.method==='POST') {
    vaultClearSession(); sendJSON({ ok: true }); return;
  }

  // ── VAULT: Get current session creds (if unlocked) ───────────
  if (url.pathname==='/vault-creds'&&req.method==='GET') {
    const session = vaultGetSession();
    if (!session) { sendJSON({ locked: true }, 401); return; }
    sendJSON({ locked: false, creds: session }); return;
  }

  // ── VAULT: Update credentials ─────────────────────────────────
  if (url.pathname==='/vault-update'&&req.method==='POST') {
    const { password, key, value } = await getBody();
    const result = vaultLoad(password);
    if (!result.ok) { sendJSON({ error: 'Wrong password' }, 401); return; }
    result.data[key] = value;
    vaultSave(result.data, password);
    saveVaultKeyEncoded(password);
    vaultSetSession(result.data);
    sendJSON({ ok: true }); return;
  }

  // ── USER AUTH: Login ──────────────────────────────────────────
  // Fetches users.json from blob, validates username+passwordHash
  if (url.pathname==='/user-login'&&req.method==='POST') {
    const { username, passwordHash, sasUrl, container } = await getBody();
    if (!username || !passwordHash) { sendJSON({ error: 'Username and password required' }, 400); return; }
    if (!sasUrl || !container) { sendJSON({ error: 'Not connected to Azure — connect first' }, 400); return; }
    try {
      const cu  = getContainerURL(sasUrl, container);
      const bbu = BlockBlobURL.fromContainerURL(cu, 'nielsen/config/users.json');
      const dl  = await bbu.download(makeAborter(), 0);
      const chunks = [];
      await new Promise((resolve, reject) => {
        dl.readableStreamBody.on('data', d => chunks.push(d));
        dl.readableStreamBody.on('end', resolve);
        dl.readableStreamBody.on('error', reject);
      });
      const users = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const user  = users.find(u =>
        u.username.toLowerCase() === username.toLowerCase() &&
        u.passwordHash === passwordHash
      );
      if (!user) { sendJSON({ error: 'Invalid username or password' }, 401); return; }
      sendJSON({ ok: true, user: { username: user.username, name: user.name, role: user.role } });
    } catch(e) {
      if (e.message && e.message.includes('BlobNotFound')) {
        sendJSON({ error: 'User list not found on blob. Ask admin to set up users.json' }, 404);
      } else {
        sendJSON({ error: 'Login failed: ' + e.message }, 500);
      }
    }
    return;
  }

  // ── AUDIT LOG: Write entry ────────────────────────────────────
  // ── Get machine LAN IP for audit logging ─────────────────────
  if (url.pathname==='/get-machine-ip'&&req.method==='GET') {
    const nets = os.networkInterfaces();
    let ip = '127.0.0.1';
    for (const iface of Object.values(nets)) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
      }
      if (ip !== '127.0.0.1') break;
    }
    sendJSON({ ip });
    return;
  }

  if (url.pathname==='/audit-log'&&req.method==='POST') {
    const { sasUrl, container, username, action, details, ip, machineIp } = await getBody();
    if (!sasUrl || !container || !username || !action) { sendJSON({ ok: false }); return; }
    try {
      const cu      = getContainerURL(sasUrl, container);
      const logPath = 'nielsen/config/audit.log.csv';
      const bbu     = BlockBlobURL.fromContainerURL(cu, logPath);
      // Try to get existing log
      let existing = 'Timestamp,Username,Action,IP Address,Machine IP,Details\n';
      try {
        const dl = await bbu.download(makeAborter(), 0);
        const chunks = [];
        await new Promise((resolve, reject) => {
          dl.readableStreamBody.on('data', d => chunks.push(d));
          dl.readableStreamBody.on('end', resolve);
          dl.readableStreamBody.on('error', reject);
        });
        existing = Buffer.concat(chunks).toString('utf8');
        // Upgrade old format header if needed
        if (!existing.includes('IP Address')) {
          existing = 'Timestamp,Username,Action,IP Address,Machine IP,Details\n' +
            existing.split('\n').slice(1).join('\n');
        }
      } catch(_) {}

      const ts       = new Date().toISOString();
      const det      = String(details || '').replace(/"/g, '""');
      const clientIp = String(ip || req.socket.remoteAddress || '').replace(/"/g,'');
      const machIp   = String(machineIp || '').replace(/"/g,'');
      const line     = `"${ts}","${username}","${action}","${clientIp}","${machIp}","${det}"\n`;
      const updated  = existing + line;
      const buf      = Buffer.from(updated, 'utf8');
      await bbu.upload(makeAborter(), buf, buf.length, {
        blobHTTPHeaders: { blobContentType: 'text/csv' }
      });
      sendJSON({ ok: true });
    } catch(e) { sendJSON({ ok: false, error: e.message }); }
    return;
  }

  if (url.pathname==='/connections'&&req.method==='GET') { sendJSON({connections:getSavedConnections()}); return; }
  if (url.pathname==='/connections'&&req.method==='POST') {
    const b=await getBody();
    const entry={id:b.id||('conn_'+Date.now()),label:b.label||maskSasUrl(b.sasUrl||''),
      encrypted:b.encrypted||null,sasUrl:b.encrypted?null:(b.sasUrl||null),addedAt:new Date().toISOString()};
    sendJSON({ok:true,connections:upsertSavedConnection(entry),entry}); return;
  }
  if (url.pathname==='/connections'&&req.method==='DELETE') {
    const{id}=await getBody(); sendJSON({ok:true,connections:deleteSavedConnection(id)}); return;
  }

  if (url.pathname==='/scan'&&req.method==='POST') {
    const{folder}=await getBody();
    if(!fs.existsSync(folder)){sendJSON({error:'Folder not found.'},400);return;}
    const files=findExcelFiles(folder);
    const byFolder={};
    files.forEach(f=>{
      const dir=path.dirname(f);
      if(!byFolder[dir]) byFolder[dir]={folderName:path.basename(dir),category:detectDQCategory(path.basename(dir))||detectDQCategory(dir),files:[]};
      byFolder[dir].files.push(f);
    });
    sendJSON({files,total:files.length,byFolder}); return;
  }

  if (url.pathname==='/process-local'&&req.method==='POST') {
    const{folder,threads,dqOverrides}=await getBody();
    const files=findExcelFiles(folder);
    if(files.length===0){sendJSON({results:[],message:'No .xlsx files found'});return;}

    // ── Return 200 immediately so the server stays free for Azure calls ──
    sendJSON({ started: true, total: files.length });

    // Fire SSE start right away — browser sees progress bar fill immediately
    sendSSE({ type: 'start', total: files.length });

    // Run processing as a background async job (does NOT block the server)
    setImmediate(async () => {
      try {
        const results = await processLocalFiles(files, threads||4, dqOverrides||{});
        const csvPath = path.join(folder, 'processing_report.csv');
        const lines = ['Folder Name,File Name,Full Path,Status,DQ Failed,Error'];
        results.forEach(r => lines.push(`"${r.folder}","${r.file}","${r.fullPath}","${r.status}","${r.dqFailed}","${r.error}"`));
        fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
        globalDone = true;
        sendSSE({ type: 'done', total: files.length,
          success: results.filter(r=>r.status==='success').length,
          errors: results.filter(r=>r.status==='error').length,
          dqFailed: results.filter(r=>r.dqFailed).length });
      } catch(e) {
        globalDone = true;
        sendSSE({ type: 'done', total: files.length, success: 0, errors: files.length, dqFailed: 0, error: e.message });
      }
    });
    return;
  }

  if (url.pathname==='/az-connect'&&req.method==='POST') {
    const{sasUrl}=await getBody();
    try{
      const result=await azureConnect(sasUrl);
      sendJSON(result);
    }catch(e){sendJSON({error:'Connection failed: '+e.message},400);}
    return;
  }

  if (url.pathname==='/az-list'&&req.method==='POST') {
    const{sasUrl,container,prefix}=await getBody();
    try{sendJSON(await listBlobs(sasUrl,container,prefix||''));}
    catch(e){sendJSON({error:e.message},400);}
    return;
  }

  if (url.pathname==='/az-mkdir'&&req.method==='POST') {
    const{sasUrl,container,folderPath}=await getBody();
    try{await createVirtualFolder(sasUrl,container,folderPath);sendJSON({ok:true,path:folderPath});}
    catch(e){sendJSON({error:e.message},400);}
    return;
  }

  // ── AZURE: DQ batch check (all-or-nothing per category) ──────
  // ── DQ: Force refresh from SharePoint ─────────────────────────
  if (url.pathname==='/dq-refresh'&&req.method==='POST') {
    const creds = vaultGetSession();
    if (!creds || !creds.spDqUrl) { sendJSON({ error: 'No SharePoint URL configured' }); return; }
    // Clear cache so next DQ run re-fetches from SharePoint
    Object.keys(DQ_SP_CACHE).forEach(k => delete DQ_SP_CACHE[k]);
    Object.keys(DQ_SP_TIMESTAMPS).forEach(k => delete DQ_SP_TIMESTAMPS[k]);
    toast && console.log('DQ cache cleared — will re-fetch from SharePoint on next run');
    sendJSON({ ok: true, message: 'DQ cache cleared — next run will fetch from SharePoint' });
    return;
  }

  if (url.pathname==='/az-dq-batch'&&req.method==='POST') {
    const { files, blobSiblings } = await getBody();
    if (!files || files.length === 0) { sendJSON({ passed: true, groups: {} }); return; }

    const groups = {};

    // Pre-load DQ validators — try SharePoint first, fallback to local
    const validatorCache = {};
    const cats = [...new Set(files.map(f => detectDQCategory(f.blobPath)).filter(Boolean))];
    await Promise.all(cats.map(async cat => {
      validatorCache[cat] = await loadDQValidatorAsync(cat);
    }));

    // Process all files in parallel
    await Promise.all(files.map(async (f) => {
      const cat = detectDQCategory(f.blobPath);

      if (!cat) {
        if (!groups['__no_dq__']) groups['__no_dq__'] = { category: null, passed: true, skipped: true, files: [] };
        groups['__no_dq__'].files.push({ name: f.name, blobPath: f.blobPath, passed: true, skipped: true, errors: [] });
        return;
      }

      if (!groups[cat]) groups[cat] = { category: cat, passed: true, files: [] };

      const folderPrefix = f.blobPath.substring(0, f.blobPath.lastIndexOf('/') + 1);
      const allSiblings  = (blobSiblings && blobSiblings[folderPrefix])
        ? blobSiblings[folderPrefix]
        : files.filter(x => x.blobPath.startsWith(folderPrefix)).map(x => x.name);

      const tmp = path.join(TEMP_DIR, 'dqb_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + f.name);
      try {
        fs.writeFileSync(tmp, Buffer.from(f.dataB64, 'base64'));
        const validator = validatorCache[cat];
        let dq = { passed: true, errors: [] };
        if (validator) {
          try {
            const errors = validator(tmp, allSiblings);
            dq = { passed: errors.length === 0, errors };
          } catch(e) {
            dq = { passed: false, errors: ['DQ runtime error: ' + e.message] };
          }
        }
        groups[cat].files.push({ name: f.name, blobPath: f.blobPath, passed: dq.passed, errors: dq.errors });
        if (!dq.passed) groups[cat].passed = false;
      } finally {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(_) {}
      }
    }));

    const allPassed = Object.values(groups).filter(g => !g.skipped).every(g => g.passed);
    sendJSON({ passed: allPassed, groups });
    return;
  }

  // ── AZURE: Upload single file (multipart, drag-drop) ──────────
  if (url.pathname==='/az-upload-file'&&req.method==='POST') {
    const chunks=[];
    req.on('data',d=>chunks.push(d));
    req.on('end',async()=>{
      try{
        const body=Buffer.concat(chunks);
        const ct=req.headers['content-type']||'';
        const bm=ct.match(/boundary=(.+)$/);
        if(!bm){sendJSON({error:'No boundary found in content-type'},400);return;}
        const parts=parseMultipart(body,bm[1]);
        const{sasUrl,container,blobPath}=parts;
        const fileData=parts['file'];
        // Debug: log what fields were parsed
        const parsedFields = Object.keys(parts).map(k => k + '(' + (Buffer.isBuffer(parts[k]) ? parts[k].length+'bytes' : parts[k]?.length) + ')').join(', ');
        if(!sasUrl||!container||!blobPath||!fileData){
          console.log('Missing fields. Parsed:', parsedFields);
          sendJSON({error:`Missing fields. Got: ${parsedFields||'none'}`},400);return;
        }
        const tmp=path.join(TEMP_DIR,'up_'+Date.now()+'_'+path.basename(blobPath));
        fs.writeFileSync(tmp,fileData);
        await uploadFileToBlob(sasUrl,container,blobPath,tmp);
        fs.unlinkSync(tmp);
        sendJSON({ok:true,blobPath});
      }catch(e){sendJSON({error:e.message},500);}
    });
    return;
  }

  // ── ADF: Get OAuth2 token (proxied to avoid CORS) ──────────
  if (url.pathname==='/adf-token'&&req.method==='POST') {
    const { tenantId, clientId, clientSecret } = await getBody();
    if (!tenantId || !clientId || !clientSecret) {
      sendJSON({ error: 'tenantId, clientId and clientSecret are required' }, 400); return;
    }
    try {
      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
      const body = new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        resource:      'https://management.azure.com/'
      });
      const resp = await new Promise((resolve, reject) => {
        const https = require('https');
        const data  = body.toString();
        const u     = new URL(tokenUrl);
        const opts  = {
          hostname: u.hostname, path: u.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
        };
        const req2 = https.request(opts, r => {
          let buf = '';
          r.on('data', d => buf += d);
          r.on('end', () => {
            try { resolve({ status: r.statusCode, body: JSON.parse(buf) }); }
            catch(e) { resolve({ status: r.statusCode, body: { error: buf } }); }
          });
        });
        req2.on('error', reject);
        req2.write(data); req2.end();
      });
      if (resp.status !== 200) {
        sendJSON({ error: resp.body.error_description || resp.body.error || 'Token request failed' }, 400);
      } else {
        sendJSON(resp.body);
      }
    } catch(e) { sendJSON({ error: e.message }, 500); }
    return;
  }

  // ── AZURE: Download blob as text (for master CSV load) ──────
  // ── DATABRICKS: Execute SQL query via REST API ───────────────
  // Uses Databricks SQL Statement Execution API (works with SQL Warehouses)
  // Docs: https://docs.databricks.com/api/workspace/statementexecution
  if (url.pathname==='/db-query'&&req.method==='POST') {
    const { workspaceUrl, token, warehouseId, sql } = await getBody();
    if (!workspaceUrl || !token || !warehouseId || !sql) {
      sendJSON({ error: 'workspaceUrl, token, warehouseId and sql are required' }, 400); return;
    }
    try {
      const https = require('https');

      // Helper to make HTTPS requests to Databricks
      function dbRequest(method, path, body) {
        return new Promise((resolve, reject) => {
          const u    = new URL(workspaceUrl);
          const data = body ? JSON.stringify(body) : null;
          const opts = {
            hostname: u.hostname,
            path,
            method,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
          };
          const req2 = https.request(opts, r => {
            let buf = '';
            r.on('data', d => buf += d);
            r.on('end', () => {
              try { resolve({ status: r.statusCode, body: JSON.parse(buf) }); }
              catch(e) { resolve({ status: r.statusCode, body: { error: buf } }); }
            });
          });
          req2.on('error', reject);
          if (data) req2.write(data);
          req2.end();
        });
      }

      // Step 1: Submit statement
      const submitResp = await dbRequest('POST', '/api/2.0/sql/statements', {
        warehouse_id: warehouseId,
        statement: sql,
        wait_timeout: '30s',   // wait up to 30s for result inline
        on_wait_timeout: 'CONTINUE',
        format: 'JSON_ARRAY',
        disposition: 'INLINE'
      });

      if (submitResp.status !== 200) {
        sendJSON({ error: `Databricks error: ${JSON.stringify(submitResp.body)}` }, 400); return;
      }

      let result = submitResp.body;

      // Step 2: Poll if still running (shouldn't happen often with 30s wait)
      const statementId = result.statement_id;
      let attempts = 0;
      while (result.status?.state === 'RUNNING' || result.status?.state === 'PENDING') {
        if (attempts++ > 20) { sendJSON({ error: 'Databricks query timed out' }, 408); return; }
        await new Promise(r => setTimeout(r, 1500));
        const pollResp = await dbRequest('GET', `/api/2.0/sql/statements/${statementId}`, null);
        result = pollResp.body;
      }

      if (result.status?.state === 'FAILED') {
        sendJSON({ error: result.status.error?.message || 'Query failed' }, 400); return;
      }

      // Step 3: Extract rows + columns
      const columns = (result.manifest?.schema?.columns || []).map(c => c.name);
      const rows    = result.result?.data_array || [];

      // Convert array-of-arrays to array-of-objects
      const records = rows.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i] ?? '');
        return obj;
      });

      sendJSON({ ok: true, columns, records, total: records.length });

      // ── Cache master data to local JSON so NPM checks don't need Databricks ──
      // Detect if this is a state or product master query and cache it
      try {
        const sqlLower = sql.toLowerCase();
        let cacheType = null;
        if (sqlLower.includes('state_master'))   cacheType = 'state';
        if (sqlLower.includes('product_master')) cacheType = 'product';
        if (cacheType) {
          let cache = {};
          try { cache = JSON.parse(fs.readFileSync(MASTER_CACHE_FILE, 'utf8')); } catch(_) {}
          cache[cacheType] = { columns, records, updatedAt: new Date().toISOString() };
          fs.writeFileSync(MASTER_CACHE_FILE, JSON.stringify(cache), 'utf8');
        }
      } catch(_) {} // cache write failure should never affect the response

    } catch(e) { sendJSON({ error: e.message }, 500); }
    return;
  }

  // ── Master cache: read locally cached state+product master ──
  if (url.pathname==='/master-cache'&&req.method==='GET') {
    try {
      if (!fs.existsSync(MASTER_CACHE_FILE)) { sendJSON({ exists: false }); return; }
      const cache = JSON.parse(fs.readFileSync(MASTER_CACHE_FILE, 'utf8'));
      sendJSON({ exists: true, cache });
    } catch(e) { sendJSON({ exists: false, error: e.message }); }
    return;
  }

  // ── NPM: Run NPM check in a worker thread (non-blocking XLSX parsing) ──
  if (url.pathname==='/npm-check'&&req.method==='POST') {
    const { category, filePaths, masterMarkets, masterProducts, masterProductSegments } = await getBody();
    if (!category || !filePaths || filePaths.length === 0) {
      sendJSON({ error: 'category and filePaths required' }, 400); return;
    }
    const npmPath = path.join(NPM_DIR, category + '.js');
    if (!fs.existsSync(npmPath)) {
      sendJSON({ error: `No NPM checker for category: ${category}` }, 400); return;
    }
    try {
      const result = await runNpmInWorker(npmPath, filePaths, masterMarkets, masterProducts, masterProductSegments);
      sendJSON(result);
    } catch(e) { sendJSON({ error: e.message }, 500); }
    return;
  }

  // ── NPM: Check using base64 file data (from browser File objects) ──
  if (url.pathname==='/npm-check-upload'&&req.method==='POST') {
    const { category, files, masterMarkets, masterProducts, masterProductSegments } = await getBody();
    if (!category || !files || files.length === 0) {
      sendJSON({ error: 'category and files required' }, 400); return;
    }
    const npmPath = path.join(NPM_DIR, category + '.js');
    if (!fs.existsSync(npmPath)) {
      sendJSON({ error: `No NPM checker for category: ${category}` }, 400); return;
    }
    const tmpFiles = [];
    try {
      for (const f of files) {
        const tmpPath = path.join(require('os').tmpdir(), `npm_${Date.now()}_${f.name}`);
        fs.writeFileSync(tmpPath, Buffer.from(f.data, 'base64'));
        tmpFiles.push(tmpPath);
      }
      const result = await runNpmInWorker(npmPath, tmpFiles, masterMarkets, masterProducts, masterProductSegments);
      sendJSON(result);
    } catch(e) { sendJSON({ error: e.message }, 500); }
    finally { tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch(_) {} }); }
    return;
  }

  if (url.pathname==='/az-download-text'&&req.method==='POST') {
    const{sasUrl,container,blobPath}=await getBody();
    try {
      const cu  = getContainerURL(sasUrl, container);
      const bbu = BlockBlobURL.fromContainerURL(cu, blobPath);
      const dl  = await bbu.download(makeAborter(), 0);
      const chunks = [];
      await new Promise((resolve, reject) => {
        dl.readableStreamBody.on('data', d => chunks.push(d));
        dl.readableStreamBody.on('end', resolve);
        dl.readableStreamBody.on('error', reject);
      });
      const content = Buffer.concat(chunks).toString('utf8');
      sendJSON({ content });
    } catch(e) { sendJSON({ error: e.message }, 400); }
    return;
  }

  // ── AZURE: Download blob to local temp file (for NPM check) ──
  if (url.pathname==='/az-download-file'&&req.method==='POST') {
    const{sasUrl,container,blobPath}=await getBody();
    try {
      const cu  = getContainerURL(sasUrl, container);
      const bbu = BlockBlobURL.fromContainerURL(cu, blobPath);
      const dl  = await bbu.download(makeAborter(), 0);
      const chunks = [];
      await new Promise((resolve, reject) => {
        dl.readableStreamBody.on('data', d => chunks.push(d));
        dl.readableStreamBody.on('end', resolve);
        dl.readableStreamBody.on('error', reject);
      });
      const buf = Buffer.concat(chunks);
      const tmpFile = path.join(require('os').tmpdir(), 'npm_' + Date.now() + '_' + path.basename(blobPath));
      fs.writeFileSync(tmpFile, buf);
      sendJSON({ localPath: tmpFile });
    } catch(e) { sendJSON({ error: e.message }, 400); }
    return;
  }

  // ── AZURE: Upload text content to blob (for master CSV save) ─
  if (url.pathname==='/az-upload-text'&&req.method==='POST') {
    const{sasUrl,container,blobPath,content,contentType}=await getBody();
    try {
      const cu   = getContainerURL(sasUrl, container);
      const bbu  = BlockBlobURL.fromContainerURL(cu, blobPath);
      const data = Buffer.from(content, 'utf8');
      await bbu.upload(makeAborter(), data, data.length, {
        blobHTTPHeaders: { blobContentType: contentType || 'text/csv' }
      });
      sendJSON({ ok: true, blobPath });
    } catch(e) { sendJSON({ error: e.message }, 400); }
    return;
  }

  if (url.pathname==='/resolve-folder'&&req.method==='POST') {
    const{name}=await getBody();
    const roots=[os.homedir(),path.join(os.homedir(),'Documents'),path.join(os.homedir(),'Desktop'),'D:\\','C:\\'];
    let found=null;
    for(const root of roots){
      try{
        if(!fs.existsSync(root))continue;
        const m=fs.readdirSync(root,{withFileTypes:true}).find(i=>i.isDirectory()&&i.name===name);
        if(m){found=path.join(root,name);break;}
      }catch(_){}
    }
    sendJSON(found?{path:found}:{path:null,suggested:path.join(os.homedir(),name)}); return;
  }

  res.writeHead(404); res.end('Not found');
});

// ── Pre-flight checks ────────────────────────────────────────
if (IS_PKG) {
  // Check index.html and DQChecks exist next to the exe
  if (!fs.existsSync(HTML_FILE)) {
    console.error('\n❌ ERROR: index.html not found!');
    console.error(`   Expected at: ${HTML_FILE}`);
    console.error('   Make sure index.html is in the SAME folder as this app.\n');
    process.exit(1);
  }
  if (!fs.existsSync(DQ_DIR)) {
    console.error('\n❌ ERROR: DQChecks folder not found!');
    console.error(`   Expected at: ${DQ_DIR}`);
    console.error('   Make sure the DQChecks folder is in the SAME folder as this app.\n');
    process.exit(1);
  }
}

// ── Try ports 3000→3005 if one is busy ──────────────────────
function startServer(port) {
  server.listen(port, '127.0.0.1', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   Nielsen Processor v4.0                     ║');
    console.log('║   Save-As + DQ Checks + Azure Upload         ║');
    console.log('╚══════════════════════════════════════════════╝');
    if (IS_PKG) {
      console.log('\n✅ App is running!');
      console.log('\n   Open Chrome or Edge and go to:');
      console.log(`\n   ➜  http://localhost:${port}`);
      console.log('\n   Keep this window open while using the app.');
      console.log('   Close this window when you are done.\n');
    } else {
      console.log(`\n✅ Running → http://localhost:${port}\n`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (port < 3005) {
        console.log(`   Port ${port} busy, trying ${port + 1}...`);
        server.removeAllListeners('error');
        startServer(port + 1);
      } else {
        console.error('\n❌ ERROR: Ports 3000-3005 are all in use.');
        console.error('   Close other applications and try again.\n');
        process.exit(1);
      }
    } else {
      console.error('\n❌ Server error:', err.message);
      process.exit(1);
    }
  });
}

startServer(PORT);

// Catch any unhandled errors so they show in CMD window instead of silent crash
process.on('uncaughtException', (err) => {
  console.error('\n❌ UNHANDLED ERROR (this caused the crash):');
  console.error('   ' + err.message);
  console.error('   ' + (err.stack || '').split('\n')[1] || '');
  console.error('\nPress any key to close...');
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ UNHANDLED PROMISE REJECTION:');
  console.error('   ' + reason);
  console.error('\nPress any key to close...');
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(1));
});

