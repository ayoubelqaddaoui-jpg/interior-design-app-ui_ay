<?php

/*
 * The only PHP file in public_html: hands every /api/* request to Laravel.
 * Laravel itself lives outside the web root: ../laravel (sibling of public_html). Change $app below if you moved it.
 */

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$app = is_dir(__DIR__.'/../laravel') ? __DIR__.'/../laravel' : __DIR__.'/laravel';

if (file_exists($maintenance = $app.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $app.'/vendor/autoload.php';

/** @var Illuminate\Foundation\Application $laravel */
$laravel = require_once $app.'/bootstrap/app.php';

$laravel->handleRequest(Request::capture());
