<?php

use App\Central\Store;
use Illuminate\Support\Facades\{Artisan,Hash};

Artisan::command('localforge:admin', function (Store $store) {
    if ($store->get('system','admin')) { $this->error('An administrator already exists.'); return 1; }
    $password=config('localforge.admin_password')??$this->secret('Administrator password (12 characters minimum)');
    if(!is_string($password)||strlen($password)<12||strlen($password)>72){$this->error('Invalid password length.');return 1;}
    $store->mutate(function()use($store,$password){
        if($store->get('system','admin'))throw new RuntimeException('An administrator already exists.');
        $store->put('system','admin',['hash'=>Hash::make($password)]);
    });
    $this->info('Administrator created.');
    return 0;
})->purpose('Initialize a new Central administrator');

Artisan::command('localforge:import-legacy {source}', function (\App\Central\LegacyImport $import) {
    try {
        $counts=$import->run($this->argument('source'));
        foreach($counts as $kind=>$count)$this->line($kind.': '.$count);
        return 0;
    } catch (\Throwable $e) {
        $this->error($e instanceof \RuntimeException && !($e instanceof \Illuminate\Database\QueryException) ? $e->getMessage() : 'Import failed. No records were committed.');
        return 1;
    }
})->purpose('Import a legacy Central snapshot into an empty database');
