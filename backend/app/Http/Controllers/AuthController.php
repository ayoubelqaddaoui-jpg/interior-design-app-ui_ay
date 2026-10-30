<?php

namespace App\Http\Controllers;

use App\Services\AdminAuth;
use App\Services\Clients;
use App\Services\Content;
use App\Services\Outbox;
use App\Services\Sync;
use App\Support\Api;
use App\Support\Body;
use App\Support\Ctx;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class AuthController
{
    public function adminLogin(Request $request, AdminAuth $auth): Response
    {
        $body = Body::read($request);
        $email = Body::get($body, 'email');
        $password = Body::get($body, 'password');
        $identity = is_string($email) && is_string($password) && strlen($password) <= 512 ? $auth->identity($email, $password) : null;
        if (! $identity) {
            throw fail(401, 'Invalid credentials');
        }
        $token = $auth->createSession($identity);
        $response = Api::json(200, ['ok' => true, 'user' => ['id' => 'usr_admin', 'name' => 'Admin']] + (Ctx::of($request)->native() ? ['token' => $token] : []));

        return Api::withCookie($response, Api::cookie('dwira_admin', $token, 604800));
    }

    public function adminSession(Request $request, Content $content): Response
    {
        $ctx = Ctx::of($request);
        $ctx->requireAdmin();

        return Api::json(200, ['ok' => true, 'prefs' => $content->adminPrefs($ctx->adminId())]);
    }

    public function adminLogout(Request $request): Response
    {
        $session = Ctx::of($request)->adminSession();
        if ($session) {
            \Illuminate\Support\Facades\DB::table('admin_sessions')->where('token_hash', $session->token_hash)->delete();
        }

        return Api::withCookie(Api::json(200, ['ok' => true]), Api::cookie('dwira_admin', '', 0));
    }

    public function userLogin(Request $request, Clients $clients, Content $content, Sync $sync, Outbox $outbox): Response
    {
        $ctx = Ctx::of($request);
        $body = Body::read($request);
        $defaults = $content->getDoc('settings')->defaultFreeCredits ?? null;
        $result = $clients->login(Body::get($body, 'name'), Body::get($body, 'phone'), $defaults);
        $device = $ctx->clientHash();
        // Chats this device held as a visitor now belong to the person who just signed in.
        if ($device && count($clients->adoptGuest($device, $result['user']))) {
            $sync->bump("c:{$result['user']['id']}", 'chats', "g:$device");
        }
        if ($result['created']) {
            $job = "lead:{$result['user']['id']}";
            $outbox->enqueue('lead', $job, ['id' => $result['user']['id'], 'name' => $result['user']['name'], 'whatsapp' => $result['user']['whatsapp']]);
            $sync->bump('clients');
            $outbox->afterResponse($job);
        }
        $response = Api::json(200, ['user' => $result['user'], 'prefs' => $content->clientPrefs($result['user']['id'])] + ($ctx->native() ? ['token' => $result['token']] : []));

        return Api::withCookie($response, Api::cookie('dwira_user', $result['token'], 365 * 86400));
    }

    public function userSession(Request $request, Content $content): Response
    {
        $client = Ctx::of($request)->requireUser();

        return Api::json(200, ['user' => $client, 'prefs' => $content->clientPrefs($client['id'])]);
    }

    public function userLogout(Request $request, Clients $clients): Response
    {
        $clients->logout(Ctx::of($request)->userToken());

        return Api::withCookie(Api::json(200, ['ok' => true]), Api::cookie('dwira_user', '', 0));
    }

    public function userClaim(Request $request, Clients $clients, Sync $sync): Response
    {
        $ctx = Ctx::of($request);
        $body = Body::read($request);
        $client = $ctx->requireUser();
        $claimed = $clients->claim($client, Body::get($body, 'id'));
        $sync->bump("c:{$client['id']}", 'clients');

        return Api::json(200, ['user' => $claimed]);
    }
}
