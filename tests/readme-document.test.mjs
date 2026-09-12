import test from 'node:test';
import assert from 'node:assert/strict';
import { readmeDocument, readmeBlocks, readmeLink } from '../public/city/readme-document.js';
test('README reader retains structured prose, lists, tables and literal code', () => {
 const blocks=readmeBlocks('# Setup\n\nUse **npm**.\n\n- Install\n- Run\n\n```html\n<script>alert(1)</script>\n```\n\n| Flag | Value |\n| --- | --- |\n| mode | dev |');
 assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','item','item','code','table']);
 assert.equal(blocks[4].text,'<script>alert(1)</script>');
 assert.deepEqual(blocks[5].rows[1],['mode','dev']);
});
test('README links resolve relative paths and reject active URL schemes',()=> {
 const repo={full_name:'owner/project'};
 assert.equal(readmeLink('./docs/setup.md',repo),'https://github.com/owner/project/blob/HEAD/docs/setup.md');
 for (const url of ['javascript:alert(1)','data:text/html,test','http://example.com']) assert.equal(readmeLink(url,repo),null);
});
test('README download tries filename casing, caches success and retries failure',async()=> {
 const original=globalThis.fetch;let calls=0;
 try {
  globalThis.fetch=async()=>{calls++;return new Response(calls===1?'':'# Project',{status:calls===1?404:200});};
  const repo={full_name:'test/casing'};
  assert.equal((await readmeDocument(repo)).status,'ready');
  assert.equal((await readmeDocument(repo)).markdown,'# Project');assert.equal(calls,2);
  globalThis.fetch=async()=>{throw new Error('offline');};
  assert.equal((await readmeDocument({full_name:'test/retry'})).status,'error');
  globalThis.fetch=async()=>new Response('Recovered');
  assert.equal((await readmeDocument({full_name:'test/retry'})).markdown,'Recovered');
  globalThis.fetch=async()=>new Response('',{status:404});
  assert.equal((await readmeDocument({full_name:'test/missing'})).status,'missing');
 } finally {globalThis.fetch=original;}
});
