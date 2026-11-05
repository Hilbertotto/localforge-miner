<?php

return [
    'local_mail' => env('LOCALFORGE_LOCAL_MAIL', false),
    'registration' => env('LOCALFORGE_REGISTRATION', false),
    'admin_password' => env('LOCALFORGE_ADMIN_PASSWORD'),
    'direct_agents' => env('LOCALFORGE_DIRECT_AGENTS', ''),
];
