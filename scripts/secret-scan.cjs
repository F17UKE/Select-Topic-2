const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const forbiddenPaths = [
  /(^|\/)\.env(?:$|\.)/,
  /(^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx|ppk)$/i,
  /(^|\/)(?:pgdata(?:-[^/]*)?|postgres-data|node_modules|\.next)(?:\/|$)/i,
  /(^|\/)backend\/storage(?:\/|$)/i,
  /(^|\/)backend\/\.runtime(?:\/|$)/i,
];
const allowedEnvExamples = /(^|\/)\.env(?:\.[^/]*)?\.example$/;
const contentPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]+@/i,
];
const secretAssignment = /^(?:INTEGRATION_SETTINGS_ENCRYPTION_KEY|DB_PASSWORD|LINE_CHANNEL_SECRET|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|LINE_WEBHOOK_SECRET|CHECKSLIP_API_KEY|EASYSLIP_API_KEY|SLIP_OBJECT_STORAGE_ACCESS_KEY|SLIP_OBJECT_STORAGE_SECRET_KEY)[ \t]*=[ \t]*(.+)$/gm;

const findings = [];
for (const relative of listed) {
  const normalized = relative.replaceAll('\\', '/');
  if (forbiddenPaths.some((pattern) => pattern.test(normalized)) && !allowedEnvExamples.test(normalized)) {
    findings.push(`${normalized}: forbidden runtime/secret path`);
    continue;
  }
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const body = fs.readFileSync(absolute);
  if (body.includes(0)) continue;
  const text = body.toString('utf8');
  if (contentPatterns.some((pattern) => pattern.test(text))) findings.push(`${normalized}: credential-like content`);
  for (const match of text.matchAll(secretAssignment)) {
    const value = match[1].trim();
    const permittedExample = allowedEnvExamples.test(normalized)
      && (!value || value === 'select_topic_2_local_only' || /^(?:YOUR_|<)[A-Z0-9_<>-]+$/.test(value));
    if (!permittedExample) findings.push(`${normalized}: non-placeholder secret assignment`);
  }
}

if (findings.length) {
  console.error(`FAIL secret scan (${findings.length} finding(s))`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`PASS secret scan: ${listed.length} tracked/unignored files, zero credential or runtime-artifact findings`);
}
