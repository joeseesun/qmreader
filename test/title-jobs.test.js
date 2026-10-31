const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTitleJobs}=require('../lib/title-jobs');
test('refresh returns immediately, coalesces missing IDs and exposes translations after completion',async()=>{
 const entries=new Map([['a',{id:'a',title:'Original title',titleZh:null}],['b',{id:'b',title:'Cached title',titleZh:'缓存译名'}]]);
 const callbacks=[],batches=[]; let release;
 const jobs=createTitleJobs({read:ids=>ids.map(id=>entries.get(id)).filter(Boolean),eligible:()=>true,schedule:fn=>callbacks.push(fn),translate:async batch=>{batches.push(batch);await new Promise(r=>release=r);entries.get('a').titleZh='中文译名';}});
 assert.equal(jobs(['a','a','b','unknown'],true).pending,true);
 callbacks.shift()();await Promise.resolve();
 jobs(['a'],true);assert.equal(batches.length,1);assert.equal(batches[0].length,1);
 release();await new Promise(r=>setImmediate(r));
 assert.equal(jobs(['a']).titles[0].titleZh,'中文译名');assert.equal(jobs(['a']).pending,false);
});
test('failed translation does not loop or enqueue the same title on repeated refreshes',async()=>{
 const callbacks=[];let count=0;
 const jobs=createTitleJobs({read:()=>[{id:'a',title:'Failed title'}],eligible:()=>true,schedule:fn=>callbacks.push(fn),translate:async()=>{count++;throw Object.assign(Error('budget'),{code:'AI_DAILY_BUDGET'});}});
 jobs(['a'],true);callbacks.shift()();await new Promise(r=>setImmediate(r));
 assert.equal(jobs(['a'],true).pending,false);assert.equal(callbacks.length,0);assert.equal(count,1);
});
