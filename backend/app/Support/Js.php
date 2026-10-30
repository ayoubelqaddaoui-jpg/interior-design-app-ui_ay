<?php

namespace App\Support;

/** Small JavaScript-semantics helpers (truthiness, string coercion, conversation merge) used by the controllers. */
final class Js
{
    public static function truthy(mixed $v): bool
    {
        if ($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0) {
            return false;
        }
        if (is_float($v) && is_nan($v)) {
            return false;
        }

        return true;
    }

    public static function prop(mixed $o, string $k): mixed
    {
        return $o instanceof \stdClass ? ($o->{$k} ?? null) : null;
    }

    /** Messages of a conversation as a list of stdClass (anything else is ignored). */
    private static function messages(mixed $c): array
    {
        $m = self::prop($c, 'messages');

        return is_array($m) ? $m : [];
    }

    /**
     * Validates a conversation write (shared by signed-in clients and visitors): shape, size, and who may write which role.
     * Admin answers belong to the server: a client can neither forge nor erase them. Mutates `$value->messages`; returns the
     * user messages that are new (they notify the admins).
     *
     * @return list<\stdClass>
     */
    public static function mergeConversation(\stdClass $value, ?\stdClass $existing): array
    {
        if (! isset($value->messages) || ! is_array($value->messages) || count($value->messages) > 1000 || ! isset($value->title) || ! is_string($value->title)) {
            throw fail(400, 'INVALID_CONVERSATION');
        }
        $known = [];
        foreach (self::messages($existing) as $m) {
            if ($m instanceof \stdClass && isset($m->id) && is_string($m->id)) {
                $known[$m->id] = true;
            }
        }
        $sent = [];
        foreach ($value->messages as $m) {
            if ($m instanceof \stdClass && isset($m->id, $m->text, $m->role) && is_string($m->id) && is_string($m->text) && Str::jsLength($m->text) <= 4000 && in_array($m->role, ['user', 'assistant'], true)) {
                $sent[] = $m;
            }
        }
        $kept = array_values(array_filter(self::messages($existing), fn ($m) => $m instanceof \stdClass && ($m->role ?? null) === 'admin'));
        $all = [...$sent, ...$kept];
        usort($all, fn ($a, $b) => \App\Services\Clients::num($a->createdAt ?? 0) <=> \App\Services\Clients::num($b->createdAt ?? 0));
        $value->messages = $all;

        return array_values(array_filter($sent, fn ($m) => $m->role === 'user' && ! isset($known[$m->id])));
    }
}
