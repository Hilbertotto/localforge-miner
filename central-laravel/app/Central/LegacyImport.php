<?php

namespace App\Central;

use Illuminate\Support\Facades\Crypt;
use RuntimeException;

final class LegacyImport
{
    public function __construct(private Store $db) {}

    public function run(string $folder): array
    {
        $root=realpath($folder);
        if(!$root||!is_dir($root))throw new RuntimeException('Missing source data directory.');
        if(!function_exists('sodium_crypto_pwhash_scryptsalsa208sha256'))throw new RuntimeException('Enable the PHP sodium extension first.');
        $key=file_get_contents($root.'/vault.key');
        if(strlen($key)!==32)throw new RuntimeException('Invalid source vault key.');
        $json=fn($file,$fallback=null)=>is_file($file)?json_decode(file_get_contents($file),true,512,JSON_THROW_ON_ERROR):$fallback;
        $decrypt=function(string $value)use($key):string{
            $b=base64_decode($value,true);
            if($b===false||strlen($b)<28)throw new RuntimeException('Invalid encrypted source record.');
            $out=openssl_decrypt(substr($b,12,-16),'aes-256-gcm',$key,OPENSSL_RAW_DATA,substr($b,0,12),substr($b,-16));
            if($out===false)throw new RuntimeException('Could not authenticate source record.');
            return $out;
        };
        $accounts=$json($root.'/accounts.json');
        if(!is_array($accounts)||!isset($accounts['users'],$accounts['farms']))throw new RuntimeException('Missing source accounts.');
        return $this->db->mutate(function()use($root,$json,$decrypt,$accounts){
            foreach(['user','farm','rig','profile','wallet','assignment','system','settings','farm-archive','backup','telemetry'] as $kind)
                if($this->db->hasAny($kind))throw new RuntimeException('Import requires an empty Central database.');
            $counts=[];
            $put=function(string $kind,string $id,array $data,string $scope='')use(&$counts){
                $this->db->put($kind,$id,$data,$scope);$counts[$kind]=($counts[$kind]??0)+1;
            };
            $admin=$json($root.'/admin.json');
            if($admin)$put('system','admin',$admin);
            foreach($accounts['users'] as $u){
                if(isset($u['verificationExpires']))$u['verificationExpires']=intdiv($u['verificationExpires'],1000);
                $put('user',$u['id'],$u,hash('sha256',$u['email']));
            }
            foreach($accounts['farms'] as $f)$put('farm',$f['id'],$f,$f['ownerId']);
            $rigs=$json($root.'/rigs.json',[]);
            foreach($rigs as $r){
                if(!$this->db->get('farm',$r['farmId']))throw new RuntimeException('Unknown source farm.');
                foreach(['workerCode','token'] as $field)if(isset($r[$field]))$r[$field]=Crypt::encryptString($decrypt($r[$field]));
                $put('rig',$r['id'],$r,$r['farmId']);
            }
            $library=$json($root.'/farm-library.json',[]);
            foreach($library['wallets']??[] as $w)$put('wallet',$w['id'],$w,$w['farmId']);
            foreach($library['profiles']??[] as $p){
                $p['passwordCipher']=Crypt::encryptString($decrypt($p['passwordCipher']));
                $put('profile',$p['id'],$p,$p['farmId']);
            }
            foreach($library['assignments']??[] as $a)$put('assignment',$a['rigId'].':'.$a['profileId'],$a,$a['farmId']);
            if($catalog=$json($root.'/miner-software.json')){
                $catalog['revision']=hash('sha256',json_encode($catalog,JSON_THROW_ON_ERROR));
                $put('system','catalog',$catalog);
            }
            $version=function($kind,$scope,$v)use($put,$decrypt){
                $plain=$decrypt($v['cipher']);
                if(!hash_equals($v['digest'],hash('sha256',$plain)))throw new RuntimeException('Source archive digest mismatch.');
                $v['cipher']=Crypt::encrypt(json_decode($plain,true,512,JSON_THROW_ON_ERROR));
                $v['day']=substr($v['createdAt'],0,10);
                $put($kind,$v['id'],$v,$scope);
            };
            $journal=function(string $folder,callable $accept){
                foreach(glob($folder.'/????-??-??.jsonl')?:[] as $file){
                    $lines=new \SplFileObject($file);
                    foreach($lines as $line)if(trim((string)$line)!=='')$accept(json_decode($line,true,512,JSON_THROW_ON_ERROR));
                }
            };
            $id=function($value){
                if(!is_string($value)||!preg_match('/^[a-zA-Z0-9_-]{1,80}$/D',$value))throw new RuntimeException('Invalid source scope.');
                return $value;
            };
            foreach($accounts['farms'] as $farm){
                $scope=$root.'/users/'.$id($farm['ownerId']).'/farms/'.$id($farm['id']);
                $journal($scope.'/configurations/farm-library',fn($v)=>$version('farm-archive',$farm['id'],$v));
                foreach($rigs as $rig)if($rig['farmId']===$farm['id']){
                    $rigId=$id($rig['id']);
                    $worker=$scope.'/workers/'.$rigId;
                    $journal($worker.'/configurations/worker-settings',fn($v)=>$version('settings',$rigId,$v));
                    $journal($worker.'/telemetry',fn($v)=>$put('telemetry',hash('sha256',$rigId.':'.$v['id']),Telemetry::clean($v)+array_intersect_key($v,array_flip(['receivedAt','userId','farmId','workerId'])),$rigId));
                    foreach(($json($root.'/worker-backup-'.$rigId.'.json',[])['versions']??[]) as $v)$version('backup',$rigId,$v);
                }
            }
            return $counts;
        });
    }
}
