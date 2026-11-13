const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(__dirname + '/../content.js', 'utf8');
async function fixture(options = {}) {
 const timers = new Map(), saved = new Map(), calls = [];
 let index = 0, status, onChange;
 const end = new Date(Date.now() + 3600000).toISOString();
 const challenges = [{ id:'daily', recurrence:'daily', status:'claimable', window:{ends_at:end}}, {id:'event', featured:true, status:'claimable',window:{ends_at:end}}];
 const campaigns = [{id:'campaign',status:'active',progress_units:10,rewards:[{id:'earned',claimed:false,required_units:10},{id:'locked',claimed:false,required_units:20}]}];
 const context = { console, crypto:webcrypto, TextEncoder, AbortController, Date, Math,
 document:{cookie:options.signedOut ? '' : 'session_token=test-token', readyState:'complete', visibilityState:'visible',addEventListener(){}},
 window:{addEventListener(){}}, navigator:{locks:{request: async (key,opts,fn)=>fn(options.locked ? null : {})}},
 localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
 setTimeout:(fn,ms)=>{timers.set(++index,{fn,ms});return index},clearTimeout:id=>timers.delete(id),
 chrome:{storage:{local:{get:async()=>({settings:options.settings})},onChanged:{addListener:fn=>onChange=fn}},runtime:{onMessage:{addListener:fn=>status=fn}}},
 fetch:async(url,init)=>{calls.push({url,init}); if(init.method==='POST') {const ch=challenges.find(c=>url.includes('/'+c.id+'/claim'));if(ch)ch.status='claimed';} return {ok:true,status:200,headers:{get:()=>null},json:async()=>({data:url.endsWith('/drops/progress')?campaigns:challenges})};}
 };
 vm.runInNewContext(source,context);
 const flush=()=>new Promise(r=>setTimeout(r,20)); await flush();
 async function cycle(){const queue=[...timers.entries()];timers.clear();for(const [,t] of queue){t.fn();await flush();}}
 return {calls,saved,timers,cycle,onChange,getStatus:()=>{let s;status({type:'status'}, {},x=>s=x);return s}};
}
(async()=>{
 let f=await fixture();await f.cycle();
 assert.equal(f.calls.filter(c=>c.init.method==='POST').length,3,'claims daily, event and earned drop');
 assert(!f.calls.some(c=>c.init.body?.includes('locked')),'does not claim unearned drop');
 assert(!JSON.stringify([...f.saved]).includes('test-token'),'never persists raw token');
 assert(!JSON.stringify(f.getStatus()).includes('test-token'),'never exposes token in popup');
 assert.equal(f.getStatus().daily.claimed,true);
 f.onChange({settings:{newValue:{enabled:false,daily:true,events:true,drops:true}}},'local');
 assert.equal(f.timers.size,0,'pause cancels future checks');
 f=await fixture({signedOut:true});await f.cycle();assert.equal(f.calls.length,0,'signed out performs no requests');
 f=await fixture({settings:{enabled:false}});assert.equal(f.timers.size,0,'disabled startup schedules no requests');
 f=await fixture({settings:{daily:false,events:false,drops:true}});await f.cycle();assert(f.calls.every(c=>c.url.includes('/drops/')),'feature settings respected');
 f=await fixture({locked:true});await f.cycle();assert.equal(f.calls.length,0,'another tab holding lock prevents requests');
 console.log('PASS: eligible claims, unearned exclusion, token privacy, pause, signed-out mode, disabled startup, individual controls, multi-tab lock.');
})().catch(e=>{console.error(e);process.exitCode=1});
