<?php

namespace App\Central;

use Illuminate\Support\Facades\Hash;

final class LegacyPassword
{
    public static function matches(string $password,array $record):bool
    {
        if(!isset($record['salt']))return Hash::check($password,$record['hash']);
        $salt=$record['salt'];
        if(!is_string($salt)||!preg_match('/^[a-f0-9]{32}$/D',$salt)||!preg_match('/^[a-f0-9]{64}$/D',$record['hash']))return false;
        if(!function_exists('sodium_crypto_pwhash_scryptsalsa208sha256'))return false;
        // Node's default scrypt parameters: N=16384, r=8, p=1; the salt is the ASCII hex string.
        $derived=sodium_crypto_pwhash_scryptsalsa208sha256(32,$password,$salt,524288,16777216);
        return hash_equals($record['hash'],bin2hex($derived));
    }
}
