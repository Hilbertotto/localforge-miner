"""No real credentials, network calls or output of the test payload."""
import json
from pathlib import Path
import sys

payload = json.loads(sys.stdin.buffer.readline().decode('ascii'))
assert payload['password'] == 'test-\u00e1\u00e9\u0151\u0171-\U0001f512'
assert payload['sudoPassword'] == 'test-\u00e1\u00e9\u0151\u0171-\U0001f512'
root = Path(__file__).resolve().parents[1]
assert (root / 'server.mjs').is_file()
assert Path(payload['root']) == root
print('Unicode path and synthetic passwords survived ASCII PowerShell pipeline')
