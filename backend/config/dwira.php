<?php

/** Everything specific to this API. Read once by `php artisan config:cache`; never call env() outside config files. */
return [
    'admin' => [
        'email' => env('ADMIN_EMAIL'),
        // Argon2id / bcrypt ($argon2id$..., $2y$...) or the legacy Node format "salt:scrypt-hex". No default account exists.
        'password_hash' => env('ADMIN_PASSWORD_HASH'),
        'session_days' => 7,
    ],
    // Browser origins allowed besides same-origin (comma separated, no paths). Same-origin needs no entry.
    'origins' => array_values(array_filter(array_map('trim', explode(',', (string) env('APP_ORIGINS', ''))))),
    'cookie_secure' => env('COOKIE_SECURE', true),
    'rate' => [
        'login' => 20,
        'sync' => 20000,
        'chat' => max(5, min(2000, (int) env('CHAT_RATE_LIMIT', 90) ?: 90)),
        'api' => max(300, min(5000, (int) env('API_RATE_LIMIT', 300) ?: 300)),
        'window' => 900, // seconds (15 minutes, as before)
    ],
    'content_s_maxage' => max(0, min(300, (int) env('CONTENT_S_MAXAGE', 30))),
    'push_wait_ms' => (int) env('PUSH_WAIT_MS', 8000),
    'cron_secret' => env('CRON_SECRET'),
    'vapid' => [
        'public' => env('VAPID_PUBLIC_KEY'),
        'private' => env('VAPID_PRIVATE_KEY'),
        'subject' => env('VAPID_SUBJECT', 'mailto:admin@example.com'),
    ],
    'fcm_service_account_json' => env('FCM_SERVICE_ACCOUNT_JSON'),
    'media' => [
        'max_image_mb' => max(1, min(5000, (int) env('MEDIA_MAX_IMAGE_MB', 10))),
        'max_video_mb' => max(1, min(5000, (int) env('MEDIA_MAX_VIDEO_MB', 100))),
        'webp_quality' => max(40, min(95, (int) env('MEDIA_WEBP_QUALITY', 82))),
        'max_dimension' => max(800, min(8000, (int) env('MEDIA_MAX_DIMENSION', 2560))),
        'thumb_widths' => [320, 640],
    ],
    'chat' => [
        'gemini_key' => env('GEMINI_API_KEY'),
        'groq_key' => env('GROQ_API_KEY'),
        'openrouter_key' => env('OPENROUTER_API_KEY'),
        'order' => env('CHAT_PROVIDER_ORDER', ''),
        'gemini_model' => env('GEMINI_MODEL', ''),
        'groq_model' => env('GROQ_MODEL', ''),
        'openrouter_model' => env('OPENROUTER_MODEL', ''),
        'pollinations_model' => env('POLLINATIONS_MODEL', ''),
    ],
];
