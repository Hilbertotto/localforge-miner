import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('power', Path(__file__).parents[1] / 'scripts' / 'localforge-power.py')
power = importlib.util.module_from_spec(spec)
spec.loader.exec_module(power)

class PowerTests(unittest.TestCase):
    def test_fixed_commands(self):
        self.assertEqual(power.command('poweroff'), ['/usr/bin/systemctl', 'poweroff', '--no-block'])
        self.assertEqual(power.command('reboot'), ['/usr/bin/systemctl', 'reboot', '--no-block'])
        self.assertIn('--on-active=30s', power.command('reboot-delay'))
        self.assertEqual(power.command('reboot-delay')[-2:], ['/usr/bin/systemctl', 'reboot'])
        with self.assertRaises(ValueError):
            power.command('reboot; shell')
