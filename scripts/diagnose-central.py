"""Read-only connection diagnostics; credentials and backup bodies never print."""
import importlib.util
import json
from pathlib import Path
import shlex
import sys

spec = importlib.util.spec_from_file_location('remote_connection', Path(__file__).with_name('remote-connection.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)
config = json.load(sys.stdin)
client = remote.connect(config)
script = r"""
import {readFile} from 'node:fs/promises';
import {validateBackup} from '/opt/localforge/src/worker-backup.mjs';
const load=async name=>JSON.parse(await readFile('/var/lib/localforge/'+name,'utf8'));
const config=await load('worker-connection.json'),identity=await load('node-identity.json');
try{const r=await fetch(config.server+'/api/worker/poll',{method:'POST',headers:{Authorization:'Bearer '+config.code,'Content-Type':'application/json'},body:JSON.stringify({name:config.name,nodeId:identity.id,results:[],handshake:true}),signal:AbortSignal.timeout(10000)});const data=await r.json();console.log('POLL_HTTP',r.status,'ERROR',data.error||null,'BACKUP',data.backupSummary?.profiles);}catch{console.log('POLL_NETWORK_FAILED');}
try{const backup=validateBackup({schema:1,profiles:await load('profiles.json'),wallets:await load('wallets.json'),watchdog:await load('watchdog.json'),runIds:(await load('running-profiles.json')).ids,oc:await load('oc-settings.json')});console.log('LOCAL_BACKUP_VALID',backup.profiles.length);}catch(e){console.log('LOCAL_BACKUP_ERROR',e.message);}
"""
try:
    remote.run_remote(client, "sudo -S -p '' -u localforge /usr/bin/node --input-type=module -e " + shlex.quote(script), config['sudoPassword'], secrets=(config['password'], config['sudoPassword']))
finally:
    client.close()
