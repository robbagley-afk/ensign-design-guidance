#!/usr/bin/env node
/**
 * Ensign Design Guidance MCP Server (ensign-design-guidance)
 * Local Offline Design System (ECC v2), Tokens & Privacy Gatekeeper for Mac Studio
 * Powered by resident LM Studio Gemma 4 QAT (:1234) & Static ECC v2 Tokens
 * Architecture reviewed by Opus Specialist via Rob's Coding Helper
 */

// 1. Strict Protocol Discipline: stdout is JSON-RPC ONLY.
// Route all console.log to stderr to prevent stream corruption.
console.log = (...args) => process.stderr.write('[ensign-design-guidance] ' + args.join(' ') + '\n');

const fs = require('fs');
const path = require('path');

// 2. Load Static Source of Truth Tables (Safe, synchronous, offline)
const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const RULES_PATH = path.join(__dirname, 'architecture_rules.json');

let TOKENS = {};
let RULES = {};

try {
  if (fs.existsSync(TOKENS_PATH)) {
    TOKENS = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  }
  if (fs.existsSync(RULES_PATH)) {
    RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  }
} catch (err) {
  process.stderr.write(`Failed to load static tables: ${err.message}\n`);
}

// 3. Loopback Inference Client with Hard Abort & Liveness Gate
const GEMMA_URL = 'http://127.0.0.1:1234/v1/chat/completions';
if (!/^http:\/\/127\.0\.0\.1:/.test(GEMMA_URL)) {
  throw new Error('Security violation: non-loopback inference target refused');
}

let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 5000;

async function askResidentGemma(messages, { timeoutMs = 2500, max_tokens = 160, temperature = 0.1 } = {}) {
  // If recent failure within cooldown, fast-fail to preserve sub-second response
  if (Date.now() - lastFailureTime < FAILURE_COOLDOWN_MS) {
    return null;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(GEMMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma4-26b-qat',
        messages,
        temperature,
        max_tokens
      }),
      signal: ac.signal
    });

    if (!res.ok) {
      lastFailureTime = Date.now();
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    lastFailureTime = Date.now();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 4. Regex Pre-filters for FERPA & PII Scanner
const PII_PATTERNS = [
  { name: 'student_id_9digit', regex: /\b\d{9}\b/g },
  { name: 'ssn_format', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'email_address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g },
  { name: 'gpa_pattern', regex: /\b(?:gpa|grade point average)[\s:=]+([0-4]\.\d{1,2})\b/gi },
  { name: 'grade_pattern', regex: /\b(?:letter grade|grade)[\s:=]+[A-DF][+-]?\b/gi }
];

// 5. Tool Implementations

async function handleGetDesignTokenGuidance(args) {
  const query = (args.query || '').toLowerCase();
  const component = (args.component || '').toLowerCase();

  // Primary: Instant static lookup
  const matchedColors = {};
  for (const [key, val] of Object.entries(TOKENS.colors || {})) {
    if (query.includes(key) || component.includes(key) || val.description.toLowerCase().includes(query)) {
      matchedColors[key] = val;
    }
  }

  const matchedTypography = {};
  for (const [key, val] of Object.entries(TOKENS.typography || {})) {
    if (query.includes(key) || component.includes(key)) {
      matchedTypography[key] = val;
    }
  }

  // If query is broad or empty, provide standard quick reference
  const result = {
    source: 'static_ecc_v2_tokens',
    brand: TOKENS.colors?.brand,
    accent_gold: TOKENS.colors?.accent_gold,
    typography_rules: TOKENS.typography?.body,
    touch_targets: TOKENS.touch_targets,
    matched_colors: Object.keys(matchedColors).length ? matchedColors : undefined,
    matched_typography: Object.keys(matchedTypography).length ? matchedTypography : undefined,
    rules_summary: TOKENS.rules
  };

  // If specific natural language query and Gemma is available, enhance with concise answer
  if (query.length > 5 && !query.includes('all')) {
    const gemmaAnswer = await askResidentGemma([
      {
        role: 'system',
        content: `You are an Ensign Career Coach design token assistant. Answer in strictly 1-2 concise lines using only this context:\n${JSON.stringify(TOKENS)}\nIf unknown, answer NOT_IN_CONTEXT.`
      },
      { role: 'user', content: query }
    ], { max_tokens: 100 });

    if (gemmaAnswer && gemmaAnswer !== 'NOT_IN_CONTEXT') {
      result.quick_guidance = gemmaAnswer;
    }
  }

  return result;
}

function handleGetArchitectureGuidance(args) {
  const topic = (args.topic || '').toLowerCase();

  if (topic.includes('port')) {
    return { topic: 'ports', ports: RULES.ports, note: 'Strict port isolation enforced on Mac Studio.' };
  }
  if (topic.includes('storage') || topic.includes('bucket') || topic.includes('boundary')) {
    return {
      topic: 'storage_boundaries',
      boundaries: RULES.storage_boundaries,
      onedrive_trap: RULES.onedrive_overwrite_trap
    };
  }
  if (topic.includes('offload') || topic.includes('model') || topic.includes('tier')) {
    return { topic: 'two_tier_offload', offload: RULES.two_tier_offload };
  }
  if (topic.includes('church') || topic.includes('calling')) {
    return {
      topic: 'church_calling_boundary',
      policy: RULES.storage_boundaries?.['Church Compute vs Storage Policy']
    };
  }

  return {
    source: 'mac_studio_architecture',
    machine_id: RULES.machine_id,
    ports: RULES.ports,
    boundaries: RULES.storage_boundaries,
    two_tier_offload: RULES.two_tier_offload,
    browser_hygiene: RULES.browser_hygiene
  };
}

async function handleCheckFerpaCompliance(args) {
  const content = args.content || '';
  if (!content.trim()) {
    return { compliant: true, pii_detected: [], notes: 'Empty input.' };
  }

  // Pre-filter: Fast regex scan (offline, deterministic)
  const regexFindings = [];
  for (const p of PII_PATTERNS) {
    const matches = content.match(p.regex);
    if (matches && matches.length > 0) {
      regexFindings.push({ pattern: p.name, count: matches.length });
    }
  }

  // Deep check via resident Gemma
  const gemmaAssessment = await askResidentGemma([
    {
      role: 'system',
      content: `You are an offline FERPA compliance scanner at Ensign College.
Analyze the snippet for student PII: names, student IDs, GPA, grades, or unauthorized cloud endpoints.
Output strict JSON format ONLY:
{"compliant": boolean, "pii_categories": string[], "severity": "none"|"medium"|"high", "summary": string}
Never echo any real student names or PII values in your output.`
    },
    { role: 'user', content: content.slice(0, 4000) }
  ], { max_tokens: 160, temperature: 0.0 });

  if (!gemmaAssessment) {
    // Fail closed per Opus Specialist recommendation
    return {
      compliant: regexFindings.length === 0 ? null : false,
      status: 'scanner_unavailable',
      advice: 'LM Studio offline — treat snippet as UNVERIFIED, do not transmit to cloud.',
      regex_findings: regexFindings
    };
  }

  try {
    const parsed = JSON.parse(gemmaAssessment.replace(/```json/g, '').replace(/```/g, '').trim());
    return {
      compliant: parsed.compliant && regexFindings.length === 0,
      pii_categories: parsed.pii_categories || [],
      severity: parsed.severity || (regexFindings.length ? 'high' : 'none'),
      summary: parsed.summary,
      regex_findings: regexFindings.length ? regexFindings : undefined
    };
  } catch (_) {
    return {
      compliant: regexFindings.length === 0,
      gemma_raw: gemmaAssessment,
      regex_findings: regexFindings
    };
  }
}

async function handleAskResidentGemma(args) {
  const prompt = args.prompt || '';
  if (!prompt.trim()) {
    return { status: 'error', message: 'Prompt cannot be empty.' };
  }

  // PII guard: refuse if prompt appears to carry student PII
  for (const p of PII_PATTERNS) {
    if (p.regex.test(prompt)) {
      return {
        status: 'blocked',
        reason: 'Potential PII detected in prompt. Route to check_ferpa_compliance instead.'
      };
    }
  }

  const system_prompt = args.system_prompt || 'You are an Ensign College Career Services coding assistant. Answer concisely and accurately in under 150 words.';
  const max_tokens = Math.min(+(args.max_tokens || 200), 500);

  const reply = await askResidentGemma([
    { role: 'system', content: system_prompt },
    { role: 'user', content: prompt }
  ], { max_tokens, temperature: 0.1 });

  if (!reply) {
    return { status: 'offline', message: 'Resident Gemma (port 1234) is currently unreachable.' };
  }

  return { status: 'ok', response: reply, model: 'gemma4-26b-qat' };
}

// 6. Tool Schemas
const TOOLS = [
  {
    name: 'get_design_token_guidance',
    description: 'Return exact Ensign Career Coach v2 design tokens (brand colors, typography, touch targets, button styles) for a component or query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Design query (e.g. "active pill background", "card styling", "body font size").' },
        component: { type: 'string', description: 'Specific component name (e.g. "button", "card", "chip", "typography").' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_architecture_guidance',
    description: 'Lookup Mac Studio AI Teams architecture rules (port isolation, storage boundaries, two-tier offload, church calling compute policy).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['ports', 'storage', 'offload', 'church_calling', 'all'], description: 'Architecture topic.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'check_ferpa_compliance',
    description: 'Offline privacy & FERPA pre-flight scanner using resident Gemma. Detects student PII and unmasked data with zero cloud tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Code snippet, log text, or prompt to analyze for FERPA compliance.' }
      },
      required: ['content'],
      additionalProperties: false
    }
  },
  {
    name: 'ask_design_advisor',
    description: 'Query resident Gemma on Mac Studio (port 1234) for offline Ensign UI/UX and design system implementation advice at zero token cost.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Design or UI/UX question.' },
        system_prompt: { type: 'string', description: 'Optional system instructions.' },
        max_tokens: { type: 'number', description: 'Maximum tokens to generate (default 200, max 500).' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  },
  {
    name: 'ask_resident_gemma',
    description: 'Backward-compatible alias for ask_design_advisor.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Question or task prompt.' },
        system_prompt: { type: 'string', description: 'Optional system instructions.' },
        max_tokens: { type: 'number', description: 'Maximum tokens to generate (default 200, max 500).' }
      },
      required: ['prompt'],
      additionalProperties: false
    }
  }
];

// 7. JSON-RPC Protocol Dispatcher
async function handleToolCall(name, args) {
  switch (name) {
    case 'get_design_token_guidance':
      return await handleGetDesignTokenGuidance(args);
    case 'get_architecture_guidance':
      return handleGetArchitectureGuidance(args);
    case 'check_ferpa_compliance':
      return await handleCheckFerpaCompliance(args);
    case 'ask_design_advisor':
    case 'ask_resident_gemma':
      return await handleAskResidentGemma(args);
    default:
      throw new Error(`Tool not found: ${name}`);
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// 8. Stdio Line Buffer & Event Loop
let buf = '';

process.stdin.on('data', async (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    try {
      if (msg.method === 'initialize') {
        reply(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'ensign-design-guidance',
            version: '1.0.0'
          }
        });
        continue;
      }

      if (msg.method === 'notifications/initialized') {
        continue;
      }

      if (msg.method === 'ping') {
        reply(msg.id, {});
        continue;
      }

      if (msg.method === 'tools/list') {
        reply(msg.id, { tools: TOOLS });
        continue;
      }

      if (msg.method === 'tools/call') {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments || {};
        const resultData = await handleToolCall(toolName, toolArgs);

        reply(msg.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resultData, null, 2)
            }
          ]
        });
        continue;
      }

      if (msg.id !== undefined) {
        replyError(msg.id, -32601, `Method not found: ${msg.method}`);
      }
    } catch (err) {
      if (msg.id !== undefined) {
        replyError(msg.id, -32603, err.message || 'Internal error');
      }
    }
  }
});

// Top-level Process & Signal Guards
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', (e) => process.stderr.write(`uncaught: ${e.stack}\n`));
process.on('unhandledRejection', (e) => process.stderr.write(`unhandled: ${e}\n`));
