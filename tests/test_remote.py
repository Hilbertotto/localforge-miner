import contextlib
import importlib.util
import io
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('remote', Path(__file__).resolve().parents[1] / 'scripts/remote-connection.py')
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class Channel:
    def __init__(self):
        self.parts = [b'hello secret-', b'password\nfinished\n']
        self.sent = ''
        self.closed_write = False
    def recv_ready(self): return bool(self.parts)
    def recv_stderr_ready(self): return False
    def recv(self, n): return self.parts.pop(0)
    def recv_stderr(self, n): return b''
    def exit_status_ready(self): return not self.parts
    def recv_exit_status(self): return 0
    def shutdown_write(self): self.closed_write = True


class RemoteTest(unittest.TestCase):
    def test_password_uses_stdin_and_output_is_redacted_across_chunks(self):
        channel = Channel()
        class Stdin:
            def __init__(self): self.channel = channel
            def write(self, text): channel.sent += text
            def flush(self): pass
        class Stdout:
            def __init__(self): self.channel = channel
        class Client:
            def exec_command(self, cmd, **kwargs):
                self.command = cmd
                return Stdin(), Stdout(), None
        client = Client()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            remote.run_remote(client, 'sudo -S -p "" bash install.sh', 'secret-password', secrets=('secret-password',))
        self.assertEqual(channel.sent, 'secret-password\n')
        self.assertTrue(channel.closed_write)
        self.assertNotIn('secret-password', client.command)
        self.assertNotIn('secret-password', output.getvalue())
        self.assertIn('[rejtve]', output.getvalue())


if __name__ == '__main__':
    unittest.main()
