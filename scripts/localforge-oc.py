#!/usr/bin/python3 -I
"""Root-owned NVIDIA helper. No shell, paths or free-form command arguments."""
import re
import subprocess
import sys
import ctypes


def fan_control(gpu, speed=None, library=None):
    """Set all physical fans on one UUID; restore automatic mode on partial failure."""
    if speed is not None and (not isinstance(speed, int) or not 30 <= speed <= 100):
        raise ValueError('A kezi ventilator 30-100% lehet')
    lib = library if library is not None else ctypes.CDLL('libnvidia-ml.so.1')
    signatures = {'nvmlInit_v2': [], 'nvmlShutdown': [],
                  'nvmlDeviceGetHandleByUUID': [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)],
                  'nvmlDeviceGetNumFans': [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint)],
                  'nvmlDeviceSetFanSpeed_v2': [ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint],
                  'nvmlDeviceSetDefaultFanSpeed_v2': [ctypes.c_void_p, ctypes.c_uint]}
    for name, args in signatures.items():
        try:
            function = getattr(lib, name)
        except AttributeError:
            raise ValueError('A driver NVML verzioja nem tamogatja ezt a ventilatormuveletet') from None
        function.argtypes = args
        function.restype = ctypes.c_int
    def check(code):
        if code != 0:
            raise ValueError(f'NVML ventilatorhiba (kod: {code}); a kartya/driver nem tamogatja a muveletet vagy nincs hozza jogosultsag')
    check(lib.nvmlInit_v2())
    try:
        handle, count = ctypes.c_void_p(), ctypes.c_uint()
        check(lib.nvmlDeviceGetHandleByUUID(gpu.encode('ascii'), ctypes.byref(handle)))
        check(lib.nvmlDeviceGetNumFans(handle, ctypes.byref(count)))
        if not 1 <= count.value <= 16:
            raise ValueError('Nem talalhato vezerelheto ventilator ezen a kartyan')
        def auto(index):
            # Explicit automatic policy where available; fallback for older NVML.
            policy = getattr(lib, 'nvmlDeviceSetFanControlPolicy', None)
            if policy is not None:
                policy.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint]
                policy.restype = ctypes.c_int
                result = policy(handle, index, 0)
                if result == 0:
                    return
                if result not in (3, 13):
                    check(result)
            check(lib.nvmlDeviceSetDefaultFanSpeed_v2(handle, index))
        try:
            for index in range(count.value):
                if speed is None:
                    auto(index)
                else:
                    check(lib.nvmlDeviceSetFanSpeed_v2(handle, index, speed))
        except ValueError as error:
            recovery_errors = []
            for index in range(count.value):
                try:
                    auto(index)
                except ValueError:
                    recovery_errors.append(str(index))
            if recovery_errors:
                raise ValueError(f'{error}; automatikus visszaallitas sem sikerult a kovetkezo fanokon: {", ".join(recovery_errors)}') from None
            raise
        return f'{gpu}: {count.value} ventilator ' + ('automatikus drivervezerlesre allitva.' if speed is None else f'kezi {speed}% ertekre allitva.')
    finally:
        lib.nvmlShutdown()


def offset_control(gpu, domain, value, library=None):
    if not isinstance(value, int) or not (-1000 <= value <= 1000 if domain == 'core-offset' else -2000 <= value <= 6000):
        raise ValueError('Offset a megengedett tartomanyon kivul')
    lib = library if library is not None else ctypes.CDLL('libnvidia-ml.so.1')
    prefix = 'Gpc' if domain == 'core-offset' else 'Mem'
    signatures = {'nvmlInit_v2': [], 'nvmlShutdown': [],
        'nvmlDeviceGetHandleByUUID': [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)],
        'nvmlDeviceGet'+prefix+'ClkMinMaxVfOffset': [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)],
        'nvmlDeviceGet'+prefix+'ClkVfOffset': [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)],
        'nvmlDeviceSet'+prefix+'ClkVfOffset': [ctypes.c_void_p, ctypes.c_int]}
    for name, args in signatures.items():
        try: fn = getattr(lib, name)
        except AttributeError: raise ValueError('A driver nem tamogatja az NVML offset vezerlest') from None
        fn.argtypes, fn.restype = args, ctypes.c_int
    def check(code):
        if code: raise ValueError(f'NVML offset hiba: {code}')
    check(lib.nvmlInit_v2())
    try:
        h, lo, hi, actual = ctypes.c_void_p(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
        check(lib.nvmlDeviceGetHandleByUUID(gpu.encode('ascii'), ctypes.byref(h)))
        check(getattr(lib, 'nvmlDeviceGet'+prefix+'ClkMinMaxVfOffset')(h, ctypes.byref(lo), ctypes.byref(hi)))
        if not lo.value <= value <= hi.value: raise ValueError(f'Driver offset tartomany: {lo.value}..{hi.value} MHz')
        check(getattr(lib, 'nvmlDeviceSet'+prefix+'ClkVfOffset')(h, value))
        check(getattr(lib, 'nvmlDeviceGet'+prefix+'ClkVfOffset')(h, ctypes.byref(actual)))
        if actual.value != value: raise ValueError('Az offset visszaellenorzese nem egyezik')
        return f'{gpu}: {domain} = {actual.value} MHz, visszaellenorizve.'
    finally: lib.nvmlShutdown()


def run(args):
    result = subprocess.run(['/usr/bin/nvidia-smi', *args], text=True,
                            capture_output=True, timeout=8,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or 'NVIDIA hiba')
    return result.stdout.strip()


def main(args):
    if len(args) not in (2, 3):
        raise ValueError('Hasznalat: power|core|memory GPU-UUID ertek; reset GPU-UUID')
    action, gpu = args[:2]
    if not re.fullmatch(r'GPU-[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', gpu):
        raise ValueError('Hibas GPU UUID')
    if action not in ('power', 'core', 'memory', 'reset', 'fan', 'fan-auto', 'core-offset', 'memory-offset'):
        raise ValueError('Ismeretlen muvelet')
    if action in ('core-offset', 'memory-offset'):
        if len(args) != 3 or not re.fullmatch(r'-?\d{1,4}', args[2]): raise ValueError('Egesz offset szukseges')
        print(offset_control(gpu, action, int(args[2])))
        return
    if action in ('fan', 'fan-auto'):
        if action == 'fan-auto':
            if len(args) != 2:
                raise ValueError('Az automatikus fan muvelet nem fogad erteket')
            print(fan_control(gpu))
        else:
            if len(args) != 3 or not re.fullmatch(r'\d{1,3}', args[2]):
                raise ValueError('A ventilatorhoz egesz szazalek kell')
            print(fan_control(gpu, int(args[2])))
        return
    limits = run(['-i', gpu, '--query-gpu=power.min_limit,power.max_limit,power.default_limit',
                  '--format=csv,noheader,nounits']).split(',')
    if action == 'reset':
        if len(args) != 2:
            raise ValueError('A reset nem fogad erteket')
        errors = []
        for option in (['-rgc'], ['-rmc'], ['-pl', str(float(limits[2]))]):
            try:
                print(run(['-i', gpu, *option]))
            except ValueError as exc:
                errors.append(str(exc))
        for domain in ('core-offset', 'memory-offset'):
            try: print(offset_control(gpu, domain, 0))
            except ValueError as exc: errors.append(str(exc))
        if errors:
            raise ValueError('Reszleges visszaallitas: ' + '; '.join(errors))
        return
    if len(args) != 3 or not re.fullmatch(r'[0-9]{1,5}', args[2]):
        raise ValueError('Egesz szamertek szukseges')
    value = int(args[2])
    if action == 'power':
        if not float(limits[0]) <= value <= float(limits[1]):
            raise ValueError('A teljesitmenykorlat a kartya megengedett tartomanyan kivul van')
        option = ['-pl', str(value)]
    else:
        if not 100 <= value <= (4000 if action == 'core' else 30000):
            raise ValueError('Or ajel a megengedett tartomanyon kivul')
        option = ['-lgc' if action == 'core' else '-lmc', f'{value},{value}']
    print(run(['-i', gpu, *option]))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
