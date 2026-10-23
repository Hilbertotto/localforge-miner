import ctypes,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('oc',Path(__file__).resolve().parents[1]/'scripts/localforge-oc.py');oc=importlib.util.module_from_spec(spec);spec.loader.exec_module(oc)
class Fn:
 def __init__(self,f=lambda *a:0):self.f=f
 def __call__(self,*a):return self.f(*a)
class Lib:
 def __init__(self):
  self.value=0;self.writes=[];self.nvmlInit_v2=Fn();self.nvmlShutdown=Fn();self.nvmlDeviceGetHandleByUUID=Fn();self.nvmlDeviceGetGpcClkMinMaxVfOffset=Fn(self.limits);self.nvmlDeviceGetGpcClkVfOffset=Fn(self.read);self.nvmlDeviceSetGpcClkVfOffset=Fn(self.write)
 def limits(self,h,lo,hi):ctypes.cast(lo,ctypes.POINTER(ctypes.c_int))[0]=-100;ctypes.cast(hi,ctypes.POINTER(ctypes.c_int))[0]=100;return 0
 def read(self,h,p):ctypes.cast(p,ctypes.POINTER(ctypes.c_int))[0]=self.value;return 0
 def write(self,h,v):self.value=v;self.writes.append(v);return 0
class OffsetTest(unittest.TestCase):
 def test_signed_and_zero_readback(self):
  lib=Lib()
  for value in [-50,0,50]:oc.offset_control('GPU-test','core-offset',value,lib)
  self.assertEqual(lib.writes,[-50,0,50])
 def test_driver_bounds_before_write(self):
  lib=Lib()
  with self.assertRaises(ValueError):oc.offset_control('GPU-test','core-offset',101,lib)
  self.assertEqual(lib.writes,[])
if __name__=='__main__':unittest.main()
