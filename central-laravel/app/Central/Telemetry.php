<?php

namespace App\Central;

use App\Http\Controllers\CentralController as C;

final class Telemetry
{
    private const GPU_NUMBERS='index temp memoryTemp fan usage power limit min max defaultPower used total core memoryClock';
    private const GPU_STRINGS='uuid bus name driver vbios memoryType memoryVendor pciDeviceId pciSubsystemId biosHash';
    private static function fields(mixed $value,string $strings='',string $numbers=''):array
    {
        $row=is_array($value)?$value:[];$out=[];
        foreach(array_filter(explode(' ',$strings)) as $key){$v=$row[$key]??null;$out[$key]=is_string($v)?mb_substr($v,0,256):null;}
        foreach(array_filter(explode(' ',$numbers)) as $key){$v=$row[$key]??null;$out[$key]=is_numeric($v)&&is_finite((float)$v)?$v+0:null;}
        return $out;
    }
    private static function rows(mixed $value,int $max,callable $normalize):array
    {
        if(!is_array($value)||!array_is_list($value)||count($value)>$max)C::fail(400,'Érvénytelen telemetrialista.');
        return array_map($normalize,$value);
    }
    public static function clean(array $r):array
    {
        if($r['at']<0||strlen(json_encode($r,JSON_THROW_ON_ERROR))>262144)C::fail(400,'Érvénytelen telemetriaminta.');
        $gpus=self::rows($r['gpus']??[],128,fn($g)=>self::fields($g,self::GPU_STRINGS,self::GPU_NUMBERS)+['offsets'=>self::fields($g['offsets']??null,'','core memory')]);
        $miners=self::rows($r['miners']??[],40,fn($m)=>self::fields($m,'id name sheetId sheetName engine algorithm coin coinName walletId walletName worker pool version state','total average60 average15m accepted submitted rejected difficulty uptime')+[
            'available'=>($m['available']??false)===true,
            'threads'=>self::rows($m['threads']??[],1024,fn($t)=>self::fields($t,'','index hashrate affinity average60 average15m cpu')),
            'devices'=>self::rows($m['devices']??[],128,fn($d)=>self::fields($d,'id bus name','index hashrate accepted rejected temp fan power')),
        ]);
        return array_intersect_key($r,array_flip(['schema','id','nodeId','at']))+self::fields($r,'hostname','uptime')+[
            'cpu'=>self::fields($r['cpu']??null,'model','threads load temperature power'),
            'memory'=>self::fields($r['memory']??null,'','used total'),
            'gpus'=>$gpus,'miners'=>$miners,
            'oc'=>self::rows($r['oc']??[],320,fn($o)=>self::fields($o,'uuid action','value')),
            'safety'=>array_combine(['cpuEnabled','cpuLatched','gpuEnabled','gpuLatched'],array_map(fn($key)=>($r['safety'][$key]??false)===true,['cpuEnabled','cpuLatched','gpuEnabled','gpuLatched'])),
        ];
    }
}
