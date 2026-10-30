<?php

namespace App\Services;

/** A delivery failure carrying the push service's HTTP status (410/404 = expired device) or an FCM error code. */
class PushFailure extends \RuntimeException
{
    public function __construct(public int $statusCode, public ?string $errorCode = null)
    {
        parent::__construct('Push failed');
    }
}
