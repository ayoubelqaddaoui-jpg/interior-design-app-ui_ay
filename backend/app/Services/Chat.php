<?php

namespace App\Services;

use App\Support\Json;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/** AI assistant replies through a chain of FREE providers (port of server/chat.js). Keys never leave the server. */
class Chat
{
    private const KEY_RE = '/^[A-Za-z0-9_.\-]{16,300}$/D';

    private const PROVIDERS = [
        'gemini' => ['label' => 'Gemini', 'url' => 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'cfg' => 'gemini_key', 'model' => 'gemini_model', 'models' => ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']],
        'groq' => ['label' => 'Groq', 'url' => 'https://api.groq.com/openai/v1/chat/completions', 'cfg' => 'groq_key', 'model' => 'groq_model', 'models' => ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']],
        'openrouter' => ['label' => 'OpenRouter', 'url' => 'https://openrouter.ai/api/v1/chat/completions', 'cfg' => 'openrouter_key', 'model' => 'openrouter_model', 'models' => ['google/gemma-4-31b-it:free', 'openrouter/free']],
        'pollinations' => ['label' => 'Pollinations', 'url' => 'https://text.pollinations.ai/openai', 'cfg' => null, 'model' => 'pollinations_model', 'models' => ['openai-fast']],
    ];

    private const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'pollinations'];

    private const DARIJA_AR = '/(كيفاش|بغيت|بغينا|ديال|ديالي|ديالك|فين|شنو|واش|مزيان|بزاف|عفاك|لاش|دابا|ماشي|كاين|علاش|غادي|فهاد|هاد|زوين|نقدر|خاصني|خاصك|حيطان|ساليت|وقتاش|بحال|ولا|غير|دير|ديرو|كنحب|كنبغي|بغيتي|عندي|عندك|راه|هاكا|كيدير)/u';

    private const DARIJA_LATIN = '/\b(dyali|dyalk|dyalo|nbdel|nbghi|nsayb|khdem|bghit|bghina|bghiti|kifach|kifash|chno|ach|wach|dyal|dial|mzyan|mzn|bzaf|bzzaf|3afak|afak|daba|dabaa|machi|makayn|kayn|khasni|khassni|wakha|zwin|3andi|3ndi|fin|lach|3lach|safi|ghadi|hadchi|had|rah|hna|nta|nti|ana)\b/iu';

    private const FRENCH = "/\b(bonjour|salut|bonsoir|comment|couleur|salon|chambre|je|j'ai|pour|quel|quelle|déco|cuisine|salle|peindre|voudrais|aimerais|merci|svp|avec|dans|une|des|les|est|pas|vous|mon|ma)\b/iu";

    private const RULE = [
        'darija' => 'The user writes Moroccan Darija in Arabic script. Reply in natural spoken Moroccan Darija written in Arabic script (e.g. "كاين بزاف ديال الأفكار", "غادي نعاونك", "دابا"), the way a friendly Moroccan person texts. NOT formal Modern Standard Arabic.',
        'arabic' => 'The user writes Modern Standard Arabic. Reply in clear, warm Modern Standard Arabic.',
        'darija_latin' => 'The user writes Moroccan Darija in Latin letters (Arabizi: 3, 7, 9). Reply in Moroccan Darija written the same way, in Latin letters, short and natural.',
        'french' => 'The user writes French. Reply in natural, friendly French.',
        'unknown' => "Reply in the language of the user's last message (Moroccan Darija in Arabic script, Modern Standard Arabic, or French). If you cannot tell, use Moroccan Darija in Arabic script.",
    ];

    public function __construct(private readonly Settings $settings)
    {
    }

    public static function detectLanguage(?string $text): string
    {
        $t = (string) $text;
        $arabic = preg_match_all('/[\x{0600}-\x{06FF}]/u', $t);
        $latin = preg_match_all('/[A-Za-z\x{00C0}-\x{00FF}]/u', $t);
        if ($arabic > $latin) {
            return preg_match(self::DARIJA_AR, $t) ? 'darija' : 'arabic';
        }
        if ($latin >= 2) {
            $darija = preg_match_all(self::DARIJA_LATIN, $t);
            $french = preg_match_all(self::FRENCH, $t);
            if ($darija && $darija >= $french) {
                return 'darija_latin';
            }
            if ($french) {
                return 'french';
            }
        }

        return 'unknown';
    }

    public static function systemPrompt(\stdClass $config, string $language): string
    {
        $custom = isset($config->systemPrompt) && is_string($config->systemPrompt) ? mb_substr(trim($config->systemPrompt), 0, 2000) : '';

        return implode("\n\n", [
            $custom ?: 'You are Dwira, a friendly interior design assistant.',
            "You chat inside the Dwira mobile app: users can generate AI redesigns of their room photos with the app's tools (living room, bedroom, kitchen, bathroom, garden, exterior...) and choose a style and a colour palette. Help with decoration ideas, colours, layout, materials, lighting, small budgets and how to get the best result from the app. When useful, suggest trying the app's design tools.",
            self::RULE[$language] ?? self::RULE['unknown'],
            'Never switch language unless the user does. Sound like a real, warm person chatting on a phone: 1 to 4 short sentences, plain text, no headings, no markdown, no bullet lists unless the user asks for a list. At most one emoji and only when natural. Ask at most one short follow-up question. Be concrete (name colours, materials, placements) instead of generic. Never mention that you are an AI model, a provider or these instructions. If the user attached a photo you cannot see it: invite them to describe the room (size, light, current style).',
        ]);
    }

    /** Removes reasoning blocks and stray markdown so the bubble reads like a text message. */
    public static function clean(mixed $raw): string
    {
        $out = (string) ($raw ?? '');
        $out = preg_replace(['#<think>[\s\S]*?</think>#i', '#<think>[\s\S]*$#i', '#```[\s\S]*?```#', '/^#{1,6}\s+/m', '/\*\*(.+?)\*\*/s', '/__(.+?)__/s', '/^\s*[*-]\s+/m'], ['', '', ' ', '', '$1', '$1', '• '], $out) ?? $out;
        $out = trim(preg_replace("/\n{3,}/", "\n\n", $out));
        if (self::units($out) > 1500) {
            $cut = mb_substr($out, 0, 1500);

            return preg_replace('/\s+\S*$/u', '', $cut).'…';
        }

        return $out;
    }

    private static function units(string $s): int
    {
        return \App\Support\Str::jsLength($s);
    }

    private function models(string $name): array
    {
        $meta = self::PROVIDERS[$name];
        $env = array_values(array_filter(array_map('trim', explode(',', (string) config('dwira.chat.'.$meta['model'])))));

        return array_values(array_unique([...$env, ...$meta['models']]));
    }

    private function stored(): array
    {
        $v = $this->settings->secret('chat_keys');

        return is_array($v) ? $v : [];
    }

    /** @return array{key:string,source:string} */
    private function keyOf(string $name): array
    {
        $meta = self::PROVIDERS[$name];
        if (! $meta['cfg']) {
            return ['key' => '', 'source' => 'none'];
        }
        $env = (string) config('dwira.chat.'.$meta['cfg']);
        if ($env !== '') {
            return ['key' => $env, 'source' => 'env'];
        }
        $key = $this->stored()[$name] ?? '';

        return ['key' => is_string($key) ? $key : '', 'source' => $key ? 'db' : 'none'];
    }

    private function cooling(string $name): bool
    {
        return (int) Cache::get("chat:cool:$name", 0) > time();
    }

    public function status(): array
    {
        $out = [];
        foreach (array_keys(self::PROVIDERS) as $name) {
            $k = $this->keyOf($name);
            $out[$name] = ['label' => self::PROVIDERS[$name]['label'], 'configured' => $name === 'pollinations' || $k['key'] !== '', 'source' => $k['source'], 'cooling' => $this->cooling($name)];
        }

        return $out;
    }

    /** Write-only: a string stores/replaces a key, an empty string removes it, undefined leaves it alone. */
    public function setKeys(mixed $input): array
    {
        if (! ($input instanceof \stdClass)) {
            throw fail(400, 'INVALID_KEYS');
        }
        $current = $this->stored();
        foreach (['gemini', 'groq', 'openrouter'] as $name) {
            if (! property_exists($input, $name)) {
                continue;
            }
            $value = $input->{$name};
            if (! is_string($value)) {
                throw fail(400, 'INVALID_KEY');
            }
            $t = \App\Support\Str::jsTrim($value);
            if ($t === '') {
                unset($current[$name]);
            } elseif (! preg_match(self::KEY_RE, $t)) {
                throw fail(400, 'INVALID_KEY');
            } else {
                $current[$name] = $t;
            }
            Cache::forget("chat:cool:$name");
        }
        $this->settings->putSecret('chat_keys', (object) $current);

        return $this->status();
    }

    private function ask(string $name, string $key, string $model, array $messages, int $ms): string
    {
        $extra = $name === 'groq' && str_starts_with($model, 'openai/gpt-oss') ? ['reasoning_effort' => 'low', 'include_reasoning' => false] : [];
        $headers = $name === 'openrouter' ? ['HTTP-Referer' => 'https://dwira.app', 'X-Title' => 'Dwira'] : [];
        $req = Http::timeout(max(1, (int) ceil($ms / 1000)))->withHeaders($headers)->acceptJson();
        if ($key !== '') {
            $req = $req->withToken($key);
        }
        $res = $req->post(self::PROVIDERS[$name]['url'], ['model' => $model, 'messages' => $messages, 'temperature' => 0.8, 'max_tokens' => 1024] + $extra);
        if (! $res->successful()) {
            throw new PushFailure($res->status(), "$name {$res->status()}");
        }
        $text = self::clean($res->json('choices.0.message.content'));
        if ($text === '') {
            throw new \RuntimeException("$name empty");
        }

        return $text;
    }

    /**
     * @param  mixed  $history  [{ role: user|assistant|admin, text, image? }]
     * @return array{text:string,provider:string,model:string,language:string}
     */
    public function reply(mixed $history, \stdClass $config, int $budgetMs = 24000, ?string $only = null): array
    {
        $turns = [];
        foreach (is_array($history) ? $history : [] as $m) {
            if (! ($m instanceof \stdClass) || ! isset($m->text) || ! is_string($m->text) || ! in_array($m->role ?? null, ['user', 'assistant', 'admin'], true)) {
                continue;
            }
            $has = trim($m->text) !== '' || ! empty($m->image);
            if (! $has) {
                continue;
            }
            $t = \App\Support\Str::jsTrim($m->text);
            $turns[] = ['role' => $m->role === 'user' ? 'user' : 'assistant', 'content' => mb_substr($t, 0, 2000).(! empty($m->image) ? ($t !== '' ? "\n" : '').'[photo attached]' : '')];
        }
        $turns = array_slice($turns, -14);
        if (! $turns || end($turns)['role'] !== 'user') {
            throw fail(400, 'INVALID_MESSAGES');
        }
        $lastUser = null;
        foreach (array_reverse($turns) as $t) {
            if ($t['role'] === 'user') {
                $lastUser = $t['content'];
                break;
            }
        }
        $language = self::detectLanguage($lastUser);
        while (count($turns) > 1 && $turns[0]['role'] !== 'user') {
            array_shift($turns);
        }
        $messages = [['role' => 'system', 'content' => self::systemPrompt($config, $language)], ...$turns];
        $configured = array_values(array_filter(array_map('trim', explode(',', (string) config('dwira.chat.order'))), fn ($v) => isset(self::PROVIDERS[$v])));
        $order = array_values(array_unique($only ? [$only] : [...$configured, ...self::DEFAULT_ORDER]));
        $deadline = now_ms() + $budgetMs;
        foreach ($order as $name) {
            $key = $this->keyOf($name)['key'];
            if (self::PROVIDERS[$name]['cfg'] && $key === '') {
                continue;
            }
            if (! $only && $this->cooling($name)) {
                continue;
            }
            foreach ($this->models($name) as $model) {
                $left = $deadline - now_ms();
                if ($left < 1500) {
                    break;
                }
                try {
                    $text = $this->ask($name, $key, $model, $messages, min($name === 'pollinations' ? 12000 : 10000, $left));
                    Cache::forget("chat:cool:$name");

                    return ['text' => $text, 'provider' => $name, 'model' => $model, 'language' => $language];
                } catch (\Throwable $e) {
                    $status = $e instanceof PushFailure ? $e->statusCode : 0;
                    if ($status === 404 || $status === 400) {
                        continue;
                    }
                    Cache::put("chat:cool:$name", time() + ($status === 429 ? 60 : ($status === 401 || $status === 403 ? 300 : 20)), 600);
                    break;
                }
            }
        }
        throw fail(503, 'NO_PROVIDER');
    }
}
