#!/usr/bin/env node
// Fails if tracked files contain secrets, databases or media files.
//   node scripts/check-secrets.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenNames = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.(db|sqlite|sqlite3|db-wal|db-shm)$/i,
  /\.(mp4|mkv|webm|mov|avi|m4v|wmv|flv|m2ts|mpg|mpeg)$/i,
  /\.(pem|key|p12|pfx)$/i,
];

const secretPatterns = [
  {
    name: 'JWT (Supabase key)',
    re: /eyJhbGciOiJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'Service role assignment',
    re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?[A-Za-z0-9._-]{20,}/,
  },
];

const problems = [];
for (const file of files) {
  if (forbiddenNames.some((re) => re.test(file)))
    problems.push(`${file}: file type must not be committed`);
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > 5 * 1024 * 1024) problems.push(`${file}: larger than 5 MB`);
  if (size > 2 * 1024 * 1024 || /\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of secretPatterns)
    if (re.test(text)) problems.push(`${file}: looks like a ${name}`);
}

if (problems.length) {
  console.error('Secret/media check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Secret/media check passed (${files.length} tracked files).`);
