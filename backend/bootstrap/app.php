<?php

use App\Http\Middleware\ApiGate;
use App\Support\ApiException;
use App\Support\ErrorReporter;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: 'api',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The API reads bodies itself (raw JSON, exact strings): never trim strings or turn "" into null, and CORS is ours.
        $middleware->remove([
            \Illuminate\Foundation\Http\Middleware\TrimStrings::class,
            \Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull::class,
            \Illuminate\Http\Middleware\HandleCors::class,
        ]);
        $trusted = env('TRUSTED_PROXIES');
        if ($trusted) {
            $middleware->trustProxies(at: $trusted === '*' ? '*' : array_map('trim', explode(',', $trusted)));
        }
        $middleware->prepend(ApiGate::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => true);
        // Never write SQL (it contains bindings such as tokens), request data or traces to the log: one redacted line.
        $exceptions->reportable(function (Throwable $e) {
            ErrorReporter::report($e);
        })->stop();
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($e instanceof ApiException) {
                return ApiException::response($e->status, $e->getMessage());
            }
            // The Node API answers every unknown route / wrong method with 404 "API route not found".
            if ($e instanceof NotFoundHttpException || $e instanceof MethodNotAllowedHttpException) {
                return ApiException::response(404, 'API route not found');
            }
            if ($e instanceof \Illuminate\Http\Exceptions\PostTooLargeException) {
                return ApiException::response(413, 'Request too large');
            }
            if ($e instanceof HttpExceptionInterface) {
                return ApiException::response($e->getStatusCode(), $e->getStatusCode() === 503 ? 'BACKEND_UNAVAILABLE' : 'Server error');
            }

            return ApiException::response(500, 'Server error');
        });
    })->create();
