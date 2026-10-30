<?php

namespace App\Services;

use App\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/** Automatic fr/ar/dar translation of admin content through free keyless providers (port of server/translate.js). */
class Translate
{
    public const LANGS = ['fr', 'ar', 'dar'];

    private const NAMES = [
        'fr' => 'French',
        'ar' => 'Modern Standard Arabic (Arabic script)',
        'dar' => 'Moroccan Darija: the spoken Moroccan Arabic dialect, written in Arabic script the way Moroccans actually say it (not formal Modern Standard Arabic; keep common French loanwords Moroccans use, e.g. salon, cuisine)',
    ];

    private static function count(string $s, string $re): int
    {
        return (int) preg_match_all($re, $s);
    }

    private static function letters(string $s): bool
    {
        return self::count($s, '/[\x{0600}-\x{06FF}\x{0750}-\x{077F}]/u') + self::count($s, '/[A-Za-z\x{00C0}-\x{024F}]/u') > 0;
    }

    public static function plausible(string $lang, string $source, mixed $out): bool
    {
        if (! is_string($out) || trim($out) === '') {
            return false;
        }
        if (! self::letters($source)) {
            return true;
        }
        $ar = self::count($out, '/[\x{0600}-\x{06FF}\x{0750}-\x{077F}]/u');
        $la = self::count($out, '/[A-Za-z\x{00C0}-\x{024F}]/u');

        return $lang === 'fr' ? $la > $ar : $ar > $la;
    }

    /** @return array{from:string,to:list<string>,texts:list<string>} */
    public static function clean(mixed $input): array
    {
        $bad = fn (string $m) => fail(400, $m);
        if (! ($input instanceof \stdClass)) {
            throw $bad('Invalid request');
        }
        $from = $input->from ?? null;
        if (! in_array($from, self::LANGS, true)) {
            throw $bad('Invalid source language');
        }
        $texts = $input->texts ?? null;
        if (! is_array($texts) || ! count($texts) || count($texts) > 60) {
            throw $bad('Invalid texts');
        }
        $total = 0;
        foreach ($texts as $t) {
            if (! is_string($t) || Str::jsTrim($t) === '' || Str::jsLength($t) > 1500) {
                throw $bad('Invalid texts');
            }
            $total += Str::jsLength($t);
        }
        if ($total > 12000) {
            throw $bad('Texts too long');
        }
        $want = isset($input->to) && is_array($input->to) ? $input->to : array_values(array_filter(self::LANGS, fn ($l) => $l !== $from));
        $to = [];
        foreach ($want as $l) {
            if (in_array($l, self::LANGS, true) && $l !== $from && ! in_array($l, $to, true)) {
                $to[] = $l;
            }
        }
        if (! $to) {
            throw $bad('Nothing to translate');
        }

        return ['from' => $from, 'to' => $to, 'texts' => array_map([Str::class, 'jsTrim'], $texts)];
    }

    private function viaPollinations(string $from, array $to, array $texts, int $ms): array
    {
        $wanted = implode('; ', array_map(fn ($l) => "\"$l\" = ".self::NAMES[$l], $to));
        $shape = implode(',', array_map(fn ($l) => "\"$l\":[\"...\"]", $to));
        $res = Http::timeout(max(1, (int) ceil($ms / 1000)))->post('https://text.pollinations.ai/openai', [
            'model' => 'openai-fast', 'temperature' => 0.2, 'reasoning_effort' => 'low',
            'messages' => [
                ['role' => 'system', 'content' => 'You are a professional translator for an interior-design app used in Morocco. Translate short UI labels and descriptions faithfully and naturally. Keep numbers, brand names and line breaks. Reply with ONLY a JSON object, no markdown, no explanation.'],
                ['role' => 'user', 'content' => "Source language: $from = ".self::NAMES[$from].".\nTranslate every text of the \"texts\" array into each of these target languages: $wanted.\nReturn exactly this JSON shape: {{$shape}} where each array has the same length and order as \"texts\".\n\n".json_encode(['texts' => $texts], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)],
            ],
        ]);
        if (! $res->successful()) {
            throw new \RuntimeException('pollinations '.$res->status());
        }
        $content = (string) $res->json('choices.0.message.content');
        if (! preg_match('/\{[\s\S]*\}/', $content, $m)) {
            throw new \RuntimeException('pollinations empty');
        }
        $parsed = json_decode($m[0], true, 512, JSON_THROW_ON_ERROR);
        $result = [];
        foreach ($to as $lang) {
            $list = $parsed[$lang] ?? null;
            if (! is_array($list) || count($list) !== count($texts) || ! array_is_list($list)) {
                continue;
            }
            $ok = true;
            foreach ($list as $i => $out) {
                if (! self::plausible($lang, $texts[$i], $out)) {
                    $ok = false;
                    break;
                }
            }
            if ($ok) {
                $result[$lang] = array_map('trim', $list);
            }
        }

        return $result;
    }

    /** MyMemory takes at most ~500 characters per request: long texts are cut at line / sentence ends. */
    public static function pieces(string $text, int $size = 450): array
    {
        $out = [];
        foreach (explode("\n", $text) as $line) {
            $rest = $line;
            while (mb_strlen($rest) > $size) {
                $cut = max(self::lastIdx($rest, '. ', $size), self::lastIdx($rest, '، ', $size), self::lastIdx($rest, ', ', $size), self::lastIdx($rest, ' ', $size));
                if ($cut < $size / 3) {
                    $cut = $size;
                }
                $out[] = mb_substr($rest, 0, $cut + 1);
                $rest = mb_substr($rest, $cut + 1);
            }
            $out[] = $rest;
        }

        return $out;
    }

    private static function lastIdx(string $s, string $needle, int $from): int
    {
        $head = mb_substr($s, 0, $from + mb_strlen($needle));
        $p = mb_strrpos($head, $needle);

        return $p === false ? -1 : $p;
    }

    private function myMemory(string $pair, string $text, int $ms): string
    {
        if (trim($text) === '') {
            return $text;
        }
        $res = Http::timeout(max(1, (int) ceil($ms / 1000)))->get('https://api.mymemory.translated.net/get', ['q' => $text, 'langpair' => $pair]);
        if (! $res->successful()) {
            throw new \RuntimeException('mymemory '.$res->status());
        }
        $out = $res->json('responseData.translatedText');
        if (! is_string($out) || $out === '' || preg_match('/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i', $out) || $res->json('quotaFinished')) {
            throw new \RuntimeException('mymemory unusable');
        }

        return str_replace(['&#39;', '&quot;', '&amp;', '&lt;', '&gt;'], ["'", '"', '&', '<', '>'], $out);
    }

    private function viaMyMemory(string $from, string $lang, array $texts, int $ms): array
    {
        $code = fn (string $l) => $l === 'dar' ? 'ar' : $l;
        if ($code($from) === $code($lang)) {
            return $texts;
        }
        $pair = $code($from).'|'.$code($lang);
        $out = [];
        foreach ($texts as $text) {
            $parts = [];
            foreach (self::pieces($text) as $piece) {
                $parts[] = trim($piece) !== '' ? $this->myMemory($pair, $piece, $ms) : $piece;
            }
            $out[] = trim(preg_replace('/ ?\n ?/', "\n", implode(' ', $parts)));
        }
        foreach ($out as $i => $v) {
            if (! self::plausible($lang, $texts[$i], $v)) {
                throw new \RuntimeException('mymemory wrong script');
            }
        }

        return $out;
    }

    /** @return array{translations:\stdClass,provider:\stdClass} */
    public function translate(mixed $input, int $llmMs = 14000, int $mtMs = 6000): array
    {
        ['from' => $from, 'to' => $to, 'texts' => $texts] = self::clean($input);
        $translations = new \stdClass;
        $provider = new \stdClass;
        $key = fn (string $lang, string $text) => 'tr:'.md5("$from>$lang:$text");
        $pending = [];
        foreach ($to as $lang) {
            $pending[$lang] = array_map(fn ($t) => Cache::get($key($lang, $t)), $texts);
        }
        $missing = fn (string $lang) => in_array(null, $pending[$lang], true);
        $store = function (string $lang, array $list, string $name) use (&$pending, $texts, $key, $provider) {
            foreach ($list as $i => $out) {
                Cache::put($key($lang, $texts[$i]), $out, 86400);
                $pending[$lang][$i] = $out;
            }
            $provider->{$lang} ??= $name;
        };
        $ask = array_values(array_filter($to, $missing));
        if ($ask) {
            try {
                $result = $this->viaPollinations($from, $ask, $texts, $llmMs);
                foreach ($ask as $lang) {
                    if (isset($result[$lang])) {
                        $store($lang, $result[$lang], 'pollinations');
                    }
                }
            } catch (\Throwable) {
                // falls through to the machine-translation fallback below
            }
        }
        foreach (array_filter($to, $missing) as $lang) {
            try {
                $list = $this->viaMyMemory($from, $lang, $texts, $mtMs);
                $store($lang, $list, ($from === 'dar' && $lang === 'ar') || ($from === 'ar' && $lang === 'dar') ? 'copy' : 'mymemory');
            } catch (\Throwable) {
                // this language stays empty
            }
        }
        foreach ($to as $lang) {
            if (! $missing($lang)) {
                $translations->{$lang} = $pending[$lang];
            }
        }

        return ['translations' => $translations, 'provider' => $provider];
    }
}
