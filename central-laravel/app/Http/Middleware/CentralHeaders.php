<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

final class CentralHeaders
{
    public function handle(Request $r,Closure $next)
    {
        $res=$next($r);
        $res->headers->set('Cache-Control','no-store');
        $res->headers->set('X-Content-Type-Options','nosniff');
        $res->headers->set('Referrer-Policy','no-referrer');
        if(!$res->headers->has('Content-Security-Policy'))$res->headers->set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        return $res;
    }
}
