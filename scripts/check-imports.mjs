import fs from 'node:fs';
import path from 'node:path';

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})('src');

const exportsMap = {};
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const names = [...s.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  exportsMap[f] = { names: new Set(names), def: /export\s+default/.test(s) };
}

const problems = [];
const importRe = /import\s+(?:([A-Za-z0-9_]+)\s*,\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.[^"']+)["']/g;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = importRe.exec(s))) {
    const named = (m[2] || '')
      .split(',')
      .map((x) => x.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
    const rel = m[3];
    let tgt = path.normalize(path.join(path.dirname(f), rel));
    if (!tgt.endsWith('.js')) tgt += '.js';
    if (!exportsMap[tgt]) {
      problems.push(`${f}: cannot resolve ${rel}`);
      continue;
    }
    for (const n of named) {
      if (!exportsMap[tgt].names.has(n)) problems.push(`${f}: "${n}" not exported by ${rel}`);
    }
  }
}

console.log('Checked', files.length, 'files. Import problems:', problems.length);
for (const p of problems) console.log('  -', p);
process.exit(problems.length ? 1 : 0);
