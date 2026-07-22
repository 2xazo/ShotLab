// ---------------------------------------------------------------------------
// Swappable LLM provider. LLM_PROVIDER=openai (default) | anthropic.
// Every operation degrades gracefully to the deterministic heuristics if no
// key is configured or the provider call throws, so the API never hard-fails.
// ---------------------------------------------------------------------------

import { env, flags } from '../env.js';
import {
  generateSystem,
  generateUser,
  scoreSystem,
  scoreUser,
  improveSystem,
  improveUser,
  customizeSystem,
  customizeUser,
  ELEMENTS,
} from '../prompts/index.js';
import {
  heuristicScore,
  heuristicGenerate,
  heuristicImprove,
  heuristicCustomize,
} from './heuristics.js';

let _openai = null;
let _anthropic = null;

async function openai() {
  if (_openai) return _openai;
  const { default: OpenAI } = await import('openai');
  _openai = new OpenAI({ apiKey: env.openaiKey });
  return _openai;
}

async function anthropic() {
  if (_anthropic) return _anthropic;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _anthropic = new Anthropic({ apiKey: env.anthropicKey });
  return _anthropic;
}

function extractJson(text) {
  if (!text) return null;
  // Strip code fences if the model added them, then grab the first {...}.
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

// Multimodal-aware content builder for OpenAI (attaches reference images).
function openaiUserContent(userText, imageUrl) {
  if (!imageUrl) return userText;
  return [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: imageUrl } },
  ];
}

async function callJson({ system, user, imageUrl }) {
  if (!flags.hasLLM) return null;
  try {
    if (env.llmProvider === 'anthropic') {
      const client = await anthropic();
      const content = imageUrl
        ? [
            { type: 'text', text: user },
            // Anthropic accepts base64 or url image sources depending on SDK/version.
            { type: 'image', source: { type: 'url', url: imageUrl } },
          ]
        : user;
      const msg = await client.messages.create({
        model: env.anthropicModel,
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content }],
      });
      const text = msg.content?.map((b) => b.text || '').join('') || '';
      return extractJson(text);
    }
    // default: openai
    const client = await openai();
    const res = await client.chat.completions.create({
      model: env.openaiModel,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: openaiUserContent(user, imageUrl) },
      ],
    });
    return extractJson(res.choices?.[0]?.message?.content || '');
  } catch (err) {
    console.warn('[llm] provider call failed, using heuristic fallback:', err.message);
    return null;
  }
}

// -------- public API --------

export async function generatePrompt({ inputType, idea, attributes, referenceName, imageUrl, lang = 'en' }) {
  const json = await callJson({
    system: generateSystem(lang),
    user: generateUser({ inputType, idea, attributes, reference: referenceName }),
    imageUrl: inputType === 'image' ? imageUrl : null,
  });
  if (json?.prompt && typeof json.prompt === 'string') {
    return { prompt: json.prompt.trim(), source: 'model' };
  }
  return { prompt: heuristicGenerate({ inputType, idea, attributes, referenceName, lang }), source: 'heuristic' };
}

function normalizeElements(raw) {
  const byKey = {};
  for (const e of raw || []) {
    if (e && ELEMENTS.includes(e.key)) byKey[e.key] = e;
  }
  const elements = ELEMENTS.map((key) => {
    const e = byKey[key] || {};
    let score = parseInt(e.score, 10);
    if (!Number.isFinite(score)) score = 1;
    score = Math.max(1, Math.min(5, score));
    return {
      key,
      score,
      reason: String(e.reason || ''),
      fix: String(e.fix || ''),
      example: String(e.example || ''),
    };
  });
  const total = elements.reduce((a, e) => a + e.score, 0);
  return { total, elements };
}

export async function scorePrompt({ prompt, lang = 'en' }) {
  const json = await callJson({ system: scoreSystem(lang), user: scoreUser(prompt) });
  if (json?.elements?.length) {
    return { ...normalizeElements(json.elements), source: 'model' };
  }
  return { ...heuristicScore(prompt, lang), source: 'heuristic' };
}

export async function improvePrompt({ prompt, lang = 'en' }) {
  const before = prompt;
  const beforeScore = (await scorePrompt({ prompt: before, lang })).total;

  const json = await callJson({ system: improveSystem(lang), user: improveUser(prompt) });
  let after;
  let source;
  if (json?.after && typeof json.after === 'string') {
    after = json.after.trim();
    source = 'model';
  } else {
    after = heuristicImprove(before, lang);
    source = 'heuristic';
  }

  const afterScore = (await scorePrompt({ prompt: after, lang })).total;
  return { before, after, beforeScore, afterScore, source };
}

export async function customizePrompt({ prompt, instruction, platform, lang = 'en' }) {
  const json = await callJson({
    system: customizeSystem(lang),
    user: customizeUser({ prompt, instruction, platform }),
  });
  if (json?.prompt && typeof json.prompt === 'string') {
    return { prompt: json.prompt.trim(), source: 'model' };
  }
  return { prompt: heuristicCustomize({ prompt, instruction, platform, lang }), source: 'heuristic' };
}
