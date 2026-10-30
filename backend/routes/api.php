<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ContentController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\PrefsController;
use App\Http\Controllers\PushController;
use App\Http\Controllers\RequestController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

/*
 * Every route of server/index.js, same path and method. `Route::any` is used where the Node API answered 405 "Method not
 * allowed" for a known path with a wrong method (the controller throws it); every other mismatch is the generic 404
 * "API route not found" (bootstrap/app.php). Static paths are declared before the `{id}` patterns they could collide with.
 */
$id = '[A-Za-z0-9_-]{1,100}';

Route::get('/health', HealthController::class);
Route::get('/content', [ContentController::class, 'show']);
Route::get('/sync', SyncController::class);
Route::any('/prefs', PrefsController::class);

// ---- client accounts ----
Route::post('/user/login', [AuthController::class, 'userLogin']);
Route::get('/user/session', [AuthController::class, 'userSession']);
Route::post('/user/logout', [AuthController::class, 'userLogout']);
Route::post('/user/claim', [AuthController::class, 'userClaim']);
Route::get('/user/requests', [UserController::class, 'requests']);
Route::any('/guest/conversations/{id?}', [UserController::class, 'guest'])->where('id', $id);
Route::any('/user/{kind}/{id?}', [UserController::class, 'space'])->where(['kind' => 'history|conversations', 'id' => $id]);

// ---- admin ----
Route::post('/admin/login', [AuthController::class, 'adminLogin']);
Route::get('/admin/session', [AuthController::class, 'adminSession']);
Route::post('/admin/logout', [AuthController::class, 'adminLogout']);
Route::get('/admin/clients', [AdminController::class, 'clients']);
Route::post('/admin/clients/bulk', [AdminController::class, 'bulk']);
Route::any('/admin/clients/{id}', [AdminController::class, 'client'])->where('id', '[a-f0-9-]+');
Route::get('/admin/conversations', [AdminController::class, 'conversations']);
Route::post('/admin/conversations/{id}', [AdminController::class, 'reply'])->where('id', $id);
Route::get('/admin/notification-subscribers', [AdminController::class, 'notificationSubscribers']);
Route::any('/admin/content/{coll}/{id?}', [AdminController::class, 'contentItem'])->where(['coll' => '[A-Za-z]+', 'id' => $id]);
Route::post('/admin/translate', [AdminController::class, 'translate']);
Route::patch('/admin/doc/{name}', [AdminController::class, 'doc'])->where('name', '[A-Za-z]+');
Route::get('/admin/chat/status', [AdminController::class, 'chatStatus']);
Route::patch('/admin/chat/keys', [AdminController::class, 'chatKeys']);

// ---- campaigns ----
Route::any('/admin/campaigns', [CampaignController::class, 'root']);
Route::get('/admin/campaigns/segments', [CampaignController::class, 'segments']);
Route::post('/admin/campaigns/preview', [CampaignController::class, 'preview']);
Route::get('/admin/campaigns/people', [CampaignController::class, 'people']);
Route::post('/admin/campaigns/test', [CampaignController::class, 'test']);
Route::any('/admin/campaigns/{id}', [CampaignController::class, 'one']);
Route::any('/admin/campaigns/{id}/{action}', [CampaignController::class, 'action']);

// ---- assistant ----
Route::post('/chat/reply', [ChatController::class, 'reply']);

// ---- media ----
Route::match(['GET', 'HEAD'], '/media/{name}', [MediaController::class, 'show'])->where('name', '[^/]+');
Route::post('/admin/media', [MediaController::class, 'upload']);
Route::post('/admin/media/raw', [MediaController::class, 'raw']);
Route::post('/admin/media/import', [MediaController::class, 'import']);
Route::post('/admin/media/presign', [MediaController::class, 'presign']);
Route::post('/admin/media/complete', [MediaController::class, 'complete']);

// ---- push ----
Route::get('/push/config', [PushController::class, 'config']);
Route::any('/push/subscriptions', [PushController::class, 'subscriptions']);
Route::post('/push/test', [PushController::class, 'test']);
Route::match(['GET', 'POST'], '/push/pump', [PushController::class, 'pump']);

// ---- render requests ----
Route::post('/requests', [RequestController::class, 'create']);
Route::get('/requests', [RequestController::class, 'index']);
Route::any('/requests/{id}', [RequestController::class, 'one'])->where('id', '[A-Za-z0-9_-]+');
