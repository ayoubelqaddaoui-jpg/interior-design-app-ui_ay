<?php

namespace App\Http\Controllers;

use App\Support\Json;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class HealthController
{
    /** Never exposes secrets: only whether the database answers, the media mode and whether admin credentials are set. */
    public function __invoke(): Response
    {
        $database = 'error';
        try {
            DB::select('select 1');
            $database = 'mysql';
        } catch (\Throwable) {
        }
        $ok = $database !== 'error';

        return new Response(Json::encode([
            'ok' => $ok,
            'runtime' => 'php',
            'database' => $database,
            'media' => 'disk',
            'adminConfigured' => (bool) (config('dwira.admin.email') && config('dwira.admin.password_hash')),
        ]), $ok ? 200 : 503, ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store']);
    }
}
