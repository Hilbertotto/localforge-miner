import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('apache', Path(__file__).parents[1] / 'scripts' / 'install-lan-apache.py')
apache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apache)


class ApacheTests(unittest.TestCase):
    def test_loopback_backend_lan_auth_and_separate_bearer_path(self):
        text = apache.configuration('192.168.0.18', '192.168.0.0/24')
        self.assertIn('<VirtualHost 192.168.0.18:8080>', text)
        self.assertIn('ProxyPreserveHost Off', text)
        self.assertIn('http://127.0.0.1:8080/', text)
        self.assertIn('Require ip 192.168.0.0/24', text)
        self.assertIn('Require valid-user', text)
        self.assertIn('<LocationMatch "^/(?!api/v1/)">', text)
        self.assertNotIn('Require all granted', text)

    def test_rejects_public_or_unrelated_addresses(self):
        for ip, network in [('8.8.8.8','8.8.8.0/24'),('127.0.0.1','127.0.0.0/8'),('192.168.0.18','192.168.1.0/24')]:
            with self.assertRaises(ValueError):
                apache.configuration(ip, network)
