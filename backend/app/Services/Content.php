<?php

namespace App\Services;

use App\Support\Json;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/** Port of server/content.js: collections, documents, preferences. The database is the only source of truth. */
class Content
{
    public const COLLECTIONS = ['tabs', 'tools', 'roomTypes', 'styles', 'palettes', 'sections', 'categories', 'inspirations', 'models', 'plans'];

    public const DOCS = ['branding', 'theme', 'assistant', 'settings'];

    private const LANGS = ['dar', 'ar', 'fr'];

    private bool $seeded = false;

    public function __construct(private readonly Sync $sync, private readonly Media $media, private readonly Settings $settings)
    {
    }

    /** First start only. A flag row makes this run once so content an admin deleted is never resurrected. */
    public function ensureSeed(): void
    {
        if ($this->seeded) {
            return;
        }
        if ($this->settings->get('content_seeded') === null) {
            $seed = Json::decode((string) file_get_contents(database_path('seed-content.json')));
            $now = now_ms();
            Sql::tx(function () use ($seed, $now) {
                if (! $this->settings->putIfAbsent('content_seeded', (string) $now)) {
                    return;
                }
                foreach ($seed->collections as $coll => $rows) {
                    foreach ($rows as $row) {
                        DB::statement('INSERT IGNORE INTO content_items(coll,id,data,updated_at) VALUES(?,?,?,?)', [$coll, $row->id, Json::encode($row), $now]);
                    }
                }
                foreach ($seed->docs as $name => $doc) {
                    DB::statement('INSERT IGNORE INTO content_docs(name,data,updated_at) VALUES(?,?,?)', [$name, Json::encode($doc), $now]);
                }
            });
            $this->sync->bump('content');
        }
        $this->seeded = true;
    }

    /** Strings already stored in a row (external URLs among them are not re-downloaded on every save). */
    private static function strings(mixed $value, array &$out = []): array
    {
        if (is_string($value)) {
            $out[$value] = true;
        } elseif (is_array($value) || $value instanceof \stdClass) {
            foreach ((array) $value as $child) {
                self::strings($child, $out);
            }
        }

        return $out;
    }

    /**
     * Snapshot as a ready-to-send JSON string. Cached per (admin?, content version): the version in sync_state is the
     * invalidation key, so one cheap query decides whether the cached body is still valid.
     *
     * @return array{json:string,version:int}
     */
    public function snapshotJson(bool $isAdmin): array
    {
        $this->ensureSeed();
        $version = $this->sync->read(['content'])['content'];
        $key = 'content:'.($isAdmin ? 'a' : 'p').':'.$version;
        $json = Cache::get($key);
        if (! is_string($json)) {
            $json = Json::encode($this->snapshot($isAdmin, $version));
            Cache::put($key, $json, 3600);
        }

        return ['json' => $json, 'version' => $version];
    }

    public function snapshot(bool $isAdmin, ?int $version = null): array
    {
        $collections = [];
        foreach (self::COLLECTIONS as $name) {
            $collections[$name] = [];
        }
        foreach (DB::table('content_items')->orderBy('seq')->get(['coll', 'data']) as $row) {
            if (! isset($collections[$row->coll])) {
                continue;
            }
            $item = Json::decode($row->data);
            if ($row->coll === 'models' && ! $isAdmin && $item instanceof \stdClass) {
                $item->apiKey = '';
            }
            $collections[$row->coll][] = $item;
        }
        $docs = new \stdClass;
        foreach (DB::table('content_docs')->get(['name', 'data']) as $row) {
            $docs->{$row->name} = Json::decode($row->data);
        }

        return ['version' => $version ?? $this->sync->read(['content'])['content'], 'collections' => $collections, 'docs' => $docs];
    }

    public function putItem(string $coll, string $id, mixed $body): \stdClass
    {
        if (! in_array($coll, self::COLLECTIONS, true)) {
            throw fail(404, 'Unknown collection');
        }
        if (! preg_match('/^[A-Za-z0-9_-]{1,100}$/D', $id)) {
            throw fail(400, 'Invalid id');
        }
        if (! ($body instanceof \stdClass)) {
            throw fail(400, 'Invalid item');
        }
        $this->ensureSeed();
        $oldRow = DB::table('content_items')->where('coll', $coll)->where('id', $id)->first();
        $old = $oldRow ? Json::decode($oldRow->data) : null;
        $item = Json::merge($this->media->externalize($body, 'strict', false, true, self::strings($old))['value'], (object) ['id' => $id]);
        if ($coll === 'models' && ! property_exists($item, 'apiKey') && $old instanceof \stdClass) {
            $item->apiKey = $old->apiKey ?? '';
        }
        DB::statement('INSERT INTO content_items(coll,id,data,updated_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)', [$coll, $id, Json::encode($item), now_ms()]);
        $this->sync->bump('content');

        return $item;
    }

    public function deleteItems(string $coll, mixed $ids): void
    {
        if (! in_array($coll, self::COLLECTIONS, true)) {
            throw fail(404, 'Unknown collection');
        }
        if (! is_array($ids) || count($ids) > 500) {
            throw fail(400, 'Invalid ids');
        }
        foreach ($ids as $id) {
            if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{1,100}$/D', $id)) {
                throw fail(400, 'Invalid ids');
            }
        }
        $this->ensureSeed();
        foreach ($ids as $id) {
            DB::table('content_items')->where('coll', $coll)->where('id', $id)->delete();
        }
        $this->sync->bump('content');
    }

    public function patchDoc(string $name, mixed $patch): \stdClass
    {
        if (! in_array($name, self::DOCS, true)) {
            throw fail(404, 'Unknown document');
        }
        if (! ($patch instanceof \stdClass)) {
            throw fail(400, 'Invalid document');
        }
        $this->ensureSeed();
        $current = DB::table('content_docs')->where('name', $name)->first();
        $clean = $this->media->externalize($patch, 'strict', false, true, self::strings($current ? Json::decode($current->data) : null))['value'];
        $next = Sql::tx(function () use ($name, $clean) {
            $row = DB::selectOne('SELECT data FROM content_docs WHERE name=? FOR UPDATE', [$name]);
            $merged = Json::merge($row ? Json::decode($row->data) : new \stdClass, $clean);
            DB::statement('INSERT INTO content_docs(name,data,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at)', [$name, Json::encode($merged), now_ms()]);

            return $merged;
        });
        $this->sync->bump('content');

        return $next;
    }

    public function getDoc(string $name): \stdClass
    {
        $this->ensureSeed();
        $row = DB::table('content_docs')->where('name', $name)->first();
        $doc = $row ? Json::decode($row->data) : null;

        return $doc instanceof \stdClass ? $doc : new \stdClass;
    }

    // ---- preferences (one row per client, one per admin) ----

    private static function cleanPrefs(mixed $input): \stdClass
    {
        if (! ($input instanceof \stdClass)) {
            throw fail(400, 'Invalid preferences');
        }
        $out = new \stdClass;
        if (property_exists($input, 'notifications')) {
            if (! is_bool($input->notifications)) {
                throw fail(400, 'Invalid notifications');
            }
            $out->notifications = $input->notifications;
        }
        if (property_exists($input, 'bannerDismissed')) {
            if (! is_bool($input->bannerDismissed)) {
                throw fail(400, 'Invalid banner');
            }
            $out->bannerDismissed = $input->bannerDismissed;
        }
        if (property_exists($input, 'lang')) {
            if (! in_array($input->lang, self::LANGS, true)) {
                throw fail(400, 'Invalid language');
            }
            $out->lang = $input->lang;
        }

        return $out;
    }

    private static function obj(?string $json): \stdClass
    {
        $v = Json::tryDecode($json);

        return $v instanceof \stdClass ? $v : new \stdClass;
    }

    public function adminPrefs(string $adminId): \stdClass
    {
        return self::obj(DB::table('admin_prefs')->where('admin_id', $adminId)->value('data'));
    }

    public function clientPrefs(string $clientId): \stdClass
    {
        return self::obj(DB::table('clients')->where('id', $clientId)->value('prefs'));
    }

    public function setAdminPrefs(string $adminId, mixed $patch): \stdClass
    {
        $clean = self::cleanPrefs($patch);
        $next = Json::merge($this->adminPrefs($adminId), $clean);
        DB::statement('INSERT INTO admin_prefs(admin_id,data) VALUES(?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)', [$adminId, Json::encode($next)]);
        $this->sync->bump("a:$adminId");

        return $next;
    }

    public function setClientPrefs(string $clientId, mixed $patch): \stdClass
    {
        $clean = self::cleanPrefs($patch);
        $next = Sql::tx(function () use ($clientId, $clean) {
            $row = DB::selectOne('SELECT prefs FROM clients WHERE id=? FOR UPDATE', [$clientId]);
            if (! $row) {
                throw fail(404, 'NOT_FOUND');
            }
            $merged = Json::merge(self::obj($row->prefs), $clean);
            DB::table('clients')->where('id', $clientId)->update(['prefs' => Json::encode($merged)]);

            return $merged;
        });
        $this->sync->bump("c:$clientId");

        return $next;
    }
}
