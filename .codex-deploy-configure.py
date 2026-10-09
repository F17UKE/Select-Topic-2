#!/usr/bin/env python3
from getpass import getpass
from pathlib import Path
import os, secrets, shutil, subprocess, tempfile

ENV_PATH = Path('/etc/select-topic-2/backend.env')
if os.geteuid() != 0:
    raise SystemExit('Run as root')
if not ENV_PATH.is_file():
    raise SystemExit('Production environment file is missing')

def required(label, secret=False):
    while True:
        value = (getpass(label + ': ') if secret else input(label + ': ')).strip()
        if value and '\n' not in value and '\r' not in value and '\x00' not in value:
            return value
        print('Value is required. Press Ctrl+C to stop without saving.')

def optional(label, default=''):
    value = input(f'{label} [{default}]: ').strip()
    return value or default

print('Configure production integrations. Values are written only to the protected VPS environment file.')
print('Secret prompts do not echo. Press Ctrl+C before completion to make no change.')
values = {
    'LINE_CHANNEL_ID': required('LINE Login Channel ID', True),
    'LINE_CHANNEL_SECRET': required('LINE Messaging Channel Secret / webhook signature secret', True),
    'LINE_LIFF_ID': required('LINE LIFF ID', True),
    'LINE_MESSAGING_MODE': 'real',
    'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN': required('LINE Messaging Channel Access Token', True),
    'PAYMENT_VERIFICATION_MODE': 'easyslip',
    'EASYSLIP_API_BASE_URL': 'https://api.easyslip.com/v2',
    'EASYSLIP_API_KEY': required('EasySlip API Key', True),
    'SLIP_STORAGE_MODE': 'object',
    'SLIP_OBJECT_STORAGE_ENDPOINT': required('S3-compatible HTTPS endpoint'),
    'SLIP_OBJECT_STORAGE_REGION': required('S3-compatible region'),
    'SLIP_OBJECT_STORAGE_BUCKET': required('Private bucket name'),
    'SLIP_OBJECT_STORAGE_ACCESS_KEY': required('S3 access key', True),
    'SLIP_OBJECT_STORAGE_SECRET_KEY': required('S3 secret key', True),
    'SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE': optional('Force path style (true/false)', 'false'),
    'SLIP_OBJECT_STORAGE_CA_FILE': optional('Private CA absolute path (blank for system CA)', ''),
}
if values['SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE'] not in ('true', 'false'):
    raise SystemExit('Force path style must be true or false')
if not values['SLIP_OBJECT_STORAGE_ENDPOINT'].startswith('https://'):
    raise SystemExit('Production object storage endpoint must use HTTPS')
if values['SLIP_OBJECT_STORAGE_CA_FILE'] and not Path(values['SLIP_OBJECT_STORAGE_CA_FILE']).is_file():
    raise SystemExit('Configured CA file does not exist')

db_password = secrets.token_urlsafe(36)
values['DB_PASSWORD'] = db_password
lines = ENV_PATH.read_text(encoding='utf-8').splitlines()
seen, updated = set(), []
for line in lines:
    if line and not line.lstrip().startswith('#') and '=' in line:
        key = line.split('=', 1)[0]
        if key in values:
            updated.append(f'{key}={values[key]}')
            seen.add(key)
            continue
    updated.append(line)
for key, value in values.items():
    if key not in seen:
        updated.append(f'{key}={value}')

backup = ENV_PATH.with_name('backend.env.pre-secrets')
if not backup.exists():
    shutil.copy2(ENV_PATH, backup)
    os.chmod(backup, 0o600)

fd, tmp_name = tempfile.mkstemp(prefix='backend.env.', dir=str(ENV_PATH.parent), text=True)
try:
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(updated) + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp_name, 0o600)
    sql = "ALTER ROLE select_topic_2_prod PASSWORD '" + db_password + "';"
    subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'],
        input=sql, text=True, check=True, stdout=subprocess.DEVNULL,
    )
    os.replace(tmp_name, ENV_PATH)
    os.chmod(ENV_PATH, 0o600)
finally:
    if os.path.exists(tmp_name):
        os.unlink(tmp_name)

print('Production secret configuration saved. No secret values were printed.')
