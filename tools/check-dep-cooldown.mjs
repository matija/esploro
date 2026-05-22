#!/usr/bin/env node
/**
 * Dependency cooldown check: refuse packages published < 14 days ago.
 *
 * Usage:
 *   node tools/check-dep-cooldown.mjs          # check both npm and cargo
 *   node tools/check-dep-cooldown.mjs --npm    # npm only
 *   node tools/check-dep-cooldown.mjs --cargo  # cargo only
 *
 * First run with no allowlist → auto-generates .dep-cooldown-allowlist.toml.
 * Subsequent violations require a manual allowlist entry or abort with exit 1.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COOLDOWN_DAYS = 14;
const CONCURRENCY = 8;
const CACHE_PATH = join(ROOT, 'node_modules', '.cache', 'dep-cooldown.json');
const ALLOWLIST_PATH = join(ROOT, '.dep-cooldown-allowlist.toml');

const args = process.argv.slice(2);
const explicitNpm = args.includes('--npm');
const explicitCargo = args.includes('--cargo');
const runNpm = explicitNpm || !explicitCargo;
const runCargo = explicitCargo || !explicitNpm;

// ── Cache ──────────────────────────────────────────────────────────────────

function loadCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { return {}; }
}

function saveCache(cache) {
  try {
    mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch { /* best-effort */ }
}

// ── TOML parsers ───────────────────────────────────────────────────────────

function parseAllowlist(src) {
  const entries = [];
  let cur = null;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line === '[[allowlist]]') { if (cur) entries.push(cur); cur = {}; }
    else if (cur && line.includes(' = ')) {
      const eq = line.indexOf(' = ');
      let val = line.slice(eq + 3).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      cur[line.slice(0, eq).trim()] = val;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

function parseCargoLock(src) {
  const pkgs = [];
  let cur = null;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line === '[[package]]') { if (cur) pkgs.push(cur); cur = {}; }
    else if (cur && line.includes(' = ')) {
      const eq = line.indexOf(' = ');
      let val = line.slice(eq + 3).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      cur[line.slice(0, eq).trim()] = val;
    }
  }
  if (cur) pkgs.push(cur);
  return pkgs.filter(p => p.source?.startsWith('registry+'));
}

function parsePackageLock(src) {
  const lock = JSON.parse(src);
  const pkgs = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link || !entry.version) continue;
    const resolved = entry.resolved ?? '';
    if (resolved && !resolved.startsWith('https://registry.npmjs.org/')) continue;
    const parts = key.split('node_modules/');
    pkgs.push({ name: parts[parts.length - 1], version: entry.version });
  }
  return pkgs;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function fetchRetry(url, opts = {}) {
  let delay = 2000;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;
    const after = res.headers.get('retry-after');
    await new Promise(r => setTimeout(r, after ? parseInt(after) * 1000 : delay));
    delay *= 2;
  }
  throw new Error(`429 persists: ${url}`);
}

async function concurrentMap(items, limit, fn) {
  let idx = 0;
  const results = [];
  async function worker() {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.filter(Boolean);
}

// ── Registry queries ────────────────────────────────────────────────────────

async function populateNpmDates(name, cache) {
  try {
    const res = await fetchRetry(`https://registry.npmjs.org/${name}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const [ver, date] of Object.entries(data.time ?? {})) {
      if (!['created', 'modified', 'unpublished'].includes(ver)) {
        cache[`npm:${name}@${ver}`] = date;
      }
    }
  } catch { /* network error; skip this package */ }
}

async function populateCargoDates(name, cache) {
  try {
    const res = await fetchRetry(`https://crates.io/api/v1/crates/${name}`, {
      headers: {
        'User-Agent': 'esploro-dep-cooldown/1.0 (mmunjako@gmail.com)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const v of data.versions ?? []) {
      if (v.num && v.created_at) cache[`cargo:${name}@${v.num}`] = v.created_at;
    }
  } catch { /* network error; skip this package */ }
}

// ── Allowlist ──────────────────────────────────────────────────────────────

function isAllowed(allowlist, name, version, now) {
  const e = allowlist.find(e => e.package === name && e.version === version);
  if (!e?.expires_at) return false;
  return now < new Date(e.expires_at);
}

// ── Bootstrap writer ───────────────────────────────────────────────────────

function writeBootstrap(violations) {
  const expires = new Date(Date.now() + COOLDOWN_DAYS * 86400000).toISOString().slice(0, 10);
  let toml = `# Auto-generated by tools/check-dep-cooldown.mjs.\n`;
  toml += `# These versions were < ${COOLDOWN_DAYS} days old on first run.\n`;
  toml += `# Entries expire ${expires} — by then they are ≥${COOLDOWN_DAYS} days old.\n\n`;
  for (const v of violations) {
    toml += `[[allowlist]]\npackage = "${v.name}"\nversion = "${v.version}"\nreason = "initial bootstrap"\nexpires_at = "${expires}"\n\n`;
  }
  writeFileSync(ALLOWLIST_PATH, toml);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cache = loadCache();
  const allowlistSrc = existsSync(ALLOWLIST_PATH) ? readFileSync(ALLOWLIST_PATH, 'utf8') : null;
  const allowlist = allowlistSrc ? parseAllowlist(allowlistSrc) : null;
  const now = new Date();

  const npmPkgs = [];
  const cargoPkgs = [];

  if (runNpm) {
    const p = join(ROOT, 'package-lock.json');
    if (existsSync(p)) npmPkgs.push(...parsePackageLock(readFileSync(p, 'utf8')));
  }
  if (runCargo) {
    // Check workspace Cargo.lock at root (covers all workspace members)
    const p = join(ROOT, 'Cargo.lock');
    if (existsSync(p)) cargoPkgs.push(...parseCargoLock(readFileSync(p, 'utf8')));
  }

  // Deduplicate entries, then deduplicate by package name for fetch batching
  const uniqueNpm = [...new Map(npmPkgs.map(p => [`${p.name}@${p.version}`, p])).values()];
  const uniqueCargo = [...new Map(cargoPkgs.map(p => [`${p.name}@${p.version}`, p])).values()];
  const npmNames = [...new Set(uniqueNpm.filter(p => !cache[`npm:${p.name}@${p.version}`]).map(p => p.name))];
  const cargoNames = [...new Set(uniqueCargo.filter(p => !cache[`cargo:${p.name}@${p.version}`]).map(p => p.name))];

  if (npmNames.length + cargoNames.length > 0) {
    process.stdout.write(`[dep-cooldown] Fetching publish dates for ${npmNames.length + cargoNames.length} package(s)…\n`);
    await concurrentMap(npmNames, CONCURRENCY, name => populateNpmDates(name, cache));
    await concurrentMap(cargoNames, CONCURRENCY, name => populateCargoDates(name, cache));
    saveCache(cache);
  }

  // Find violations
  const violations = [];
  for (const p of uniqueNpm) {
    const date = cache[`npm:${p.name}@${p.version}`];
    if (!date) continue;
    const ageDays = (now - new Date(date)) / 86400000;
    if (ageDays < COOLDOWN_DAYS && !isAllowed(allowlist ?? [], p.name, p.version, now)) {
      violations.push({ registry: 'npm', name: p.name, version: p.version, publishedAt: date, ageDays });
    }
  }
  for (const p of uniqueCargo) {
    const date = cache[`cargo:${p.name}@${p.version}`];
    if (!date) continue;
    const ageDays = (now - new Date(date)) / 86400000;
    if (ageDays < COOLDOWN_DAYS && !isAllowed(allowlist ?? [], p.name, p.version, now)) {
      violations.push({ registry: 'cargo', name: p.name, version: p.version, publishedAt: date, ageDays });
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`[dep-cooldown] ✓ All packages pass the ${COOLDOWN_DAYS}-day cooldown.\n`);
    return;
  }

  if (allowlist === null) {
    // First run — bootstrap allowlist and succeed
    writeBootstrap(violations);
    process.stdout.write(`[dep-cooldown] Bootstrap: ${violations.length} package(s) allowlisted in ${ALLOWLIST_PATH}\n`);
    process.stdout.write(`[dep-cooldown] Edit that file to manage ongoing exceptions.\n`);
    return;
  }

  process.stderr.write(`[dep-cooldown] FAIL: ${violations.length} package(s) violate the ${COOLDOWN_DAYS}-day cooldown:\n`);
  for (const v of violations) {
    process.stderr.write(`  ${v.registry}:${v.name}@${v.version}  published ${new Date(v.publishedAt).toISOString().slice(0, 10)}  (${v.ageDays.toFixed(1)} days old)\n`);
  }
  process.stderr.write(`Add an explicit [[allowlist]] entry to ${ALLOWLIST_PATH} to override.\n`);
  process.exit(1);
}

main().catch(e => { process.stderr.write(`[dep-cooldown] Error: ${e.message}\n`); process.exit(1); });
