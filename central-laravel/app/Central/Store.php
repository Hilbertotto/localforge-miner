<?php

namespace App\Central;

use Illuminate\Support\Facades\DB;

final class Store
{
    private function query(string $kind)
    {
        return DB::table('central_records')->where('kind', $kind);
    }

    public function get(string $kind, string $id): ?array
    {
        $value = $this->query($kind)->where('id', $id)->value('payload');
        return $value === null ? null : json_decode($value, true, 512, JSON_THROW_ON_ERROR);
    }

    public function all(string $kind, ?string $scope = null): array
    {
        $query = $this->query($kind);
        if ($scope !== null) $query->where('scope', $scope);
        return $query->pluck('payload')->map(fn ($v) => json_decode($v, true, 512, JSON_THROW_ON_ERROR))->all();
    }

    public function put(string $kind, string $id, array $payload, string $scope = ''): void
    {
        DB::table('central_records')->upsert([
            ['kind' => $kind, 'id' => $id, 'scope' => $scope, 'payload' => json_encode($payload, JSON_THROW_ON_ERROR)],
        ], ['kind', 'id'], ['scope', 'payload']);
    }

    public function hasAny(string $kind): bool
    {
        return $this->query($kind)->exists();
    }

    public function remove(string $kind, string $id): void
    {
        $this->query($kind)->where('id', $id)->delete();
    }

    public function mutate(callable $action): mixed
    {
        return DB::transaction(function () use ($action) {
            DB::table('central_mutex')->where('id', 1)->increment('revision');
            return $action();
        }, 3);
    }
}
