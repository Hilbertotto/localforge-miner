<?php

namespace App\Central;

use App\Http\Controllers\CentralController as C;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

final class Library
{
    public function __construct(private Store $db,private Workers $workers){}
    private function engines():array
    {
        return json_decode(file_get_contents(resource_path('localforge/engines.json')),true,512,JSON_THROW_ON_ERROR);
    }
    private function snapshot(string $farm,bool $secret=false):array
    {
        return [
            'wallets'=>$this->db->all('wallet',$farm),
            'profiles'=>array_map(function($p)use($secret){
                if($secret)$p['password']=Crypt::decryptString($p['passwordCipher']);
                else $p['passwordConfigured']=true;
                unset($p['passwordCipher']);return $p;
            },$this->db->all('profile',$farm)),
            'assignments'=>$this->db->all('assignment',$farm),
        ];
    }
    private function archive(string $farm):void
    {
        $this->workers->archive('farm-archive',$farm,['schema'=>1]+$this->snapshot($farm,true));
    }
    private function member(string $kind,string $id,string $farm):?array
    {
        $row=$this->db->get($kind,$id);
        return ($row['farmId']??null)===$farm?$row:null;
    }
    private function string(array $in,string $key,int $max,bool $required=true):string
    {
        $v=$in[$key]??'';
        if(!is_string($v)||mb_strlen($v)>$max||preg_match('/[\x00-\x1f]/',$v)||($required&&trim($v)===''))C::fail(400,'Érvénytelen mező: '.$key);
        return trim($v);
    }
    public function handle(Request $r,array $farm,string $action):mixed
    {
        $id=$farm['id'];
        if($action===''&&$r->isMethod('GET'))return $this->snapshot($id)+['engines'=>$this->engines()];
        if(!$r->isMethod('POST')||$action==='')C::fail(405,'Nem támogatott művelet.');
        $in=$r->json()->all();
        if($action==='apply')return $this->apply($id,$in);
        return $this->db->mutate(function()use($id,$action,$in){
            if($action==='delete'){
                $kind=match($in['kind']??''){'wallets'=>'wallet','profiles'=>'profile',default=>null};
                $key=$this->string($in,'id',64);
                if(!$kind||!$this->member($kind,$key,$id))C::fail(404,'Ismeretlen bejegyzés.');
                if($kind==='wallet')foreach($this->db->all('profile',$id) as $p)if($p['walletId']===$key)C::fail(400,'Ezt a walletet Flight Sheet használja.');
                $this->db->remove($kind,$key);
            }else{
                $kind=$action==='wallets'?'wallet':'profile';
                $key=$this->string($in,'id',64,false);$previous=$key?$this->member($kind,$key,$id):null;
                if($key&&!$previous)C::fail(404,'Ismeretlen bejegyzés.');
                $key=$key?:((string)Str::uuid());
                $record=['id'=>$key,'farmId'=>$id,'name'=>$this->string($in,'name',80),'revision'=>($previous['revision']??0)+1];
                if($kind==='wallet'){
                    $address=$this->string($in,'address',512);$coin=$this->string($in,'coin',32);$external=$this->string($in,'externalId',32,false);
                    if(str_starts_with($address,'-')||!preg_match('~^[A-Za-z0-9][A-Za-z0-9_.+/-]{0,31}$~D',$coin)||($external&&!ctype_digit($external)))C::fail(400,'Hibás walletadat.');
                    $record+=['coin'=>strtoupper($coin),'address'=>$address,'externalId'=>$external];
                }else{
                    $walletId=$this->string($in,'walletId',64);$wallet=$this->member('wallet',$walletId,$id);
                    if(!$wallet)C::fail(400,'Válassz walletet ebből a farmból.');
                    $engine=$this->string($in,'engine',32);$algorithm=$this->string($in,'algorithm',100);
                    if(!in_array($algorithm,$this->engines()[$engine]['algorithms']??[],true))C::fail(400,'Nem támogatott algoritmus.');
                    $pool=$this->string($in,'pool',256);
                    if(!preg_match('~^(?:[a-z0-9.-]+|\[[a-f0-9:]+\]):([0-9]{1,5})$~iD',$pool,$m)||$m[1]<1||$m[1]>65535)C::fail(400,'Pool formátum: host:port.');
                    $worker=$this->string($in+['worker'=>'%WORKER_NAME%'],'worker',64);
                    $template=$this->string($in+['walletTemplate'=>'%WAL%'],'walletTemplate',512);
                    if(($worker!=='%WORKER_NAME%'&&!preg_match('/^[a-z0-9_.][a-z0-9_.-]{0,63}$/iD',$worker))||preg_match('/%[A-Z_]+%/',str_replace(['%WAL%','%WORKER_NAME%'],'',$template)))C::fail(400,'Hibás worker vagy wallet sablon.');
                    $password=array_key_exists('password',$in)?$this->string($in,'password',128,false):($previous?Crypt::decryptString($previous['passwordCipher']):'x');
                    if(str_starts_with($password,'-'))C::fail(400,'Hibás pooljelszó.');
                    $threads=$engine==='xmrig'?($in['threads']??0):1;$devices=$engine==='xmrig'?'':$this->string($in,'devices',96);
                    if(!is_int($threads)||$threads<1||$threads>1024||($engine!=='xmrig'&&!preg_match('/^\d{1,2}(,\d{1,2})*$/D',$devices))||!is_bool($in['tls']??null))C::fail(400,'Hibás CPU-, GPU- vagy TLS-beállítás.');
                    $record+=['engine'=>$engine,'algorithm'=>$algorithm,'pool'=>$pool,'worker'=>$worker,'walletId'=>$walletId,'walletTemplate'=>$template,'wallet'=>$wallet['address'],'threads'=>$threads,'devices'=>$devices,'tls'=>$in['tls'],'passwordCipher'=>Crypt::encryptString($password),'updatedAt'=>now()->toISOString()];
                }
                $all=$this->db->all($kind,$id);
                if(!$previous&&count($all)>=200)C::fail(400,'Legfeljebb 200 bejegyzés lehet egy farmban.');
                foreach($all as $old)if($old['id']!==$key&&(mb_strtolower($old['name'])===mb_strtolower($record['name'])||(!empty($record['externalId'])&&$old['externalId']===$record['externalId'])))C::fail(400,'Létező név vagy külső azonosító.');
                $this->db->put($kind,$key,$record,$id);
            }
            $this->archive($id);
            return ['ok'=>true];
        });
    }
    private function apply(string $id,array $in):array
    {
        $rig=$this->member('rig',$this->string($in,'rigId',64),$id);
        $profile=$this->member('profile',$this->string($in,'profileId',64),$id);
        if(!$rig||!$profile)C::fail(404,'Ismeretlen munkás vagy Flight Sheet.');
        if(!is_bool($in['start']??null))C::fail(400,'Az indítási mód kötelező.');
        $wallet=$this->member('wallet',$profile['walletId'],$id);
        if(!$wallet)C::fail(400,'A wallet nem található.');
        $worker=$profile['worker']==='%WORKER_NAME%'?substr(ltrim(preg_replace('/[^\w.-]/','_',$rig['name']),'-'),0,64):$profile['worker'];
        $address=str_replace(['%WAL%','%WORKER_NAME%'],[$wallet['address'],$worker],$profile['walletTemplate']);
        if(!$worker||!$address||str_starts_with($address,'-')||strlen($address)>512||preg_match('/%[A-Z_]+%/',$address))C::fail(400,'Hibás wallet vagy munkásnév.');
        $body=array_intersect_key($profile,array_flip(['id','name','engine','algorithm','pool','threads','devices','tls']));
        $body+=['wallet'=>$address,'walletId'=>'','walletTemplate'=>'%WAL%','worker'=>$worker,'password'=>Crypt::decryptString($profile['passwordCipher']),'saveMode'=>'update'];
        $saved=$this->workers->agent($rig,'profiles','POST',$body);
        if($in['start']&&!($saved['running']??false))$this->workers->agent($rig,'start','POST',['id'=>$profile['id']]);
        $assignment=['farmId'=>$id,'rigId'=>$rig['id'],'profileId'=>$profile['id'],'profileRevision'=>$profile['revision'],'walletRevision'=>$wallet['revision'],'appliedAt'=>now()->toISOString()];
        $this->db->mutate(function()use($id,$assignment,$rig,$profile){
            $this->db->put('assignment',$rig['id'].':'.$profile['id'],$assignment,$id);$this->archive($id);
        });
        return ['ok'=>true,'message'=>'Flight Sheet átküldve a munkásnak.','assignment'=>$assignment];
    }
}
