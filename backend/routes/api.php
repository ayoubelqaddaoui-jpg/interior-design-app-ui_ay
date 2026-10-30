<?php

use App\Http\Controllers\HealthController;
use Illuminate\Support\Facades\Route;

// All routes live under /api (see bootstrap/app.php). Paths, methods and JSON shapes mirror server/index.js.
Route::get('/health', HealthController::class);
