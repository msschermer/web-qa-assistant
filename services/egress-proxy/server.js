import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import dns from 'node:dns/promises'; import { isIP } from 'node:net';
const port=Number(process.env.PROXY_PORT||8899);
function blockedIp(ip){
  if(!isIP(ip))return true;
  if(ip.includes(':')){const s=ip.toLowerCase();return s==='::1'||s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe8')||s.startsWith('fe9')||s.startsWith('fea')||s.startsWith('feb')||s.startsWith('::ffff:127.')||s.startsWith('::ffff:10.')||s.startsWith('::ffff:192.168.');}
  const p=ip.split('.').map(Number),[a,b]=p;
  return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19));
}
async function resolvePublic(host){
  const lower=host.toLowerCase().replace(/\.$/,''); if(['localhost','localhost.localdomain'].includes(lower)||lower.endsWith('.local')||lower.endsWith('.internal'))throw new Error('blocked host');
  if(isIP(lower)){if(blockedIp(lower))throw new Error('blocked address');return lower}
  const answers=await dns.lookup(lower,{all:true,verbatim:true}); if(!answers.length)throw new Error('no address'); if(answers.some(a=>blockedIp(a.address)))throw new Error('blocked address'); return answers[0].address;
}
const server=http.createServer(async(req,res)=>{
  try{
    const target=new URL(req.url); if(!['http:','https:'].includes(target.protocol))throw new Error('scheme'); const ip=await resolvePublic(target.hostname); const lib=target.protocol==='https:'?https:http;
    const up=lib.request({protocol:target.protocol,hostname:ip,port:target.port||undefined,path:target.pathname+target.search,method:req.method,headers:{...req.headers,host:target.host},servername:target.hostname,rejectUnauthorized:true},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)}); up.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()}); req.pipe(up);
  }catch{res.writeHead(403,{'content-type':'text/plain'});res.end('Blocked by public-renderer egress policy')}
});
server.on('connect',async(req,client,head)=>{
  try{const [host,rawPort]=String(req.url).split(':');const p=Number(rawPort||443);if(![80,443].includes(p))throw new Error('port');const ip=await resolvePublic(host);const upstream=net.connect(p,ip,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream)});upstream.on('error',()=>client.destroy())}catch{client.write('HTTP/1.1 403 Forbidden\r\n\r\n');client.destroy()}
});
server.listen(port,'0.0.0.0',()=>console.log(`egress proxy listening on ${port}`));
