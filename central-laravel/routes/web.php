<?php

use App\Http\Controllers\CentralController;
use Illuminate\Support\Facades\Route;

Route::get('/',fn()=>response()->file(public_path('index.html'),['Content-Type'=>'text/html; charset=utf-8','Cache-Control'=>'no-store']));
Route::match(['GET','POST'],'/api/{route}',[CentralController::class,'api'])->where('route','.+');
Route::match(['GET','POST'],'/worker-ui/{id}/{asset?}',[CentralController::class,'workerUi'])->where(['id'=>'[a-f0-9-]+','asset'=>'.*']);
