"""SMTP credentials are read from stdin; never log messages or secrets."""
import json
import smtplib
import ssl
import sys
from email.message import EmailMessage

try:
    config = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    message = EmailMessage()
    message['Subject'] = 'LocalForge – e-mail-cím megerősítése'
    message['From'] = config['sender']
    message['To'] = config['email']
    message.set_content('Szia ' + config['name'] + '!\n\nErősítsd meg az e-mail-címedet:\n' + config['url'] + '\n\nA link 24 óráig érvényes, és egyszer használható. Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet.')
    context = ssl.create_default_context()
    if config['mode'] not in ('starttls', 'tls'):
        raise ValueError('TLS required')
    connection = smtplib.SMTP_SSL(config['host'], config['port'], timeout=15, context=context) if config['mode'] == 'tls' else smtplib.SMTP(config['host'], config['port'], timeout=15)
    with connection as smtp:
        if config['mode'] == 'starttls':
            smtp.starttls(context=context)
        if config['username']:
            smtp.login(config['username'], config['password'])
        smtp.send_message(message)
except Exception:
    sys.exit(1)
