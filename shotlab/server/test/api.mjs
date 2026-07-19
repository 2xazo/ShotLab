// End-to-end API smoke test. Run against a live server:
//   npm run dev   (in one terminal)
//   npm test      (in another)
// Uses only the built-in fetch + a tiny cookie jar to emulate the browser.

const BASE = process.env.API_BASE || 'http://localhost:4000';
let pass = 0,
  fail = 0;
const results = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    results.push(`  ✓ ${name}`);
  } else {
    fail++;
    results.push(`  ✗ ${name} ${extra}`);
  }
}

// minimal per-agent cookie jar
function makeClient() {
  let cookies = {};
  return async function call(method, pathname, body, isForm = false) {
    const headers = {};
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) headers.Cookie = cookieHeader;
    let payload;
    if (isForm) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + pathname, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-json */
    }
    return { status: res.status, json };
  };
}

const rnd = Math.random().toString(36).slice(2, 8);
const userA = { name: 'Alice A', email: `alice_${rnd}@test.dev`, password: 'secret123' };
const userB = { name: 'Bob B', email: `bob_${rnd}@test.dev`, password: 'secret123' };

async function main() {
  // health
  const h = await makeClient()('GET', '/health');
  check('GET /health ok', h.status === 200 && h.json?.ok === true);

  const A = makeClient();
  const B = makeClient();
  const G = makeClient();

  // signup
  let r = await A('POST', '/auth/signup', userA);
  check('signup A → 201', r.status === 201, `got ${r.status}`);
  check('signup A returns user', r.json?.user?.email === userA.email);

  // duplicate email
  r = await A('POST', '/auth/signup', userA);
  check('duplicate signup → 409', r.status === 409, `got ${r.status}`);

  // me
  r = await A('GET', '/auth/me');
  check('GET /me returns user', r.json?.user?.email === userA.email);

  // login (fresh client) + wrong password
  const A2 = makeClient();
  r = await A2('POST', '/auth/login', { email: userA.email, password: 'wrong' });
  check('login wrong password → 401', r.status === 401, `got ${r.status}`);
  r = await A2('POST', '/auth/login', { email: userA.email, password: userA.password });
  check('login correct → 200', r.status === 200);

  // guest
  r = await G('POST', '/auth/guest');
  check('guest session → 200', r.status === 200 && r.json?.guest === true);
  r = await G('GET', '/auth/me');
  check('guest /me guest:true', r.json?.guest === true && r.json?.user === null);

  // guest blocked from AI + writes
  r = await G('POST', '/ai/score', { prompt: 'test' });
  check('guest AI blocked → 403', r.status === 403, `got ${r.status}`);
  r = await G('POST', '/templates', { title: 'x', body: 'y' });
  check('guest write blocked → 403', r.status === 403, `got ${r.status}`);

  // guest CAN browse library
  r = await G('GET', '/library');
  check('guest library browse → 200', r.status === 200 && Array.isArray(r.json?.prompts));
  check('library has curated seed', (r.json?.prompts || []).some((p) => p.id === 'l1'));

  // AI generate (text)
  r = await A('POST', '/ai/generate', {
    inputType: 'text',
    idea: 'Luxury perfume ad for Saudi National Day',
    attributes: { style: 'Cinematic', lighting: 'Golden hour', aspect: '4:5' },
    lang: 'en',
  });
  check('AI generate → 200', r.status === 200, `got ${r.status}`);
  check('AI generate returns prompt', typeof r.json?.prompt === 'string' && r.json.prompt.length > 20);
  check('AI generate has RCTCF', /Role:/.test(r.json?.prompt || '') && /Format:/.test(r.json?.prompt || ''));

  // AI score
  r = await A('POST', '/ai/score', { prompt: r.json.prompt, lang: 'en' });
  check('AI score → 200', r.status === 200);
  check('score total 0-25', r.json?.total >= 0 && r.json?.total <= 25);
  check('score has 5 elements', (r.json?.elements || []).length === 5);
  check('elements keyed correctly', JSON.stringify((r.json?.elements || []).map((e) => e.key)) ===
    JSON.stringify(['role', 'context', 'task', 'constraints', 'format']));

  // AI improve
  r = await A('POST', '/ai/improve', { prompt: 'make a nice image', lang: 'en' });
  check('AI improve → 200', r.status === 200);
  check('improve before/after', typeof r.json?.before === 'string' && typeof r.json?.after === 'string');
  check('improve has scores', Number.isFinite(r.json?.beforeScore) && Number.isFinite(r.json?.afterScore));

  // AI-assisted template customization
  r = await A('POST', '/ai/customize', {
    originalPrompt: 'Create a daytime perfume hero shot in Jeddah, 85mm camera, 4:5, no text.',
    changeRequest: 'Change the scene to nighttime and move it to Riyadh, but preserve the subject and camera style.',
    additionalInstructions: '',
    language: 'en',
  });
  check('AI customize → 200', r.status === 200, `got ${r.status}`);
  check('AI customize returns prompt only', r.json?.success === true && typeof r.json?.prompt === 'string' && r.json.prompt.length > 20);

  r = await A('POST', '/ai/optimize-platform', {
    originalPrompt: 'Create a perfume hero shot on black marble with dramatic light, 4:5, no text.',
    platform: 'midjourney',
    outputType: 'image',
    optimizationLevel: 'balanced',
    language: 'en',
  });
  check('AI platform optimize → 200', r.status === 200, `got ${r.status}`);
  check('AI platform optimize returns prompt only', r.json?.success === true && typeof r.json?.prompt === 'string' && r.json.prompt.length > 20);

  r = await A('POST', '/ai/optimize-platform', {
    originalPrompt: 'test prompt',
    platform: 'unofficial-platform',
  });
  check('unknown optimization platform → 400', r.status === 400, `got ${r.status}`);

  // templates CRUD
  r = await A('POST', '/templates', { title: 'My hero shot', body: 'You are a photographer... [Product]', cats: ['mine'], source: 'studio' });
  check('create template → 201', r.status === 201);
  const tId = r.json?.template?.id;
  r = await A('GET', '/templates');
  check('list templates includes new', (r.json?.templates || []).some((t) => t.id === tId));
  check('template has ts shape', (r.json?.templates || [])[0]?.ts > 0);
  r = await A('PATCH', `/templates/${tId}`, { title: 'Renamed hero' });
  check('patch template', r.json?.template?.title === 'Renamed hero');

  // saved
  r = await A('POST', '/saved', { title: 'Saved one', body: 'body text', source: 'studio' });
  check('create saved → 201', r.status === 201 && r.json?.saved?.ts > 0);
  const sId = r.json.saved.id;

  // favorites
  r = await A('POST', '/favorites/l1');
  check('add favorite → 201', r.status === 201);
  r = await A('GET', '/favorites');
  check('favorites returns array of ids', Array.isArray(r.json?.favorites) && r.json.favorites.includes('l1'));
  r = await A('DELETE', '/favorites/l1');
  check('remove favorite', r.status === 200);

  // history (auto-logged by AI calls) + manual
  r = await A('POST', '/history', { type: 'platform', label: 'Midjourney' });
  check('create history → 201', r.status === 201);
  r = await A('GET', '/history');
  check('history has entries', (r.json?.history || []).length >= 1);
  check('history auto-logged generate', (r.json?.history || []).some((x) => x.type === 'generate'));

  // library filters
  r = await A('GET', '/library?q=perfume');
  check('library search q', Array.isArray(r.json?.prompts));
  r = await A('GET', '/library?mine=true');
  check('library mine filter', (r.json?.prompts || []).every((p) => p.mine === true));

  // cross-user isolation
  await B('POST', '/auth/signup', userB);
  r = await B('GET', '/templates');
  check("B cannot see A's templates", !(r.json?.templates || []).some((t) => t.id === tId));
  r = await B('PATCH', `/templates/${tId}`, { title: 'hacked' });
  check("B cannot patch A's template → 404", r.status === 404, `got ${r.status}`);
  r = await B('DELETE', `/saved/${sId}`);
  check("B cannot delete A's saved → 404", r.status === 404, `got ${r.status}`);
  r = await B('GET', '/favorites');
  check("B favorites empty (isolated)", (r.json?.favorites || []).length === 0);

  // validation
  r = await A('POST', '/ai/score', { prompt: '' });
  check('empty prompt → 400', r.status === 400, `got ${r.status}`);
  r = await A('POST', '/auth/signup', { name: 'x', email: 'not-an-email', password: '123' });
  check('bad signup body → 400', r.status === 400, `got ${r.status}`);

  // logout
  r = await A('POST', '/auth/logout');
  check('logout → 200', r.status === 200);
  r = await A('GET', '/auth/me');
  check('after logout user null', r.json?.user === null);

  console.log('\nShotLab API test\n' + '─'.repeat(40));
  console.log(results.join('\n'));
  console.log('─'.repeat(40));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
