import ctypes
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('oc', Path(__file__).resolve().parents[1] / 'scripts/localforge-oc.py')
oc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oc)


class Function:
    def __init__(self, callback=lambda *args: 0): self.callback = callback
    def __call__(self, *args): return self.callback(*args)


class Library:
    def __init__(self, fail_second=False):
        self.calls = []
        self.shutdown = False
        self.nvmlInit_v2 = Function()
        self.nvmlShutdown = Function(self.close)
        self.nvmlDeviceGetHandleByUUID = Function()
        self.nvmlDeviceGetNumFans = Function(self.count)
        self.nvmlDeviceSetFanSpeed_v2 = Function(self.set_speed)
        self.nvmlDeviceSetDefaultFanSpeed_v2 = Function(lambda handle, index: self.record('default', index))
        self.nvmlDeviceSetFanControlPolicy = Function(lambda handle, index, policy: self.record('auto', index))
        self.fail_second = fail_second
    def count(self, handle, out): ctypes.cast(out, ctypes.POINTER(ctypes.c_uint))[0] = 2; return 0
    def close(self): self.shutdown = True; return 0
    def record(self, kind, index): self.calls.append((kind, index)); return 0
    def set_speed(self, handle, index, speed): self.calls.append(('manual', index, speed)); return 3 if self.fail_second and index == 1 else 0


class FanTest(unittest.TestCase):
    def test_all_fans_manual_and_automatic(self):
        lib = Library()
        oc.fan_control('GPU-test', 75, library=lib)
        self.assertEqual(lib.calls, [('manual', 0, 75), ('manual', 1, 75)])
        self.assertTrue(lib.shutdown)
        lib = Library()
        oc.fan_control('GPU-test', library=lib)
        self.assertEqual(lib.calls, [('auto', 0), ('auto', 1)])
    def test_partial_failure_restores_all_fans(self):
        lib = Library(fail_second=True)
        with self.assertRaisesRegex(ValueError, 'NVML'):
            oc.fan_control('GPU-test', 75, library=lib)
        self.assertEqual(lib.calls[-2:], [('auto', 0), ('auto', 1)])
        self.assertTrue(lib.shutdown)
    def test_limits_and_uuid_rejected_before_system_call(self):
        for speed in (0, 29, 101):
            with self.assertRaises(ValueError): oc.fan_control('GPU-test', speed, library=Library())
        with patch.object(oc, 'fan_control') as call:
            with self.assertRaises(ValueError): oc.main(['fan', 'GPU-;reboot', '75'])
            call.assert_not_called()


if __name__ == '__main__': unittest.main()
