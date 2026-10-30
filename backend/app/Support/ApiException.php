<?php

namespace App\Support;

use Illuminate\Http\Response;
use RuntimeException;

/** An error the client is allowed to see: always `{ "error": "<message>" }` with the status of the Node API. */
class ApiException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }

    public static function response(int $status, string $message): Response
    {
        return new Response(Json::encode(['error' => $message]), $status, [
            'Content-Type' => 'application/json',
            'Cache-Control' => 'no-store',
        ]);
    }
}
