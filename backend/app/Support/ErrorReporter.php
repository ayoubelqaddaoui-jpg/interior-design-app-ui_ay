<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * One redacted line per unexpected error. Never the message (a database error carries the SQL and its bindings: session
 * tokens, phone numbers), never the request, never a stack trace. Enough to find the code: class, SQLSTATE/code, file:line.
 */
final class ErrorReporter
{
    public static function report(Throwable $e): void
    {
        if ($e instanceof ApiException && $e->status < 500) {
            return; // expected client errors are not log material
        }
        try {
            Log::error('api_error', [
                'class' => class_basename($e),
                'code' => $e instanceof \PDOException ? (string) ($e->errorInfo[0] ?? $e->getCode()) : (string) $e->getCode(),
                'at' => basename($e->getFile()).':'.$e->getLine(),
            ]);
        } catch (Throwable) {
            // logging must never break the response
        }
    }
}
