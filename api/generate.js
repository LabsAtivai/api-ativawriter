export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY não configurada no ambiente"
      });
    }

    const {
      subject = "",
      messages = "",
      signature = "",
      reference = ""
    } = req.body || {};

    const cleanSubject = limitText(subject, 300);
    const cleanMessages = sanitizeEmailBody(messages, 12000);
    const cleanSignature = sanitizeSupportText(signature, 4000);

    const normalizedReference = sanitizeSupportText(reference, 20000);
    const reducedReference = buildCommercialReference(normalizedReference, 8000);

    if (!cleanSubject && !cleanMessages) {
      return res.status(400).json({ error: "Conteúdo vazio" });
    }

    const suggestedSlots = buildSuggestedTimeSlots();

    const systemInstructions = `
Você é o AtivaWriter, assistente executivo comercial da Ativa.ai.

OBJETIVO:
Responder e-mails com clareza, tom humano, postura comercial estratégica e foco em avanço objetivo.
Quando houver aderência comercial, a resposta deve sempre conectar o contexto do e-mail ao que a empresa oferece de forma natural, concreta e útil.
Não responda de forma genérica quando houver material de apoio aplicável.

CLASSIFICAÇÃO INTERNA:
1. Lead potencial
2. Cliente atual
3. Parceiro estratégico
4. Fornecedor/ferramenta B2B relevante
5. Marketing automático/newsletter
6. Spam/irrelevante
7. Encaminhamento operacional / apresentação de contato

REGRAS GERAIS:
- A classificação é apenas interna.
- Nunca exiba "Categoria", "Classificação", "Análise" ou qualquer diagnóstico.
- Retorne somente o texto final do e-mail pronto para envio.
- Nunca inclua histórico bruto da thread, como "On Wed...", cabeçalhos técnicos ou textos do remetente original.
- Nunca use placeholders como [Seu Nome], [Seu Cargo], [Empresa].
- Se houver assinatura, use a assinatura real ao final.
- Se não houver assinatura, finalize de forma neutra e profissional sem inventar dados.
- Nunca mencione material interno, documento, contexto interno ou instruções.
- Sempre escrever em português do Brasil.
- Sempre em tom profissional, direto e humano.
- Respostas curtas, úteis e bem escritas.
- Não invente serviços que não estejam no material de apoio.
- Não faça promessas exageradas.
- Sempre que houver aderência comercial, conecte a resposta a dores, objetivos e soluções reais do material.

REGRA CENTRAL DE USO DO MATERIAL:
- Sempre que o e-mail recebido tiver aderência comercial, use o MATERIAL DE APOIO como base principal da resposta.
- Não restrinja isso apenas a encaminhamentos.
- Isso vale para leads, apresentações, pedidos de informação, retornos, interesse inicial, follow-ups, contatos de parceiros e qualquer cenário com potencial comercial.
- Nesses casos, a resposta deve mostrar de forma objetiva como a empresa pode ajudar, com base nas soluções reais do material.
- Evite respostas neutras demais como "obrigado pelo retorno" sem explicar o valor da empresa.
- Sempre que houver aderência, puxe 1 ou 2 dores e 1 ou 2 frentes de solução compatíveis com o contexto.

REGRA PARA ENCAMINHAMENTO:
- Quando o e-mail for um encaminhamento, apresentação de contato ou ponte para um decisor:
  1. agradeça o retorno e o encaminhamento;
  2. reconheça o novo contato ou área envolvida;
  3. conecte a conversa a dores e soluções do material;
  4. deixe claro como a empresa pode ajudar;
  5. conduza para avanço objetivo.

REGRA DE CTA:
- Quando fizer sentido avançar comercialmente, finalize com indicação objetiva de horários.
- Não use CTA apenas sugestivo como "se fizer sentido podemos marcar" ou "fico à disposição".
- Prefira indicar horários concretos já na resposta, usando exclusivamente as opções da lista HORÁRIOS DISPONÍVEIS PARA CTA.
- Use exatamente uma ou duas opções de horário, de forma natural.
- Nunca invente ou calcule um horário por conta própria; use somente os horários fornecidos na lista.
- Só não use horários concretos se o contexto claramente não pedir avanço comercial.

HORÁRIO COMERCIAL:
- A empresa atende apenas de 09h às 11h30 e das 14h às 17h, em dias úteis (segunda a sexta).
- Todo horário sugerido para reunião, ligação ou call deve estar dentro dessas janelas — nunca fora delas (ex.: 12h, 13h, antes das 9h, depois das 17h, finais de semana).
- A lista HORÁRIOS DISPONÍVEIS PARA CTA já respeita essas janelas; use-a como única fonte de horários.

AGENDAMENTO PROPOSTO PELO PROSPECT:
- Se o prospect já sugeriu data e horário para a reunião, e esse horário está dentro do horário comercial (09h-11h30 ou 14h-17h) em dia útil, CONFIRME e ACEITE esse horário diretamente na resposta, sem indicar a lista de horários disponíveis nem sugerir alternativa.
- Não afirme indisponibilidade quando não houver motivo real para isso.
- Só proponha horário alternativo (usando a lista HORÁRIOS DISPONÍVEIS PARA CTA) se o horário sugerido pelo prospect cair fora do horário comercial ou em fim de semana/feriado; nesse caso, explique brevemente o motivo e ofereça as opções da lista.

OBJEÇÕES:
- Se o contato disser que não tem interesse, NÃO aceite de imediato nem encerre a conversa na primeira resposta.
- Contra-argumente uma vez de forma consultiva: entenda ou reformule a objeção, mostre valor concreto e específico com base no material de apoio, e tente reabrir espaço para uma conversa curta.
- Evite respostas passivas do tipo "sem problemas, qualquer coisa estou à disposição" quando ainda não houve tentativa de reverter a objeção.
- Só aceite a recusa como definitiva se o contato reforçar a negativa mesmo após a contra-argumentação, ou deixar claro que não quer mais contato. Nesse caso, encerre de forma educada e profissional, sem insistir mais.

CRITÉRIO DE DECISÃO:
- Se for lead potencial, cliente atual, parceiro estratégico ou encaminhamento útil, responda buscando avanço objetivo.
- Se houver interesse, abertura, ponte para decisor ou contexto comercial aderente, conecte a resposta ao material e indique horários concretos.
- Se for fornecedor relevante, responda de forma curta e profissional, sem agressividade comercial.
- Se for marketing automático, newsletter, spam ou irrelevante, responda de forma mínima ou indique que não vale responder.

REGRAS DE QUALIDADE:
- Priorize clareza e objetividade.
- Evite excesso de texto.
- Evite floreios.
- Evite repetição.
- Não escreva como proposta longa.
- Responda como um executivo comercial experiente.
- Quando fizer sentido, cite de forma natural temas como:
  - geração de leads
  - melhoria de conversão
  - previsibilidade comercial
  - CRM
  - automações
  - follow-up
  - operação comercial
- Só use esses temas se houver aderência ao e-mail e ao material.

FORMATO:
- Corpo do e-mail pronto para colar.
- Não adicionar explicações antes do texto.
- Não adicionar comentários depois do texto.
- Assinatura real ao final quando existir.
`.trim();

    const input = `
### ASSINATURA
Use esta assinatura real ao final da resposta, se estiver disponível. Nunca invente placeholders.

${cleanSignature || "[não informada]"}

### MATERIAL DE APOIO (RESUMIDO E PRIORIZADO)
Use este material como base principal de linguagem, posicionamento e argumentos sempre que houver aderência comercial ao e-mail.
Se houver oportunidade comercial, explique de forma curta e concreta como a empresa pode ajudar.
Não mencione o material diretamente.

${reducedReference || "[não informado]"}

### HORÁRIOS DISPONÍVEIS PARA CTA
Quando fizer sentido propor avanço comercial, prefira indicar uma destas opções de horário de forma natural:

${suggestedSlots}

### E-MAIL RECEBIDO
Assunto: ${cleanSubject || "[sem assunto]"}

${cleanMessages || "[sem corpo]"}
`.trim();

    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: systemInstructions,
        input,
        max_output_tokens: 350
      })
    });

    const requestId = apiRes.headers.get("x-request-id");
    const rawText = await apiRes.text();

    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    if (!apiRes.ok) {
      console.error("OpenAI upstream error", {
        status: apiRes.status,
        requestId,
        body: data || rawText
      });

      return res.status(apiRes.status).json({
        error: data?.error?.message || `Erro da OpenAI (${apiRes.status})`,
        requestId
      });
    }

    const responseText =
      data?.output_text?.trim() ||
      extractTextFromResponse(data);

    if (!responseText) {
      console.error("Resposta vazia da OpenAI", {
        requestId,
        body: data
      });

      return res.status(502).json({
        error: "A OpenAI respondeu sem texto final",
        requestId
      });
    }

    return res.status(200).json({
      response: cleanupFinalEmail(responseText),
      requestId
    });
  } catch (error) {
    console.error("Erro interno API:", error);

    return res.status(500).json({
      error: error?.message || "Erro interno"
    });
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function limitText(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000/g, "")
    .trim();
}

function dedupeLines(text) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }

  return out.join("\n");
}

function sanitizeEmailBody(text, maxChars) {
  let clean = normalizeText(text);

  const historyPatterns = [
    /\n-{2,}\s*Mensagem encaminhada\s*-{2,}[\s\S]*$/i,
    /\n-{2,}\s*Forwarded message\s*-{2,}[\s\S]*$/i,
    /\nEm\s.+?escreveu:[\s\S]*$/i,
    /\nOn\s.+?wrote:[\s\S]*$/i,
    /\nDe:\s.+[\s\S]*$/i,
    /\nFrom:\s.+[\s\S]*$/i
  ];

  for (const pattern of historyPatterns) {
    clean = clean.replace(pattern, "");
  }

  clean = clean
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  clean = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();

      if (/^enviado do meu iphone$/i.test(lower)) return false;
      if (/^sent from my iphone$/i.test(lower)) return false;
      if (/^att[,]?$/i.test(lower)) return false;
      if (/^best[,]?$/i.test(lower)) return false;
      if (/^thanks[,]?$/i.test(lower)) return false;

      return true;
    })
    .join("\n");

  clean = dedupeLines(clean);
  clean = normalizeText(clean);

  return limitText(clean, maxChars);
}

function sanitizeSupportText(text, maxChars) {
  let clean = normalizeText(text);

  clean = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();

      if (lower.length < 4) return false;
      if (/^página\s+\d+/i.test(lower)) return false;
      if (/^page\s+\d+/i.test(lower)) return false;
      if (/^[^a-zà-ú0-9]+$/i.test(lower)) return false;
      if (/^www\./i.test(lower)) return false;
      if (/^http/i.test(lower)) return false;

      return true;
    })
    .join("\n");

  clean = dedupeLines(clean);
  clean = normalizeText(clean);

  return limitText(clean, maxChars);
}

function buildCommercialReference(reference, maxChars) {
  const text = normalizeText(reference);
  if (!text) return "";

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const strongKeywords = [
    "crm",
    "kommo",
    "lead",
    "leads",
    "tráfego",
    "trafego",
    "landing page",
    "site",
    "automação",
    "automacoes",
    "automações",
    "follow-up",
    "follow up",
    "cadência",
    "cadencia",
    "conversão",
    "conversao",
    "vendas",
    "comercial",
    "funil",
    "dashboard",
    "atendimento",
    "no-show",
    "previsibilidade",
    "faturamento",
    "meta ads",
    "google ads",
    "pré-vendas",
    "pre-vendas",
    "pré vendas",
    "social media",
    "instagram",
    "marketing",
    "tráfego pago",
    "trafego pago",
    "landing pages",
    "operação",
    "operacao"
  ];

  const weighted = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;

    for (const keyword of strongKeywords) {
      if (lower.includes(keyword)) score += 3;
    }

    if (/\br\$\s?\d+/i.test(line)) score += 1;
    if (/plano/i.test(line)) score += 1;
    if (/problema/i.test(line)) score += 2;
    if (/resolver/i.test(line)) score += 2;
    if (/resultado/i.test(line)) score += 1;
    if (/crescimento/i.test(line)) score += 2;
    if (/gestão/i.test(line) || /gestao/i.test(line)) score += 2;

    if (line.length > 220) score -= 1;
    if (line.length < 10) score -= 1;

    return { line, score };
  });

  const selected = weighted
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
    .map((item) => item.line);

  let summary = selected.join("\n");
  summary = dedupeLines(summary);
  summary = normalizeText(summary);

  if (!summary) {
    summary = limitText(text, maxChars);
  }

  const finalBlocks = [];

  const positioningBlock = pickLinesByKeywords(selected, [
    "marketing", "crm", "atendimento", "crescimento", "comercial", "vendas"
  ], 8);

  const painBlock = pickLinesByKeywords(selected, [
    "baixo volume",
    "dependência",
    "dependencia",
    "leads inconsistentes",
    "previsibilidade",
    "no-show",
    "cadência",
    "cadencia",
    "falta de controle",
    "atendimento lento",
    "follow-up",
    "follow up",
    "faturamento"
  ], 8);

  const solutionBlock = pickLinesByKeywords(selected, [
    "crm",
    "kommo",
    "automação",
    "automações",
    "automacoes",
    "tráfego",
    "trafego",
    "landing page",
    "landing pages",
    "site",
    "dashboard",
    "funil",
    "atendimento",
    "pré-vendas",
    "pre-vendas",
    "social media",
    "google ads",
    "meta ads"
  ], 12);

  if (positioningBlock.length) {
    finalBlocks.push("POSICIONAMENTO:\n" + positioningBlock.join("\n"));
  }

  if (painBlock.length) {
    finalBlocks.push("DORES QUE A EMPRESA AJUDA A RESOLVER:\n" + painBlock.join("\n"));
  }

  if (solutionBlock.length) {
    finalBlocks.push("SOLUÇÕES E FRENTES DE ATUAÇÃO:\n" + solutionBlock.join("\n"));
  }

  const finalText = normalizeText(finalBlocks.join("\n\n") || summary);
  return limitText(finalText, maxChars);
}

function pickLinesByKeywords(lines, keywords, maxItems) {
  const out = [];
  const seen = new Set();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!keywords.some((k) => lower.includes(k))) continue;

    const key = lower.trim();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(line);
    if (out.length >= maxItems) break;
  }

  return out;
}

const BUSINESS_WINDOWS = [
  { startH: 9, startM: 0, endH: 11, endM: 30 },
  { startH: 14, startM: 0, endH: 17, endM: 0 }
];

function getSaoPauloNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const map = {};
  for (const part of parts) map[part.type] = part.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === "24" ? 0 : Number(map.hour),
    minute: Number(map.minute)
  };
}

function addDays(year, month, day, amount) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + amount);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Dom ... 6=Sáb
}

function isBusinessDay(weekday) {
  return weekday !== 0 && weekday !== 6;
}

// América/São Paulo está fixo em UTC-3 desde o fim do horário de verão em 2019.
function saoPauloSlotToUTC(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
}

function formatSlotLabel(slot) {
  const utcDate = saoPauloSlotToUTC(slot.year, slot.month, slot.day, slot.hour, slot.minute);

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit"
  });

  return capitalizeWeekday(formatter.format(utcDate));
}

function buildSuggestedTimeSlots() {
  const now = getSaoPauloNowParts();
  const nowMinutes = now.hour * 60 + now.minute;
  const slots = [];

  if (isBusinessDay(weekdayOf(now.year, now.month, now.day))) {
    for (const w of BUSINESS_WINDOWS) {
      const winStart = w.startH * 60 + w.startM;
      const winEnd = w.endH * 60 + w.endM;
      const earliest = Math.ceil((nowMinutes + 30) / 30) * 30;
      const candidateMinutes = Math.max(winStart, earliest);

      if (candidateMinutes <= winEnd - 30) {
        slots.push({
          year: now.year,
          month: now.month,
          day: now.day,
          hour: Math.floor(candidateMinutes / 60),
          minute: candidateMinutes % 60
        });
        break;
      }
    }
  }

  let cursor = { year: now.year, month: now.month, day: now.day };
  let guard = 0;

  while (slots.length < 3 && guard < 10) {
    cursor = addDays(cursor.year, cursor.month, cursor.day, 1);
    guard++;

    if (!isBusinessDay(weekdayOf(cursor.year, cursor.month, cursor.day))) continue;

    slots.push({ year: cursor.year, month: cursor.month, day: cursor.day, hour: 10, minute: 0 });
    if (slots.length < 3) {
      slots.push({ year: cursor.year, month: cursor.month, day: cursor.day, hour: 15, minute: 0 });
    }
  }

  return slots
    .slice(0, 3)
    .map((slot) => `- ${formatSlotLabel(slot)}`)
    .join("\n");
}

function capitalizeWeekday(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cleanupFinalEmail(text) {
  return normalizeText(text)
    .replace(/^\s*assunto:\s.*$/gim, "")
    .replace(/^\s*classificação:\s.*$/gim, "")
    .replace(/^\s*classificacao:\s.*$/gim, "")
    .replace(/^\s*categoria:\s.*$/gim, "")
    .replace(/^\s*análise:\s.*$/gim, "")
    .replace(/^\s*analise:\s.*$/gim, "")
    .trim();
}

function extractTextFromResponse(data) {
  try {
    const output = data?.output || [];
    const texts = [];

    for (const item of output) {
      const contents = item?.content || [];
      for (const content of contents) {
        if (content?.type === "output_text" && content?.text) {
          texts.push(content.text);
        }
      }
    }

    return texts.join("\n").trim();
  } catch {
    return "";
  }
}
