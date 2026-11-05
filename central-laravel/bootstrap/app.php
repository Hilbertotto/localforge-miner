<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', commands: __DIR__.'/../routes/console.php', health: '/up')
    ->withMiddleware(function (Middleware $middleware) {
        // Existing miner and browser clients use the API's explicit X-CSRF-Token.
        $middleware->validateCsrfTokens(except: ['api/*','worker-ui/*']);
        $middleware->append(\App\Http\Middleware\CentralHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->shouldRenderJsonWhen(fn(Request $r,Throwable $e)=>$r->is('api/*','worker-ui/*')||$r->expectsJson());
        $exceptions->render(function(\Illuminate\Validation\ValidationException $e,Request $r){
            if($r->is('api/*','worker-ui/*')) return response()->json(['error'=>collect($e->errors())->flatten()->first()],400);
        });
        $exceptions->render(function(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e,Request $r){
            if($r->is('api/*','worker-ui/*'))return response()->json(['error'=>$e->getMessage()?:'Sikertelen kérés.'],$e->getStatusCode(),$e->getHeaders());
        });
        $exceptions->render(function(Throwable $e,Request $r){
            if($r->is('api/*','worker-ui/*'))return response()->json(['error'=>'Belső szerverhiba.'],500);
        });
    })->create();
