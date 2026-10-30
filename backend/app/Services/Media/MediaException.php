<?php

namespace App\Services\Media;

use RuntimeException;

/** `policy` = the input itself is unacceptable (retrying will not help); false = transient (timeout, network, 5xx). */
class MediaException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, public readonly bool $policy = true)
    {
        parent::__construct($errorCode);
    }
}
