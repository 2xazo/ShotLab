import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333;
const profile = path.join(os.tmpdir(), `shotlab-chrome-${Date.now()}`);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(fn, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      await sleep(150);
    }
  }
}

let ws;
let nextId = 1;
const pending = new Map();
const exceptions = [];
const logs = [];

async function main() {
  const pages = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error('Chrome debugging endpoint is not ready');
    return response.json();
  });
  const page = pages.find((target) => target.type === 'page' && !target.url.startsWith('chrome-extension://'));
  if (!page) throw new Error('No browser page target found');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails?.text || 'runtime exception');
    if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') logs.push(`${message.params.entry.text} ${message.params.entry.url || ''}`);
  };

  const cmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await cmd('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    const snapshot = await evaluate(`({url:location.href,title:document.title,body:document.body&&document.body.innerText.slice(0,300)})`);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(snapshot)}; exceptions=${exceptions.join(' | ')}`);
  };
  const check = (label, condition) => {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS ${label}`);
  };
  const clickText = (text) =>
    evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`);

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Log.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'http://localhost:5173/' });
  await waitFor(`document.readyState==='complete'&&!!document.querySelector('.sl')`, 'ShotLab boot');

  const email = `showcase_ui_${Date.now()}@test.dev`;
  await evaluate(
    `fetch('http://localhost:4000/auth/signup',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Showcase UI',email:${JSON.stringify(email)},password:'secret123'})}).then(r=>{if(!r.ok)throw Error('signup '+r.status);return r.json()})`,
    true
  );
  await cmd('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState==='complete'&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Library')`, 'authenticated app');
  check('Library navigation clicked', await clickText('Library'));
  await waitFor(`document.querySelectorAll('.showcase-card').length===7`, 'seven showcase cards');

  check('all showcase cards render', (await evaluate(`document.querySelectorAll('.showcase-card').length`)) === 7);
  check('five image previews render', (await evaluate(`document.querySelectorAll('.showcase-card img').length`)) === 5);
  check('showcase uses the requested RTL visual order', await evaluate(`JSON.stringify([...document.querySelectorAll('.showcase-card h3')].map(h=>h.textContent.trim()))===JSON.stringify(['عرض بالسيارة','برج المملكه','الخزامى','صوره القمر','صوره سنمائيه','انمي','نافذه القطار'])`));
  check('train video remains the final showcase item', await evaluate(`document.querySelector('.showcase-card:last-child h3').textContent.trim()==='نافذه القطار'`));
  check('all video previews autoplay silently without controls', await evaluate(`(()=>{const videos=[...document.querySelectorAll('.showcase-card video')];return videos.length===2&&videos.every(v=>v.autoplay&&v.muted&&v.loop&&v.playsInline&&!v.controls&&v.preload==='metadata'&&getComputedStyle(v).objectFit==='cover')})()`));
  check('images are lazy and accessible', await evaluate(`([...document.querySelectorAll('.showcase-card img')].every(i=>i.loading==='lazy'&&!!i.alt))`));
  check('original template cards remain', (await evaluate(`document.querySelectorAll('.prompt-grid>div').length`)) === 28);
  await evaluate(`document.querySelector('.showcase-card video').scrollIntoView({block:'center'})`);
  await waitFor(`!document.querySelector('.showcase-card video').paused`, 'visible showcase video playback');
  await evaluate(`window.scrollTo(0,document.body.scrollHeight)`);
  await waitFor(`document.querySelector('.showcase-card video').paused`, 'offscreen showcase video pause');
  await evaluate(`document.querySelector('.showcase-card video').scrollIntoView({block:'center'})`);
  await waitFor(`!document.querySelector('.showcase-card video').paused`, 'visible showcase video resume');
  const showcaseTitles = await evaluate(`([...document.querySelectorAll('.showcase-card h3')].map(h=>h.textContent.trim()))`);
  for (const title of showcaseTitles) {
    check(`View Details opens for ${title}`, await evaluate(`(()=>{const card=[...document.querySelectorAll('.showcase-card')].find(c=>c.querySelector('h3')?.textContent.trim()===${JSON.stringify(title)});const b=card&&[...card.querySelectorAll('button')].find(x=>x.textContent.trim()==='View Details');if(!b)return false;b.click();return true})()`));
    await waitFor(`document.querySelector('#showcase-detail-title')?.textContent.trim()===${JSON.stringify(title)}`, `${title} details dialog`);
    if (title === 'عرض بالسيارة') check('car details retain video media', await evaluate(`!!document.querySelector('.showcase-dialog video')`));
    await evaluate(`document.querySelector('[data-showcase-close]').click()`);
    await waitFor(`!document.querySelector('.showcase-dialog')`, `${title} details close`);
  }

  await evaluate(`(()=>{const i=document.querySelector('input[placeholder="Search prompts…"]');i.value='نافذه القطار';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor(`document.querySelectorAll('.showcase-card').length===1`, 'showcase search result');
  check('search finds showcase prompt title', await evaluate(`document.querySelector('.showcase-card h3').textContent.includes('نافذه القطار')`));
  await evaluate(`(()=>{const i=document.querySelector('input[placeholder="Search prompts…"]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor(`document.querySelectorAll('.showcase-card').length===7`, 'search reset');

  check('details action opens dialog', await clickText('View Details'));
  await waitFor(`!!document.querySelector('.showcase-dialog')`, 'showcase details');
  const fullPrompt = await evaluate(`document.querySelector('.showcase-dialog .mono').textContent`);
  check('details preserves complete multiline prompt', fullPrompt.length > 300 && fullPrompt.includes('\n'));

  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{window.__copied=t;return Promise.resolve()}}})`);
  check('Copy Prompt action clicked', await clickText('Copy Prompt'));
  await waitFor(`window.__copied&&window.__copied.length>300`, 'clipboard copy');
  check('Copy Prompt copies complete text', (await evaluate(`window.__copied`)) === fullPrompt);

  await evaluate(`window.open=()=>({opener:null,document:{write(){},close(){}},location:{replace:u=>window.__opened=u}})`);
  for (const [platform, url] of [
    ['ChatGPT', 'https://chatgpt.com/'],
    ['Claude', 'https://claude.ai/'],
    ['Gemini', 'https://gemini.google.com/'],
  ]) {
    check(`Try with AI menu opens for ${platform}`, await clickText('Try with AI'));
    await waitFor(`!!document.querySelector('.ai-menu')`, 'AI menu');
    check(`${platform} selection clicked`, await evaluate(`(()=>{const b=[...document.querySelectorAll('.ai-menu [role="menuitem"]')].find(x=>x.textContent.includes(${JSON.stringify(platform)}));if(!b)return false;b.click();return true})()`));
    await waitFor(`window.__opened===${JSON.stringify(url)}`, `${platform} destination`);
    check(`${platform} uses official destination`, (await evaluate(`window.__opened`)) === url);
  }

  check('Customize action clicked', await evaluate(`(()=>{const b=[...document.querySelectorAll('.showcase-dialog button')].find(x=>x.textContent.trim()==='Customize');if(!b)return false;b.click();return true})()`));
  await waitFor(`!!document.querySelector('textarea')&&[...document.querySelectorAll('textarea')].some(t=>t.value.length>300)`, 'customize drawer');
  check('Customize receives complete showcase prompt', await evaluate(`([...document.querySelectorAll('textarea')].some(t=>t.value.replace(/\\r/g,'')===${JSON.stringify(fullPrompt.replace(/\r/g, ''))}))`));
  await evaluate(`document.querySelector('[aria-label="close"]').click()`);
  check('Library navigation restored', await clickText('Library'));
  await waitFor(`document.querySelectorAll('.showcase-card').length===7`, 'Library return');
  check('details reopened', await clickText('View Details'));
  await waitFor(`!!document.querySelector('.showcase-dialog')`, 'details reopen');
  check('Test in Lab action clicked', await evaluate(`(()=>{const b=[...document.querySelectorAll('.showcase-dialog button')].find(x=>x.textContent.trim()==='Test in Lab');if(!b)return false;b.click();return true})()`));
  await waitFor(`document.querySelector('textarea')&&document.querySelector('textarea').value.length>300`, 'Lab prompt');
  check('Test in Lab receives complete showcase prompt', (await evaluate(`document.querySelector('textarea').value`)).replace(/\r/g, '') === fullPrompt.replace(/\r/g, ''));

  check('Library navigation for localization', await clickText('Library'));
  await waitFor(`document.querySelectorAll('.showcase-card').length===7`, 'Library localization');
  check('Arabic language toggle clicked', await clickText('العربية'));
  await waitFor(`document.querySelector('.sl').getAttribute('dir')==='rtl'`, 'RTL mode');
  check('Arabic showcase title renders', await evaluate(`document.querySelector('#showcase-title').textContent.trim()==='معرض البرومبتات'`));
  const beforeTheme = await evaluate(`document.querySelector('.sl').dataset.theme`);
  await evaluate(`document.querySelector('button[aria-label="theme"]').click()`);
  await waitFor(`document.querySelector('.sl').dataset.theme!==${JSON.stringify(beforeTheme)}`, 'theme toggle');
  check('theme toggles on Library page', true);

  for (const [label, width, height] of [
    ['large desktop', 1440, 1000],
    ['laptop', 1024, 768],
    ['tablet', 768, 1024],
  ]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    check(`${label} layout has no horizontal overflow`, await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  }
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(250);
  check('mobile layout has no horizontal overflow', await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`));
  check('mobile showcase uses one column', await evaluate(`getComputedStyle(document.querySelector('.showcase-grid')).gridTemplateColumns.split(' ').length===1`));

  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=cmd=>{window.__fallback=cmd==='copy';return window.__fallback}`);
  check('English language toggle clicked', await clickText('English'));
  await waitFor(`document.querySelector('.sl').getAttribute('dir')==='ltr'`, 'LTR mode');
  check('details opened for fallback copy', await clickText('View Details'));
  await waitFor(`!!document.querySelector('.showcase-dialog')`, 'fallback details');
  check('fallback Copy Prompt clicked', await clickText('Copy Prompt'));
  await waitFor(`window.__fallback===true`, 'clipboard fallback');
  check('clipboard fallback executes', await evaluate(`window.__fallback===true`));

  check('no frontend runtime exceptions', exceptions.length === 0);
  const relevantLogs = logs.filter((line) => !/favicon|ERR_BLOCKED_BY_CLIENT|Content Security Policy/i.test(line));
  if (relevantLogs.length) console.error('Browser error logs:', relevantLogs);
  check('no new browser error logs', relevantLogs.length === 0);
}

try {
  await main();
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill();
}
