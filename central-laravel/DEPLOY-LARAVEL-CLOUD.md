# Deploy LocalForge Central to Laravel Cloud

Create a separate application for LocalForge. Leave the Volumora application and its existing domains in place.

- Source directory: central-laravel. Publish the application source and bundled assets to the connected Git repository first. Exclude local environment files, SQLite databases, test credentials, logs, and legacy snapshots.
- Build command: composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
- Deploy command: php artisan migrate --force
- Health endpoint: /up
- Attach a dedicated PostgreSQL or MySQL database. Use database-backed sessions and cache for the first deployment.
- Environment: APP_ENV=production, APP_DEBUG=false, SESSION_DRIVER=database, CACHE_STORE=database, SESSION_SECURE_COOKIE=true, SESSION_SAME_SITE=strict, LOCALFORGE_LOCAL_MAIL=false, LOCALFORGE_REGISTRATION=false. Keep the generated APP_KEY stable across deploys.
- Enable registration only after configuring a real mail transport. Set APP_URL to the actual HTTPS environment URL.
- Use an environment with concurrent HTTP requests for command delivery and worker polling. Keep it awake during verification.
- First validate on the assigned laravel.cloud address with a fresh account and a test worker. Check login, state updates, telemetry, and a harmless read-only command before connecting the production domain.
- If you need to carry forward the old accounts and records, rehearse the legacy import into a separate empty database first. The web runtime needs PHP sodium for imported legacy passwords.
- Once verified, add miner.volumora.com to this application's Domains and add only the records shown by Laravel Cloud to the Cloudflare DNS zone. Keep the apex and www records intact. Verify TLS and update APP_URL before switching workers.

Official guides:
- https://laravel.com/cloud/docs/monorepos
- https://laravel.com/cloud/deploy-a-laravel-app
- https://laravel.com/cloud/docs/domains
