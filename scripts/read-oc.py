"""Read-only import of existing NVIDIA fan policies and targets; no guessed clocks."""
import ctypes as C
import json


def read_fans():
    lib = C.CDLL('libnvidia-ml.so.1')
    uintp = C.POINTER(C.c_uint)
    signatures = {'nvmlInit_v2': [], 'nvmlShutdown': [], 'nvmlDeviceGetCount_v2': [uintp],
                  'nvmlDeviceGetHandleByIndex_v2': [C.c_uint, C.POINTER(C.c_void_p)],
                  'nvmlDeviceGetUUID': [C.c_void_p, C.c_void_p, C.c_uint],
                  'nvmlDeviceGetNumFans': [C.c_void_p, uintp],
                  'nvmlDeviceGetFanControlPolicy_v2': [C.c_void_p, C.c_uint, uintp],
                  'nvmlDeviceGetTargetFanSpeed': [C.c_void_p, C.c_uint, uintp]}
    for name, args in signatures.items():
        getattr(lib, name).argtypes = args
        getattr(lib, name).restype = C.c_int
    def check(code):
        if code:
            raise ValueError('NVML unavailable')
    check(lib.nvmlInit_v2())
    result = []
    try:
        count = C.c_uint()
        check(lib.nvmlDeviceGetCount_v2(C.byref(count)))
        for index in range(min(count.value, 64)):
            try:
                handle, fans, uuid = C.c_void_p(), C.c_uint(), C.create_string_buffer(96)
                check(lib.nvmlDeviceGetHandleByIndex_v2(index, C.byref(handle)))
                check(lib.nvmlDeviceGetUUID(handle, uuid, 96))
                check(lib.nvmlDeviceGetNumFans(handle, C.byref(fans)))
                if not 1 <= fans.value <= 16:
                    continue
                policies, targets = [], []
                for fan in range(fans.value):
                    policy, target = C.c_uint(), C.c_uint()
                    check(lib.nvmlDeviceGetFanControlPolicy_v2(handle, fan, C.byref(policy)))
                    policies.append(policy.value)
                    if policy.value == 1:
                        check(lib.nvmlDeviceGetTargetFanSpeed(handle, fan, C.byref(target)))
                        targets.append(target.value)
                item = {'uuid': uuid.value.decode('ascii')}
                if all(p == 0 for p in policies):
                    result.append({**item, 'action': 'fan-auto'})
                elif all(p == 1 for p in policies) and len(set(targets)) == 1 and 30 <= targets[0] <= 100:
                    result.append({**item, 'action': 'fan', 'value': targets[0]})
            except (ValueError, UnicodeError):
                continue
        return result
    finally:
        lib.nvmlShutdown()


if __name__ == '__main__':
    try:
        print(json.dumps(read_fans()))
    except (OSError, AttributeError, ValueError):
        print('[]')
