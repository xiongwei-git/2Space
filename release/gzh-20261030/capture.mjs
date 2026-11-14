import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID,createCipheriv} from 'node:crypto';
import {chromium} from 'playwright';
const dir=resolve('release/gzh-20261030'), temp=await mkdtemp(join(tmpdir(),'2space-publish-'));
process.env.DB_PATH=join(temp,'synthetic.sqlite');process.env.WEB_DIST=resolve('apps/web/dist');
const {buildApp}=await import('../../apps/server/dist/app.js'); const app=await buildApp();
const base=await app.listen({host:'127.0.0.1',port:0});const key=randomBytes(32),token=randomBytes(32).toString('base64url');
function payload(title,html,text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return {iv:iv.toString('base64url'),ciphertext:Buffer.concat([c.update(JSON.stringify({title,html,text:html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),language:'plaintext'})),c.final(),c.getAuthTag()]).toString('base64url')};}
async function api(path,body){const r=await fetch(base+'/api'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});if(!r.ok)throw new Error('API '+r.status);return r.json();}
let browser;
try{
const rich='<h2>周末去散步</h2><p>周五下班后出发，轻装上路。</p><ul><li><p><strong>随身带好</strong>：水杯、耳机、充电宝</p></li><li><p>先去江边散步，再找一家小店吃晚饭</p></li><li><p>把好看的街角记下来，回来慢慢整理</p></li></ul><blockquote><p>不用安排太满，留一点时间给偶遇。</p></blockquote>';
const space=await api('/spaces',{accessMode:'public',name:'weekend-demo',publicKey:key.toString('base64url'),ownerToken:token,retentionSeconds:0,page:{id:randomUUID(),payload:payload('出行清单',rich,'周末去散步')}});
await api('/spaces/'+space.id+'/pages',{id:randomUUID(),payload:payload('会议要点','<h2>把下一步写清楚</h2><p><strong>今天确定</strong>：先整理需求，再约时间讨论。</p><ul><li><p>补齐三个典型使用场景</p></li><li><p>周三前发出第一版提纲</p></li></ul>','把下一步写清楚')});
await api('/spaces/'+space.id+'/pages',{id:randomUUID(),payload:payload('代码片段','<p>换台电脑，继续这段小工具。</p><pre><code class="language-javascript">function makeNote(title) {\n  return {\n    title: title.trim(),\n    done: false,\n  };\n}\n\nconsole.log(makeNote("周末清单"));</code></pre><p>选好语言，保留缩进，直接复制原文。</p>','代码示例')});
browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
await page.goto(base);await page.locator('.hero-layout').waitFor();await page.locator('.hero-layout').screenshot({path:join(dir,'images/01-home.png')});
await page.goto(base+'/weekend-demo');await page.locator('.tiptap').waitFor();const close=page.getByRole('button',{name:'关闭提示',exact:true});if(await close.count())await close.click();
await page.locator('.editor-panel').count().then(async n=>{if(!n)console.log('SECTIONS',await page.locator('.tiptap').evaluate(e=>e.parentElement.parentElement.className))});
const editor=page.locator('.tiptap').locator('xpath=ancestor::section[1]');
await editor.screenshot({path:join(dir,'images/02-notebooks.png')});
await page.getByRole('tab',{name:/代码片段/}).click();await page.locator('.code-block-view').waitFor();await editor.screenshot({path:join(dir,'images/03-code.png')});
await page.setViewportSize({width:390,height:900});await page.getByRole('tab',{name:/出行清单/}).click();await editor.screenshot({path:join(dir,'images/04-mobile.png')});
await writeFile(join(dir,'checks/capture.json'),JSON.stringify({source:'current local built app; isolated temporary database',synthetic:true,productionDataAccess:false,images:4,headlessBrowser:'Chromium',capturedAt:new Date().toISOString()},null,2));
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
