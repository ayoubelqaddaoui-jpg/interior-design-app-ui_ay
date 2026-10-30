<?php

namespace App\Providers;

use App\Services\AdminAuth;
use App\Services\Campaigns;
use App\Services\Chat;
use App\Services\Clients;
use App\Services\Content;
use App\Services\Media;
use App\Services\Notifier;
use App\Services\Outbox;
use App\Services\Settings;
use App\Services\Sync;
use App\Services\Translate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One instance per request (they hold small per-request caches / flags); tests may swap closures on them.
        foreach ([Sync::class, Settings::class, Clients::class, Media::class, Content::class, Outbox::class, Campaigns::class, Chat::class, Translate::class, AdminAuth::class] as $class) {
            $this->app->singleton($class);
        }
        $this->app->singleton(Notifier::class, fn ($app) => new Notifier($app->make(Settings::class), $app->make(Content::class)));
        $this->app->singleton(Media::class, fn () => new Media);
    }

    public function boot(): void
    {
    }
}
