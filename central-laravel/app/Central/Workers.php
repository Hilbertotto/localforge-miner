<?php

namespace App\Central;

use App\Http\Controllers\CentralController as C;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Crypt,Http};
use Illuminate\Support\Str;

final class Workers
{
    private const READ=['node','capabilities','status','profiles','wallets','watchdog','logs','history','app-update','miner-releases','miner-software','gpu-fan','coins'];
    private const WRITE=['flight-sheets','flight-sheets/start','flight-sheets/stop','flight-sheets/delete','profiles','delete','start','stop','wallets','wallets/delete','import-profile','watchdog','watchdog/rearm','oc','system-power','app-update','miner-releases','gpu-fan','gpu-fan/rearm','coins'];

    public function __construct(private Store $db) {}
    public function view(array $rig): array
    {
        unset($rig['workerHash'],$rig['workerCode'],$rig['token']);return $rig;
    }
    public function owned(string $id,string $owner): array
    {
        $rig=$this->db->get('rig',$id);
        if(!$rig||$owner==='admin'||($this->db->get('farm',$rig['farmId'])['ownerId']??null)!==$owner) C::fail(404,'Ismeretlen munkás.');
        return $rig;
    }
    public function create(Request $r,array $user)
    {
        $d=$r->validate(['farmId'=>'required|uuid','name'=>'nullable|string|max:80','address'=>'nullable|string|max:255','token'=>'nullable|string|max:67']);
        $farm=$this->db->get('farm',$d['farmId']);
        if(!$farm||$farm['ownerId']!==$user['id']) C::fail(404,'Ismeretlen farm.');
        $id=(string)Str::uuid();$name=trim($d['name']??'');
        if(preg_match('/[\x00-\x1f]/',$name)) C::fail(400,'Érvénytelen munkásnév.');
        $rig=['id'=>$id,'farmId'=>$farm['id'],'name'=>$name?:'Miner '.$id,'createdAt'=>now()->toISOString()];
        $code=null;
        if (isset($d['address'])||isset($d['token'])) {
            $url=rtrim($d['address']??'','/');
            $allowed=array_map('trim',explode(',',config('localforge.direct_agents')));
            if(!$name||!preg_match('~^https?://[a-z0-9.\[\]:-]+$~iD',$url)||!in_array($url,$allowed,true)||!preg_match('/^lf_[a-f0-9]{64}$/D',$d['token']??'')) C::fail(400,'A közvetlen agent címe nincs engedélyezve vagy a kulcsa hibás.');
            $rig+=['address'=>$url,'token'=>Crypt::encryptString($d['token'])];
            $node=$this->agent($rig,'node','GET');
            $rig['nodeId']=$node['id']??null;
            if(!$rig['nodeId']) C::fail(400,'Hiányzó agent gépazonosító.');
        } else {
            $code='lfw_'.bin2hex(random_bytes(32));
            $rig+=['mode'=>'outbound','workerHash'=>hash('sha256',$code),'workerCode'=>Crypt::encryptString($code),'accountLogin'=>$name===''];
        }
        $this->db->mutate(function()use($rig){
            foreach($this->db->all('rig',$rig['farmId']) as $old) if(mb_strtolower($old['name'])===mb_strtolower($rig['name'])) C::fail(400,'Létező munkásnév.');
            if(isset($rig['nodeId'])) $this->uniqueNode($rig,$rig['nodeId']);
            $this->db->put('rig',$rig['id'],$rig,$rig['farmId']);
        });
        return response()->json(['rig'=>$this->view($rig)]+($code?['code'=>$code,'username'=>$user['name']]:[]),201);
    }
    private function uniqueNode(array $rig,string $node): void
    {
        foreach($this->db->all('rig') as $other) if($other['id']!==$rig['id']&&($other['nodeId']??null)===$node) C::fail(400,'Ez a gép már csatlakoztatva van.');
    }
    public function authenticate(Request $r): array
    {
        $code=$r->bearerToken()??'';
        if(!preg_match('/^lfw_[a-f0-9]{64}$/D',$code)) C::fail(401,'Érvénytelen munkáskulcs.');
        $hash=hash('sha256',$code);
        foreach($this->db->all('rig') as $rig) if(isset($rig['workerHash'])&&hash_equals($rig['workerHash'],$hash)){
            $farm=$this->db->get('farm',$rig['farmId']);
            $owner=$farm?$this->db->get('user',$farm['ownerId']):null;
            if($owner&&$owner['verified']&&!($owner['suspended']??false)&&!isset($owner['deletedAt'])) return [$rig,$owner];
        }
        C::fail(401,'Érvénytelen munkáskulcs vagy inaktív fiók.');
    }
    public function poll(Request $r,array $d): array
    {
        $node=$d['nodeId']??null;$results=$d['results']??[];
        if(!is_string($node)||!preg_match('/^[-a-zA-Z0-9]{1,80}$/D',$node)||!is_array($results)||count($results)>16) C::fail(400,'Hibás munkásazonosító.');
        return $this->db->mutate(function()use($r,$d,$node,$results){
            [$rig,$owner]=$this->authenticate($r);
            $name=($rig['accountLogin']??false)?($d['username']??null):($d['name']??null);
            $valid=is_string($name)&&(($rig['accountLogin']??false)?mb_strtolower(trim($name))===mb_strtolower($owner['name']):$name===$rig['name']);
            if(!$valid) C::fail(400,'Hibás munkásazonosító.');
            $id=$rig['id'];$live=$this->db->get('live',$id)??[];
            $backups=$this->versions('backup',$id);$latest=$backups[0]??null;
            $changed=isset($rig['nodeId'])&&$rig['nodeId']!==$node;
            $recover=($d['handshake']??false)===true&&($d['recover']??false)===true;
            if($changed&&(!$recover||!$latest||($live['seenAt']??0)>time()-45)) C::fail(400,'A kulcs már másik telepítéshez tartozik, vagy a korábbi munkás még elérhető.');
            if($changed||!isset($rig['nodeId'])) $this->uniqueNode($rig,$node);
            $rig['nodeId']=$node;$rig['lastSeenAt']=now()->toISOString();$recovery=null;
            if($recover&&$latest){$rig['recoveryPending']=true;$recovery=['summary'=>$this->summary($latest),'data'=>Crypt::decrypt($latest['cipher'])];}
            if(($d['restoreComplete']??false)===true&&!$recover)$rig['recoveryPending']=false;
            if(isset($d['status'])&&is_array($d['status'])){$live['status']=$d['status'];$live['statusAt']=time();}
            $live['seenAt']=time();
            $this->db->put('live',$id,$live);
            $this->db->put('rig',$id,$rig,$rig['farmId']);
            if(!($rig['recoveryPending']??false)&&isset($d['backup'])&&is_array($d['backup'])) {
                $latest=$this->archive('backup',$id,$d['backup']);
                foreach(array_slice($this->versions('backup',$id),3) as $old) $this->db->remove('backup',$old['id']);
                if(($d['journalVersion']??0)!==1)$this->archive('settings',$id,$d['backup']);
            }
            $ack=[];
            foreach(['settings','telemetry'] as $kind) if(isset($d[$kind])&&is_array($d[$kind])&&($kind!=='settings'||!($rig['recoveryPending']??false))) {
                $batch=$d[$kind];$bid=$batch['id']??null;$records=$batch['records']??null;
                if(!is_string($bid)||!preg_match('/^[a-f0-9]{64}$/D',$bid)||!is_array($records)||!array_is_list($records)||!count($records)||count($records)>($kind==='settings'?10:100))C::fail(400,'Érvénytelen naplócsomag.');
                foreach($records as $record){
                if(!is_array($record))C::fail(400,'Érvénytelen naplóbejegyzés.');
                $rid=$record['id']??null;
                if(!is_string($rid)||!Str::isUuid($rid)||($record['nodeId']??null)!==$node||!is_int($record['at']??null)||($record['schema']??null)!==1) C::fail(400,'Érvénytelen naplóbejegyzés.');
                if($kind==='settings'){
                    if(!is_array($record['data']??null))C::fail(400,'Hiányzó konfiguráció.');
                    $this->archive('settings',$id,$record['data'],$rid,(int)$record['at']);
                }else{
                    $key=hash('sha256',$id.':'.$rid);
                    if(!$this->db->get('telemetry',$key))$this->db->put('telemetry',$key,Telemetry::clean($record)+['userId'=>$owner['id'],'farmId'=>$rig['farmId'],'workerId'=>$id,'receivedAt'=>(int)(microtime(true)*1000)],$id);
                }
                }
                $ack[$kind.'Ack']=['id'=>$bid,'count'=>count($records)];
            }
            foreach($results as $result){
                if(!is_array($result)||!is_string($result['id']??null))continue;
                $job=$this->db->get('command',$result['id']);
                if(!$job||$job['rigId']!==$id||$job['state']!=='delivered'||$job['expires']<time())continue;
                $job['state']='complete';$job['ok']=($result['ok']??false)===true;
                if($job['ok'])$job['result']=Crypt::encrypt($result['data']??null);
                $this->db->put('command',$job['id'],$job,$id);
            }
            $commands=[];
            if(!($d['handshake']??false))foreach($this->db->all('command',$id) as $job){
                if($job['expires']<time()){$this->db->remove('command',$job['id']);continue;}
                if($job['state']!=='pending'||count($commands)>=16)continue;
                $job['state']='delivered';$this->db->put('command',$job['id'],$job,$id);
                $commands[]=['id'=>$job['id'],'route'=>$job['route'],'method'=>$job['method'],'body'=>Crypt::decrypt($job['body'])];
            }
            return ['workerId'=>$id,'commands'=>$commands,'backupSummary'=>$latest?$this->summary($latest):null,'recoveryPending'=>(bool)($rig['recoveryPending']??false)]+$ack+($recovery?['recovery'=>$recovery]:[]);
        });
    }
    public function agent(array $rig,string $route,string $method,?array $body=null): mixed
    {
        if(($rig['mode']??null)!=='outbound'){
            if(!in_array($rig['address'],array_map('trim',explode(',',config('localforge.direct_agents'))),true))C::fail(502,'A közvetlen agent címe nincs engedélyezve.');
            try {
                $request=Http::timeout(6)->withoutRedirecting()->acceptJson()->withToken(Crypt::decryptString($rig['token']));
                return ($method==='POST'?$request->post($rig['address'].'/api/v1/'.$route,$body??[]):$request->get($rig['address'].'/api/v1/'.$route))->throw()->json();
            }catch(\Throwable){C::fail(502,'A gép nem érhető el vagy elutasította a műveletet.');}
        }
        $id=$rig['id'];$live=$this->db->get('live',$id);
        if(!$live||$live['seenAt']<time()-15)C::fail(502,'A munkás offline.');
        if($route==='status'&&$method==='GET'){
            if(!isset($live['status'])||$live['statusAt']<time()-45)C::fail(502,'Nincs friss minerállapot.');
            return $live['status'];
        }
        $job=['id'=>(string)Str::uuid(),'rigId'=>$id,'route'=>$route,'method'=>$method,'body'=>Crypt::encrypt($body),'state'=>'pending','expires'=>time()+15];
        $this->db->mutate(function()use($job,$id){
            $active=0;
            foreach($this->db->all('command',$id) as $j)if($j['expires']<time())$this->db->remove('command',$j['id']);else $active++;
            if($active>=16)C::fail(429,'Túl sok függő művelet.');
            $this->db->put('command',$job['id'],$job,$id);
        });
        try{
            do{
                $j=$this->db->get('command',$job['id']);
                if(($j['state']??null)==='complete'){
                    if(!$j['ok'])C::fail(502,'A miner elutasította a műveletet.');
                    return Crypt::decrypt($j['result']);
                }
                usleep(100000);
            }while(time()<$job['expires']);
            C::fail(502,'A munkás válasza nem érkezett meg. Ellenőrizd az állapotot.');
        }finally{$this->db->remove('command',$job['id']);}
    }

    public function archive(string $kind,string $scope,array $data,?string $sourceId=null,?int $at=null): array
    {
        $digest=hash('sha256',json_encode($data,JSON_THROW_ON_ERROR));
        $key=$sourceId?hash('sha256',$scope.':'.$sourceId):null;

        $latest=$this->versions($kind,$scope)[0]??null;
        if(!$sourceId&&($latest['digest']??null)===$digest)return $latest;
        $id=$key?substr($key,0,8).'-'.substr($key,8,4).'-'.substr($key,12,4).'-'.substr($key,16,4).'-'.substr($key,20,12):(string)Str::uuid();
        if($key&&($old=$this->db->get($kind,$id)))return $old;
        $row=['id'=>$id,'day'=>$at?gmdate('Y-m-d',intdiv($at,1000)):gmdate('Y-m-d'),'createdAt'=>now()->toISOString(),'digest'=>$digest,'cipher'=>Crypt::encrypt($data),'profiles'=>count((array)($data['profiles']??[])),'wallets'=>count((array)($data['wallets']??[])),'oc'=>count((array)($data['oc']??[]))];
        $this->db->put($kind,$id,$row,$scope);return $row;
    }
    private function summary(array $v):array{unset($v['cipher'],$v['digest']);return $v;}
    private function versions(string $kind,string $scope):array
    {
        $list=$this->db->all($kind,$scope);usort($list,fn($a,$b)=>strcmp($b['createdAt'],$a['createdAt']));return $list;
    }
    public function archiveView(Request $r,string $kind,string $scope):array
    {
        $list=$this->versions($kind,$scope);
        if($r->filled('day'))$list=array_values(array_filter($list,fn($v)=>$v['day']===$r->query('day')));
        if($r->filled('version')){
            foreach($list as $v)if($v['id']===$r->query('version'))return ['version'=>$this->summary($v),'data'=>Crypt::decrypt($v['cipher'])];
            C::fail(404,'Ismeretlen verzió.');
        }
        return ['versions'=>array_map($this->summary(...),array_slice($list,max(0,(int)$r->query('offset')),200)),'retention'=>'unlimited'];
    }
    public function action(Request $r,array $rig,string $route,array $d):mixed
    {
        $id=$rig['id'];$post=$r->isMethod('POST');
        if($route==='connection-code'&&$post){
            if(!isset($rig['workerCode']))C::fail(404,'Nincs csatlakozási kód.');
            $farm=$this->db->get('farm',$rig['farmId']);$owner=$this->db->get('user',$farm['ownerId']);
            return ['code'=>Crypt::decryptString($rig['workerCode']),'username'=>$owner['name']]+(($rig['accountLogin']??false)?[]:['legacyName'=>$rig['name']]);
        }
        if($route==='remove'&&$post){
            $this->db->mutate(function()use($id){$this->db->remove('rig',$id);$this->db->remove('live',$id);});
            return ['ok'=>true];
        }
        if(!$post&&$route==='backup')return ['versions'=>array_map($this->summary(...),$this->versions('backup',$id)),'recoveryPending'=>(bool)($rig['recoveryPending']??false)];
        if(!$post&&$route==='configuration-archive')return $this->archiveView($r,'settings',$id);
        if(!$post&&in_array($route,['telemetry','telemetry/export'],true)){
            $list=$this->db->all('telemetry',$id);
            if($route==='telemetry/export'){
                $day=$r->query('day');
                if(!is_string($day)||!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$day))C::fail(400,'Érvénytelen dátum.');
                $rows=array_filter($list,fn($v)=>gmdate('Y-m-d',intdiv((int)$v['at'],1000))===$day);
                if(!$rows)C::fail(404,'Erre a napra nincs mentett telemetria.');
                return response()->streamDownload(function()use($rows){foreach($rows as $row)echo json_encode($row,JSON_THROW_ON_ERROR)."\n";},'telemetry-'.$day.'.jsonl',['Content-Type'=>'application/x-ndjson']);
            }
            $to=(int)$r->query('to',microtime(true)*1000);$from=(int)$r->query('from',$to-3600000);$offset=max(0,(int)$r->query('offset',0));$limit=max(1,min(2000,(int)$r->query('limit',500)));
            if($from<0||$to<$from||$to-$from>2678400000)C::fail(400,'Legfeljebb 31 nap kérdezhető le.');
            $days=[];$bytes=0;foreach($list as $row){$days[gmdate('Y-m-d',intdiv($row['at'],1000))]=true;$bytes+=strlen(json_encode($row));}ksort($days);
            $list=array_values(array_filter($list,fn($v)=>$v['at']>=$from&&$v['at']<=$to));usort($list,fn($a,$b)=>$a['at']<=>$b['at']);
            return ['records'=>array_slice($list,$offset,$limit),'total'=>count($list),'nextOffset'=>$offset+$limit<count($list)?$offset+$limit:null,'storage'=>['retention'=>'unlimited','days'=>count($days),'bytes'=>$bytes,'firstDay'=>array_key_first($days),'lastDay'=>array_key_last($days)]];
        }
        if(!in_array($route,$post?self::WRITE:self::READ,true))C::fail(404,'Ismeretlen agentművelet.');
        if($route==='history'){
            $range=$r->query('range','1h');if(!in_array($range,['1h','3h','6h','12h','1d'],true))C::fail(400,'Érvénytelen időtáv.');
            $route.='?range='.$range;
        }
        return $this->agent($rig,$route,$post?'POST':'GET',$post?$d:null);
    }
    public function ui(Request $r,array $rig,string $asset):mixed
    {
        if(str_starts_with($asset,'api/')){
            $route=substr($asset,4);
            if($route==='session'&&$r->isMethod('GET')){
                $caps=$this->agent($rig,'capabilities','GET');
                return ['token'=>$r->session()->token(),'engines'=>$caps['engines']??[],'remote'=>true];
            }
            if($route==='central-connection'&&$r->isMethod('GET'))return ['configured'=>true,'name'=>$rig['name'],'server'=>'','error'=>null,'backup'=>null,'remote'=>true];
            $post=$r->isMethod('POST');
            if(!in_array($route,$post?self::WRITE:self::READ,true))C::fail(404,'Ez a művelet nem érhető el a központból.');
            if($r->query()&&($route!=='history'||array_keys($r->query())!==['range']))C::fail(400,'Érvénytelen lekérdezés.');
            $data=$r->json()->all();
            if($post&&in_array($route,['profiles','flight-sheets'],true)){
                $known=array_column($this->agent($rig,'status','GET')['profiles']??[],null,'id');
                $preserve=function(array $p)use($known){if(($known[$p['id']??'']['passwordConfigured']??false)&&($p['password']??null)==='')unset($p['password']);return $p;};
                if($route==='profiles')$data=$preserve($data);
                elseif(is_array($data['miners']??null))$data['miners']=array_map($preserve,$data['miners']);
            }
            return $this->action($r,$rig,$route,$data);
        }
        if(!$r->isMethod('GET'))C::fail(405,'Csak olvasható felületfájl.');
        $allowed=['app.js','style.css','miner-catalog.json','algorithm-catalog.json','pool-catalog.json','pool-endpoints.json'];
        if($asset==='bridge.js')return response()->file(resource_path('localforge/bridge.js'),['Content-Type'=>'application/javascript; charset=utf-8']);
        if($asset===''){
            $prefix='/worker-ui/'.$rig['id'].'/';
            $html=file_get_contents(resource_path('localforge/miner/index.html'));
            $html=preg_replace('~(["\'])/(?!/)~','$1'.$prefix,$html);
            $html=str_replace('<script src="'.$prefix.'app.js"','<script src="'.$prefix.'bridge.js" defer></script><script src="'.$prefix.'app.js"',$html);
            return response($html)->header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'self'; base-uri 'none'");
        }
        if(!in_array($asset,$allowed,true)&&!preg_match('~^(coin-icons|gpu-images)/[A-Za-z0-9_.-]+\.(svg|png|webp)$~D',$asset))C::fail(404,'Ismeretlen erőforrás.');
        $path=resource_path('localforge/miner/'.$asset);
        if(!is_file($path))C::fail(404,'Ismeretlen erőforrás.');
        $type=match(pathinfo($asset,PATHINFO_EXTENSION)){'js'=>'application/javascript','css'=>'text/css','json'=>'application/json','svg'=>'image/svg+xml','png'=>'image/png','webp'=>'image/webp'};
        if($asset==='app.js'){
            $prefix='/worker-ui/'.$rig['id'].'/';
            return response(str_replace(['/coin-icons/','/gpu-images/'],[$prefix.'coin-icons/',$prefix.'gpu-images/'],file_get_contents($path)))->header('Content-Type',$type.'; charset=utf-8');
        }
        return response()->file($path,['Content-Type'=>$type]);
    }
}
