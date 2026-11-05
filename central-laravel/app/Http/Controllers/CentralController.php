<?php

namespace App\Http\Controllers;

use App\Central\Store;
use App\Central\Workers;
use App\Central\Library;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Hash, Mail, RateLimiter, Crypt};
use Illuminate\Support\Str;

final class CentralController
{
    public function __construct(private Store $db, private Workers $workers, private Library $library) {}
    public static function fail(int $status, string $message): never { abort($status, $message); }
    private function userView(array $u): array { return array_intersect_key($u, array_flip(['id','name','email'])); }
    private function limit(Request $r, string $bucket): string
    {
        $key = 'central:'.$bucket.':'.$r->ip();
        if (RateLimiter::tooManyAttempts($key, 5)) self::fail(429, 'Túl sok próbálkozás. Várj egy percet.');
        return $key;
    }
    public function api(Request $r, string $route)
    {
        $post = $r->isMethod('POST');
        if ($post && $r->headers->has('Origin') && !in_array($r->header('Origin'), ['http://'.$r->getHttpHost(),'https://'.$r->getHttpHost()],true)) self::fail(403,'Idegen eredetű kérés.');
        if (strlen($r->getContent()) > (in_array($route,['worker/poll','admin/miner-software'],true)?4194304:32768)) self::fail(413,'Túl nagy kérés.');
        $data = $r->json()->all();
        if (!$post && $route==='auth-config') return ['emailConfigured'=>(bool)(config('localforge.local_mail')||config('localforge.registration')), 'localMail'=>(bool)config('localforge.local_mail')];
        if ($post && $route==='register') return $this->register($r);
        if ($post && $route==='verify') return $this->verify($r);
        if ($post && $route==='login') return $this->login($r);
        if ($route==='worker/poll' && $post) return $this->workers->poll($r,$data);
        if ($route==='worker/miner-software' && !$post) {
            $this->workers->authenticate($r);
            $catalog=$this->catalog();
            $catalog['miners']=array_values(array_filter($catalog['miners'],fn($m)=>$m['enabled']??true));
            return $catalog;
        }

        $user = $this->authorize($r);
        $id=$user['id'];
        if ($route==='session' && !$post) return ['csrf'=>$r->session()->token(),'user'=>$this->userView($user)];
        if ($route==='logout' && $post) { $r->session()->invalidate(); $r->session()->regenerateToken(); return ['ok'=>true]; }
        if (str_starts_with($route,'admin/')) {
            if ($id!=='admin') self::fail(403,'Csak adminisztrátor számára elérhető.');
            return $this->admin($r,$route);
        }
        if ($id==='admin') self::fail(403,'A farmokat felhasználói fiókkal kezelheted.');

        if ($route==='farms') {
            if (!$post) return ['farms'=>$this->db->all('farm',$id)];
            $input=$r->validate(['name'=>'required|string|max:80']);
            $name=trim($input['name']);
            if (!$name || preg_match('/[\x00-\x1f]/',$name)) self::fail(400,'Érvénytelen farmnév.');
            $farm=['id'=>(string)Str::uuid(),'ownerId'=>$id,'name'=>$name];
            $this->db->mutate(function()use($farm,$id,$name){
                foreach($this->db->all('farm',$id) as $f) if(mb_strtolower($f['name'])===mb_strtolower($name)) self::fail(400,'Létező farmnév.');
                $this->db->put('farm',$farm['id'],$farm,$id);
            });
            return response()->json(['farm'=>$farm],201);
        }

        if (preg_match('~^farms/([a-f0-9-]+)/library(?:/(wallets|profiles|delete|apply))?$~',$route,$m)) {
            $farm=$this->db->get('farm',$m[1]);
            if (!$farm || $farm['ownerId']!==$id) self::fail(404,'Ismeretlen farm.');
            return $this->library->handle($r,$farm,$m[2]??'');
        }
        if (preg_match('~^farms/([a-f0-9-]+)/library-archive$~',$route,$m) && !$post) {
            $farm=$this->db->get('farm',$m[1]);
            if (!$farm || $farm['ownerId']!==$id) self::fail(404,'Ismeretlen farm.');
            return $this->workers->archiveView($r,'farm-archive',$farm['id']);
        }
        if ($route==='rigs') {
            if ($post) return $this->workers->create($r,$user);
            $rigs=[];
            foreach ($this->db->all('farm',$id) as $f) foreach ($this->db->all('rig',$f['id']) as $rig) $rigs[]=$this->workers->view($rig);
            return ['rigs'=>$rigs];
        }
        if (preg_match('~^rigs/([a-f0-9-]+)/(.+)$~',$route,$m)) return $this->workers->action($r,$this->workers->owned($m[1],$id),$m[2],$data);
        self::fail(404,'Ismeretlen végpont.');
    }

    public function authorize(Request $r): array
    {
        $id=$r->session()->get('central.user');
        if (!$id || (int)$r->session()->get('central.expires',0)<time()) self::fail(401,'Jelentkezz be.');
        $u=$id==='admin'?['id'=>'admin','name'=>'Admin','email'=>null]:$this->db->get('user',$id);
        if (!$u || ($id!=='admin'&&(!($u['verified']??false)||($u['suspended']??false)||isset($u['deletedAt'])||($u['sessionVersion']??0)!==$r->session()->get('central.version')))) self::fail(401,'A fiók nem aktív. Jelentkezz be újra.');
        if ($r->isMethod('POST') && !hash_equals($r->session()->token(),(string)$r->header('X-CSRF-Token'))) self::fail(403,'Hibás munkamenet.');
        return $u;
    }

    private function login(Request $r)
    {
        $key=$this->limit($r,'login');
        $input=$r->validate(['password'=>'required|string|max:256','email'=>'nullable|string|max:254']);
        $email=mb_strtolower(trim($input['email']??''));
        $u=$email?$this->findUser($email):null;
        $admin=$this->db->get('system','admin');
        if ($email==='' && $admin) $u=['id'=>'admin','name'=>'Admin','email'=>null,'verified'=>true,'hash'=>$admin['hash'],'salt'=>$admin['salt']??null];
        if (!$u || !($u['verified']??false) || ($u['suspended']??false) || !isset($u['hash']) || !\App\Central\LegacyPassword::matches($input['password'],$u)) {
            RateLimiter::hit($key,60); self::fail(401,'Hibás belépési adatok vagy inaktív fiók.');
        }
        if(isset($u['salt'])&&strlen($input['password'])<=72&&!str_contains($input['password'],"\0")){
            $this->db->mutate(function()use($u,$input){
                $admin=$u['id']==='admin';$kind=$admin?'system':'user';$current=$this->db->get($kind,$u['id']);
                if(!$current||!isset($current['salt'])||!hash_equals($u['hash'],$current['hash']))return;
                $current['hash']=Hash::make($input['password']);unset($current['salt']);
                $this->db->put($kind,$u['id'],$current,$admin?'':hash('sha256',$current['email']));
            });
        }
        RateLimiter::clear($key);
        $r->session()->regenerate(true);
        $r->session()->put(['central.user'=>$u['id'],'central.version'=>$u['sessionVersion']??0,'central.expires'=>time()+28800]);
        return ['csrf'=>$r->session()->token(),'user'=>$this->userView($u)];
    }

    private function findUser(string $email): ?array
    {
        foreach($this->db->all('user',hash('sha256',$email)) as $u) if (!isset($u['deletedAt'])) return $u;
        return null;
    }

    private function register(Request $r): array
    {
        $key=$this->limit($r,'register'); RateLimiter::hit($key,60);
        $local=config('localforge.local_mail')&&app()->isLocal()&&in_array($r->ip(),['127.0.0.1','::1'],true);
        if (!$local&&!config('localforge.registration')) self::fail(503,'A regisztráció jelenleg zárva van.');
        $in=$r->validate(['name'=>'required|string|max:80','email'=>'required|email:rfc|max:254','password'=>'required|string|min:12|max:72']);
        $email=mb_strtolower(trim($in['email']));$token=bin2hex(random_bytes(32));$name=trim($in['name']);
        if ($name==='' || preg_match('/[\x00-\x1f]/',$name)) self::fail(400,'Érvénytelen név.');
        $url=rtrim(config('app.url'),'/').'/?verify='.$token;
        $user=$this->db->mutate(function()use($in,$name,$email,$token){
            $user=$this->findUser($email);
            if ($user&&(($user['verified']??false)||($user['suspended']??false))) return null;
            $user??=['id'=>(string)Str::uuid(),'name'=>$name,'email'=>$email,'hash'=>Hash::make($in['password']),'verified'=>false,'createdAt'=>now()->toISOString()];
            $user['verificationHash']=hash('sha256',$token);$user['verificationExpires']=time()+86400;
            $this->db->put('user',$user['id'],$user,hash('sha256',$email));
            return $user;
        });
        $response=['ok'=>true,'message'=>'Ha a cím regisztrálható, elküldtük a megerősítő levelet.'];
        if($user&&$local) $response['localMail']=['email'=>$email,'name'=>$user['name'],'subject'=>'LocalForge – e-mail-cím megerősítése','url'=>$url];
        if($user&&!$local) Mail::raw("E-mail-cím megerősítése: ".$url,fn($m)=>$m->to($email)->subject('LocalForge – e-mail-cím megerősítése'));
        return $response;
    }

    private function verify(Request $r): array
    {
        $key=$this->limit($r,'verify');RateLimiter::hit($key,60);
        $data=$r->validate(['token'=>'required|string|regex:/^[a-f0-9]{64}$/']);
        return $this->db->mutate(function()use($data){
            $hash=hash('sha256',$data['token']);
            foreach ($this->db->all('user') as $u) if (isset($u['verificationHash'])&&hash_equals($u['verificationHash'],$hash)&&$u['verificationExpires']>time()&&!$u['verified']&&!($u['suspended']??false)&&!isset($u['deletedAt'])) {
                $u['verified']=true;unset($u['verificationHash'],$u['verificationExpires']);
                $this->db->put('user',$u['id'],$u,hash('sha256',$u['email']));
                return ['ok'=>true,'message'=>'E-mail-cím megerősítve. Most már beléphetsz.'];
            }
            self::fail(400,'A megerősítő link lejárt vagy már felhasználtad.');
        });
    }

    private function catalog(): array
    {
        return $this->db->get('system','catalog')??json_decode(file_get_contents(resource_path('localforge/miner-software.json')),true,512,JSON_THROW_ON_ERROR);
    }

    private function admin(Request $r,string $route): array
    {
        if ($route==='admin/miner-software') {
            if (!$r->isMethod('POST')) return $this->catalog();
            return $this->db->mutate(function()use($r){
                $in=$r->validate(['revision'=>'required|string|max:64','miner'=>'required|array','miner.id'=>'required|string|regex:/^[-a-zA-Z0-9_]+$/|max:80','miner.name'=>'required|string|max:160','miner.algorithms'=>'required|array|max:1500','miner.algorithms.*'=>'string|max:100','miner.releases'=>'present|array|max:3000','miner.releases.*.version'=>'required|string|distinct|max:64','miner.releases.*.assets'=>'present|array|max:100','miner.releases.*.assets.*.name'=>'required|string|max:255','miner.releases.*.assets.*.url'=>'required|url:https|max:2048','miner.enabled'=>'sometimes|boolean']);
                $old=$this->catalog();
                if ($in['revision']!==$old['revision']) self::fail(409,'A katalógus már módosult.');
                $miner=$in['miner'];$new=$old;$found=false;
                foreach($new['miners'] as &$item) if($item['id']===$miner['id']){$item=array_replace($item,$miner);$found=true;break;}unset($item);
                if(!$found)$new['miners'][]=$miner+['enabled'=>true];
                $new['updatedAt']=now()->toISOString();unset($new['revision']);$new['revision']=hash('sha256',json_encode($new,JSON_THROW_ON_ERROR));
                $this->db->put('system','catalog',$new);return $new;
            });
        }
        if ($route!=='admin/users') self::fail(404,'Ismeretlen végpont.');
        if (!$r->isMethod('POST')) return ['users'=>array_values(array_map(function($u){
            $farms=$this->db->all('farm',$u['id']);
            return $this->userView($u)+['verified'=>$u['verified'],'suspended'=>$u['suspended']??false,'createdAt'=>$u['createdAt']??null,'farmCount'=>count($farms),'workerCount'=>array_sum(array_map(fn($f)=>count($this->db->all('rig',$f['id'])),$farms))];
        },array_filter($this->db->all('user'),fn($u)=>!isset($u['deletedAt']))))];
        $data=$r->validate(['id'=>'required|uuid','action'=>'required|in:verify,unverify,suspend,restore,delete']);
        $this->db->mutate(function()use($data){
            $u=$this->db->get('user',$data['id']);
            if(!$u||isset($u['deletedAt'])) self::fail(404,'Ismeretlen felhasználó.');
            $u['sessionVersion']=($u['sessionVersion']??0)+1;
            switch($data['action']){
                case 'verify':case 'unverify':$u['verified']=$data['action']==='verify';unset($u['verificationHash'],$u['verificationExpires']);break;
                case 'suspend':case 'restore':$u['suspended']=$data['action']==='suspend';break;
                case 'delete':$u['deletedAt']=now()->toISOString();$u['suspended']=true;$u['verified']=false;unset($u['hash'],$u['verificationHash'],$u['verificationExpires']);break;
            }
            $this->db->put('user',$u['id'],$u,hash('sha256',$u['email']));
        });
        return ['ok'=>true];
    }

    public function workerUi(Request $r,string $id,?string $asset=null)
    {
        return $this->workers->ui($r,$this->workers->owned($id,$this->authorize($r)['id']),$asset??'');
    }
}
