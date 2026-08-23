import test from 'node:test';import assert from 'node:assert/strict';
function blocked(ip){const p=ip.split('.').map(Number),[a,b]=p;return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)}
test('private IPv4 ranges are rejected by policy model',()=>{for(const ip of ['127.0.0.1','10.2.3.4','172.16.0.1','192.168.1.1','169.254.169.254'])assert.equal(blocked(ip),true);assert.equal(blocked('8.8.8.8'),false)});
