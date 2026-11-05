/* Run the shared miner UI inside the authenticated central worker view. */
(()=>{
 const prefix=location.pathname.replace(/\/?$/,'/'),originalFetch=window.fetch.bind(window);
 window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin!==location.origin)return originalFetch(input,options);
  if(url.pathname.startsWith('/api/')||['/miner-catalog.json','/algorithm-catalog.json','/pool-catalog.json','/pool-endpoints.json'].includes(url.pathname))url.pathname=prefix+url.pathname.slice(1);
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
  if(headers.has('X-Local-Token'))headers.set('X-CSRF-Token',headers.get('X-Local-Token'));
  return originalFetch(url,{...options,headers,credentials:'same-origin'});
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const connection=document.querySelector('#central-open');if(connection){connection.disabled=true;connection.title='A munkást a központi szerveren nézed.';}
  const badge=document.querySelector('.lf-local-badge');if(badge)badge.textContent='● KÖZPONTI VEZÉRLÉS';
 });
})();
