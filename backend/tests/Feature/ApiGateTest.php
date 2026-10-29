<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class ApiGateTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_health_shape_and_headers(): void
    {
        $r = $this->getJson('/api/health');
        $r->assertOk()->assertExactJson(['ok' => true, 'runtime' => 'php', 'database' => 'mysql', 'media' => 'disk', 'adminConfigured' => false]);
        // Symfony appends ", private" to a bare no-store; identical meaning for every cache.
        $this->assertStringStartsWith('no-store', $r->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $r->headers->get('X-Content-Type-Options'));
        $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        $this->assertStringStartsWith('application/json', $r->headers->get('Content-Type'));
    }

    public function test_unknown_route_is_404_api_route_not_found(): void
    {
        $this->get('/api/nope')->assertStatus(404)->assertExactJson(['error' => 'API route not found']);
        $this->post('/api/health')->assertStatus(404)->assertExactJson(['error' => 'API route not found']);
    }

    public function test_foreign_origin_is_refused_and_listed_origin_allowed_with_credentials(): void
    {
        $this->get('/api/health', ['Origin' => 'https://evil.example'])->assertStatus(403)->assertExactJson(['error' => 'Origin not allowed']);
        $ok = $this->get('/api/health', ['Origin' => 'http://localhost:4173']);
        $ok->assertOk();
        $this->assertSame('http://localhost:4173', $ok->headers->get('Access-Control-Allow-Origin'));
        $this->assertSame('true', $ok->headers->get('Access-Control-Allow-Credentials'));
        $this->assertStringContainsString('Origin', $ok->headers->get('Vary'));
    }

    public function test_same_origin_and_app_url_need_no_configuration(): void
    {
        $this->get('/api/health', ['Origin' => 'http://localhost'])->assertOk();
    }

    public function test_cross_site_write_without_origin_header_is_refused(): void
    {
        $this->post('/api/health', [], ['Sec-Fetch-Site' => 'cross-site'])->assertStatus(403);
    }

    public function test_preflight_is_204_with_the_allowed_headers(): void
    {
        $r = $this->call('OPTIONS', '/api/user/login', [], [], [], ['HTTP_ORIGIN' => 'http://localhost:4173']);
        $r->assertStatus(204);
        $this->assertSame('Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-User-Token', $r->headers->get('Access-Control-Allow-Headers'));
    }

    public function test_login_bucket_allows_20_then_429(): void
    {
        for ($i = 0; $i < 20; $i++) {
            $this->assertNotSame(429, $this->post('/api/admin/login')->getStatusCode());
        }
        $this->post('/api/admin/login')->assertStatus(429)->assertExactJson(['error' => 'Too many requests']);
        // other buckets are independent
        $this->get('/api/health')->assertOk();
    }

    public function test_errors_never_leak_sql_or_traces(): void
    {
        $good = config('database.connections.mysql.password');
        try {
            config(['database.connections.mysql.password' => 'wrong-secret-pw']);
            \DB::purge();
            $r = $this->get('/api/health');
            $r->assertStatus(503)->assertJsonPath('ok', false);
            $this->assertStringNotContainsString('wrong-secret-pw', $r->getContent());
            $this->assertStringNotContainsString('SQLSTATE', $r->getContent());
        } finally {
            config(['database.connections.mysql.password' => $good]);
            \DB::purge();
        }
    }
}
