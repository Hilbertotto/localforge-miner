<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('central_records', function (Blueprint $table) {
            $table->string('kind', 32);
            $table->string('id', 128);
            $table->string('scope', 80)->default('');
            $table->longText('payload');
            $table->primary(['kind', 'id']);
            $table->index(['kind', 'scope']);
        });
        Schema::create('central_mutex', function (Blueprint $table) {
            $table->integer('id')->primary();
            $table->integer('revision')->default(0);
        });
        \Illuminate\Support\Facades\DB::table('central_mutex')->insert(['id' => 1, 'revision' => 0]);
    }

    public function down(): void
    {
        Schema::dropIfExists('central_records');
        Schema::dropIfExists('central_mutex');
    }
};
