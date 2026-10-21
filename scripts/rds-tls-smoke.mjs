// Read-only native connection smoke test. No secrets are written to disk or argv.
// node scripts/rds-tls-smoke.mjs <dotenv-path> [variable-name]
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [envPath, key = 'SQL_URL_MASTER'] = process.argv.slice(2);
if (!envPath) throw new Error('Supply the dotenv file path');
const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find(line =>
  line.slice(0, line.indexOf('=')).trim() === key);
if (!line) throw new Error('Requested database URL variable is missing');
let value = line.slice(line.indexOf('=') + 1).trim();
if ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
let url;
try { url = new URL(value); } catch { throw new Error('Invalid database URL'); }
if (!['mysql:', 'mysql+pymysql:', 'mariadb:'].includes(url.protocol)) {
  throw new Error('This smoke test requires a MySQL/MariaDB URL');
}
const profile = {
  id: 'rds-tls-smoke', name: 'RDS TLS smoke test', engine: 'mariadb',
  host: url.hostname, port: Number(url.port || 3306),
  database: decodeURIComponent(url.pathname.slice(1)),
  username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  tls: true, readOnly: true,
};
const localCargo = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const result = spawnSync(existsSync(localCargo) ? localCargo : 'cargo', [
  'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml',
  'db::rds_tls_tests::rds_verified_tls_connection', '--', '--ignored', '--exact', '--nocapture',
], { input: JSON.stringify(profile), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
// Defensive redaction in case a dependency ever includes credentials in errors.
const redact = text => [profile.password, url.password, value].filter(Boolean)
  .reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), text || '');
process.stdout.write(redact(result.stdout));
process.stderr.write(redact(result.stderr));
if (result.error) console.error('Unable to launch Cargo');
process.exit(result.status ?? 1);
