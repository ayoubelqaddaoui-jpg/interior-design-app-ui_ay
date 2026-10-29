<?php

use App\Support\ApiException;

if (! function_exists('fail')) {
    /** `throw fail(404, 'NOT_FOUND')` -> `{ "error": "NOT_FOUND" }` with that status (same codes as the Node API). */
    function fail(int $status, string $message): ApiException
    {
        return new ApiException($status, $message);
    }
}
if (! function_exists('now_ms')) {
    function now_ms(): int
    {
        return (int) floor(microtime(true) * 1000);
    }
}
