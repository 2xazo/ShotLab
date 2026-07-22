// ---------------------------------------------------------------------------
// Deterministic fallbacks, ported straight from the frontend logic in
// ShotLab.dc.html (signals / scoreOf / elDefs / assembleStudio). Used when no
// LLM key is configured, or if the model call fails — so the API always works
// and returns the exact shapes the UI already understands.
// ---------------------------------------------------------------------------

import { ELEMENTS } from '../prompts/index.js';

// Regex "signals" for each element (verbatim from the frontend).
const SIGNALS = {
  role: /\b(you are|act as|as an?|assume the role|photographer|cinematographer|director|designer|artist|editor)\b|أنت|بصفتك|مصوّر|مخرج|مصمم|فنان/i,
  context: /\b(context|background|for a|scene|subject|setting|brand|campaign|launch|during|occasion|audience)\b|السياق|مشهد|موضوع|علامة|حملة|إطلاق|مناسبة|جمهور/i,
  task: /\b(create|generate|produce|shoot|render|design|capture|make|film|compose)\b|أنشئ|ولّد|صوّر|صمّم|التقط|اصنع/i,
  constraints:
    /\b(lighting|light|lens|mm|camera|angle|tone|color|colou?r|mood|style|avoid|no |without|golden hour|softbox|shallow depth|bokeh|contrast|cinematic|shadow)\b|إضاءة|عدسة|كاميرا|زاوية|لون|مزاج|أسلوب|تجنّب|بدون|ظل|تباين/i,
  format:
    /\b(format|aspect ratio|1:1|4:5|16:9|9:16|2\.35|resolution|4k|8k|hd|vertical|horizontal|square|--ar|midjourney|veo|runway|kling|sora|flux)\b|تنسيق|نسبة|دقة|عمودي|أفقي|مربع/i,
};

// Per-element metadata for feedback (ported from elDefs).
const EL_META = {
  role: {
    en: { fix: 'Open with the visual expert the AI should be.', ex: '“You are an award-winning product photographer.”' },
    ar: { fix: 'ابدأ بالخبير المرئي الذي يجب أن يتقمّصه الذكاء.', ex: '«أنت مصوّر منتجات حائز على جوائز».' },
  },
  context: {
    en: { fix: 'Add the subject, setting, and why the shot exists.', ex: '“…for a luxury fragrance launch during Saudi National Day.”' },
    ar: { fix: 'أضف الموضوع والمكان وسبب اللقطة.', ex: '«…لإطلاق عطر فاخر خلال اليوم الوطني السعودي».' },
  },
  task: {
    en: { fix: 'Name the exact shot or image to create.', ex: '“Create a hero product shot of the bottle on marble.”' },
    ar: { fix: 'حدّد اللقطة أو الصورة المطلوبة بدقة.', ex: '«أنشئ لقطة بطل للعبوة على الرخام».' },
  },
  constraints: {
    en: { fix: 'Set lighting, lens, color, mood and what to avoid.', ex: '“Soft golden-hour light, 85mm, warm tones, no text.”' },
    ar: { fix: 'حدّد الإضاءة والعدسة واللون والمزاج وما يُتجنّب.', ex: '«إضاءة ذهبية ناعمة، 85مم، ألوان دافئة، بلا نص».' },
  },
  format: {
    en: { fix: 'Specify aspect ratio, resolution and platform.', ex: '“9:16, 4K, optimized for Midjourney v6.”' },
    ar: { fix: 'حدّد نسبة الأبعاد والدقة والمنصة.', ex: '«9:16، دقة 4K، مهيّأ لـ Midjourney v6».' },
  },
};

const REASON = {
  en: { 1: 'Missing or barely present.', 3: 'Present but could be more specific.', 4: 'Solid and clear.', 5: 'Strong and well-defined.' },
  ar: { 1: 'غائب أو شبه غائب.', 3: 'موجود لكن يمكن أن يكون أدق.', 4: 'واضح وجيد.', 5: 'قوي ومحدَّد جيداً.' },
};

// 1 / 3 / 4 / 5 based on how many signal hits (verbatim from scoreOf).
function scoreElement(text, key) {
  const g = new RegExp(SIGNALS[key].source, 'gi');
  const n = (String(text || '').match(g) || []).length;
  return n === 0 ? 1 : n === 1 ? 3 : n === 2 ? 4 : 5;
}

export function heuristicScore(prompt, lang = 'en') {
  const elements = ELEMENTS.map((key) => {
    const score = scoreElement(prompt, key);
    const meta = EL_META[key][lang] || EL_META[key].en;
    const reason = (REASON[lang] || REASON.en)[score] || (REASON[lang] || REASON.en)[3];
    return { key, score, reason, fix: meta.fix, example: meta.ex };
  });
  const total = elements.reduce((a, e) => a + e.score, 0);
  return { total, elements };
}

// Ported from assembleStudio — build an RCTCF prompt from attributes.
export function heuristicGenerate({ inputType = 'text', idea = '', attributes = {}, referenceName = '', lang = 'en' }) {
  const a = attributes || {};
  const isVid = inputType === 'video';
  const style = a.style || (lang === 'en' ? 'cinematic' : 'سينمائي');

  if (lang === 'ar') {
    const role = inputType === 'video' ? 'مخرج أفلام إعلانية' : inputType === 'image' ? 'مصوّر حائز على جوائز' : 'خبير إبداع بصري';
    const ctx =
      inputType === 'text'
        ? idea.trim() || 'المفهوم الموصوف'
        : `مشهد يطابق ${inputType === 'image' ? 'الصورة المرجعية المرفقة' : 'الفيديو المرجعي المرفق'}`;
    const cons = [];
    if (a.lighting) cons.push('إضاءة ' + a.lighting);
    if (a.shot) cons.push('تكوين ' + a.shot);
    if (a.color) cons.push(a.color);
    if (a.mood) cons.push('مزاج ' + a.mood);
    if (isVid && a.camera) cons.push('حركة كاميرا ' + a.camera);
    const consLine = cons.length ? cons.join('، ') : 'إضاءة وتكوين نظيفان ومدروسان';
    return (
      `الدور: أنت ${role} متخصص في ${style} ${isVid ? 'الحركة' : 'الصور'}.\n` +
      `السياق: أنشئ محتوى بصرياً لـ ${ctx}.\n` +
      `المهمة: أنتج ${isVid ? 'تسلسل لقطات' : 'صورة'} ${style} تُبرز الفكرة بموضوع بؤري قوي.\n` +
      `القيود: ${consLine}. حافظ على الهوية، واقعية فوتوغرافية، بلا نص أو علامات مائية.\n` +
      `التنسيق: ${a.aspect || '16:9'}، دقة عالية${isVid ? '، حركة سلسة 5-8 ثوانٍ' : ''}.`
    );
  }

  const roleMap = { image: 'an award-winning photographer', video: 'a commercial film director' };
  const role = roleMap[inputType] || 'an expert visual creator';
  const ctx =
    inputType === 'text'
      ? idea.trim() || 'the described concept'
      : `a scene matching the uploaded reference ${inputType}`;
  const cons = [];
  if (a.lighting) cons.push(a.lighting.toLowerCase() + ' lighting');
  if (a.shot) cons.push(a.shot.toLowerCase() + ' framing');
  if (a.color) cons.push(a.color.toLowerCase());
  if (a.mood) cons.push(a.mood.toLowerCase() + ' mood');
  if (isVid && a.camera) cons.push(a.camera.toLowerCase() + ' camera move');
  const consLine = cons.length ? cons.join(', ') : 'clean, intentional lighting and composition';
  return (
    `Role: You are ${role} specializing in ${style.toLowerCase()} ${isVid ? 'motion' : 'imagery'}.\n` +
    `Context: Create visuals for ${ctx}.\n` +
    `Task: Produce a ${style.toLowerCase()} ${isVid ? 'shot sequence' : 'image'} that captures the concept with a strong focal subject.\n` +
    `Constraints: ${consLine}. Keep it on-brand, photorealistic, and free of text or watermarks.\n` +
    `Format: ${a.aspect || '16:9'}, high resolution${isVid ? ', 5–8s smooth motion' : ''}.`
  );
}

// Light-touch improvement used when no model is available: prepend/augment weak
// elements so the "after" is measurably stronger than the "before".
export function heuristicImprove(prompt, lang = 'en') {
  const { elements } = heuristicScore(prompt, lang);
  const additions = [];
  for (const el of elements) {
    if (el.score >= 4) continue;
    const meta = EL_META[el.key][lang] || EL_META[el.key].en;
    additions.push(meta.ex.replace(/[“”«»]/g, '').trim());
  }
  const base = prompt.trim();
  if (!additions.length) return base;
  const joiner = lang === 'ar' ? '\n\n— تحسينات — \n' : '\n\n— Enhancements —\n';
  return base + joiner + additions.map((s) => '• ' + s).join('\n');
}

// Deterministic fallback for /ai/customize when no model is available.
export function heuristicCustomize({ prompt, instruction, platform, lang = 'en' }) {
  let out = String(prompt || '').trim();
  if (platform) {
    const formatLineRe = /(Format:.*|التنسيق:.*)$/im;
    if (formatLineRe.test(out)) {
      out = out.replace(formatLineRe, (m) => `${m}, optimized for ${platform.name}`);
    } else {
      out += lang === 'ar' ? `\nمنصة الاستهداف: ${platform.name}` : `\nOptimized for: ${platform.name}`;
    }
  }
  if (instruction) {
    out += lang === 'ar' ? `\n\nتعديل مطلوب: ${instruction}` : `\n\nRequested change: ${instruction}`;
  }
  return out;
}
