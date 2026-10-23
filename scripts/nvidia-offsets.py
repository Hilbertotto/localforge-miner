import ctypes as C,json,subprocess
lib=C.CDLL('libnvidia-ml.so.1');lib.nvmlInit_v2();n=C.c_uint();lib.nvmlDeviceGetCount_v2(C.byref(n));out=[]
for i in range(n.value):
 h=C.c_void_p();lib.nvmlDeviceGetHandleByIndex_v2(i,C.byref(h));row={'gpu':i}
 for tag,prefix in [('core','Gpc'),('memory','Mem')]:
  lo,hi,v=C.c_int(),C.c_int(),C.c_int()
  row[tag]={'limitsCode':getattr(lib,'nvmlDeviceGet'+prefix+'ClkMinMaxVfOffset')(h,C.byref(lo),C.byref(hi)),'readCode':getattr(lib,'nvmlDeviceGet'+prefix+'ClkVfOffset')(h,C.byref(v)),'min':lo.value,'max':hi.value,'value':v.value}
 r=subprocess.run(['/usr/bin/nvidia-smi','-i',str(i),'--query-supported-clocks=memory,graphics','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=3)
 row['clocks']=[]
 if r.returncode==0:
  for line in r.stdout.splitlines():
   fields=[x.strip() for x in line.split(',')]
   if len(fields)==2 and all(x.isdigit() for x in fields):row['clocks'].append({'memory':int(fields[0]),'core':int(fields[1])})
 out.append(row)
print(json.dumps(out));lib.nvmlShutdown()
