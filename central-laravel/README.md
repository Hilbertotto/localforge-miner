# LocalForge Central — Laravel test deployment

The central HTTP service runs in Laravel/PHP. It does not forward requests to the Node.js central backend. The existing Central and worker browser assets are copied at build time; Node is needed only for asset synchronization and the HTTP smoke test. Do not point production workers here yet.

## Local setup

From this directory:

1. Run `composer install` and create `.env` from `.env.example` if it does not exist.
2. Run `php artisan key:generate` on the first setup only. Keep this key with the database: it protects saved credentials and backups.
3. Create an empty `database/database.sqlite` and run `php artisan migrate --force`.
4. Run `node sync-assets.mjs` if the shared web assets have changed.
5. On Windows with XAMPP, run `./start-test.ps1`. The URL is `http://127.0.0.1:8091/`. The isolated Apache instance accepts concurrent browser and worker requests. PHP's single-threaded development server on Windows cannot serve a worker poll while a browser command is waiting.
6. Register with a test address and open the confirmation link shown in the local test UI. For an administrator, run `php artisan localforge:admin` and enter a fresh test password when prompted.

`node smoke-test.mjs` exercises registration, verification, farm library, worker credentials, polling, telemetry, command delivery, and removal on the local instance. It creates test records; use it only with test data.

## Deployment boundary

The local test does not import the running Node service's accounts, credentials, farms, or historical records. Use the import command below to rehearse migration against a copy of the current data before any cutover. For a hosted instance, configure a persistent database, an application key, a distinct session cookie, HTTPS-only session cookies, and real SMTP if registration is enabled. Keep local test mail disabled. Worker command requests and polling must share the same database and have concurrent HTTP workers.

The public DNS and existing Volumora application are outside this local test deployment.

## Rehearse a legacy import

1. Take a consistent copy of the Node Central data directory, including its vault key. Keep the copy private.
2. Point Laravel at a new, empty database (never the running local test or production database), then run the migrations.
3. With PHP sodium enabled, run `php artisan localforge:import-legacy <snapshot-directory>`. The import is transactional and refuses a nonempty Central database.
4. Imported Node scrypt passwords remain usable when sodium is loaded in the web runtime. Successful logins upgrade compatible hashes to Laravel's native password hashing.
5. Verify the imported records and rehearse with a separate worker before changing any live URLs. Direct agent URLs must be listed in LOCALFORGE_DIRECT_AGENTS before Laravel will contact them.