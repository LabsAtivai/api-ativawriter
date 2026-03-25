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

    // Primeiro limpa e compacta bastante o material
    const normalizedReference = sanitizeSupportText(reference, 20000);

    // Depois extrai somente o que tem mais valor comercial para o prompt
    const reducedReference = buildCommercialReference(normalizedReference, 8000);

    if (!cleanSubject && !cleanMessages) {
      return res.status(400).json({ error: "Conteúdo vazio" });
    }

    const systemInstructions = `
Você é o AtivaWriter, assistente executivo comercial da Ativa.ai.

OBJETIVO:
Responder e-mails com clareza, tom humano, postura comercial estratégica e foco em avanço objetivo.
Quando houver potencial real, conduzir a conversa para próximo passo comercial.
Quando não houver potencial, responder com profissionalismo e objetividade.

CLASSIFICAÇÃO INTERNA:
1. Lead potencial
2. Cliente atual
3. Parceiro estratégico
4. Fornecedor/ferramenta B2B relevante
5. Marketing automático/newsletter
6. Spam/irrelevante
7. Encaminhamento operacional / apresentação de contato

IMPORTANTE:
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
- Sempre que houver aderência comercial, conecte a resposta a dores e soluções reais do material.

HIERARQUIA DE RESPOSTA:
1. Siga sempre as regras gerais.
2. Use o MATERIAL DE APOIO como base principal de linguagem, posicionamento e argumentos quando ele for aplicável.
3. Se houver aderência, não gere resposta genérica.
4. Reaproveite a lógica comercial do material de forma natural.
5. Adapte nomes, contexto, saudação e fluidez.
6. Nunca diga que está usando material de apoio.

REGRA ESPECÍFICA PARA ENCAMINHAMENTO:
- Quando o e-mail for um encaminhamento, apresentação de contato ou ponte para um decisor:
  1. agradeça o retorno e o encaminhamento;
  2. reconheça o novo contato ou área envolvida;
  3. conecte a conversa a 1 ou 2 dores e 1 ou 2 soluções do material de apoio;
  4. deixe claro, de forma curta, como a empresa pode ajudar;
  5. proponha avanço objetivo, preferencialmente uma conversa breve.
- Nunca responda apenas com "vou entrar em contato".
- Sempre transformar encaminhamento em avanço comercial concreto.

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

DECISÃO:
- Se for lead potencial, cliente atual, parceiro estratégico ou encaminhamento útil, responda buscando avanço objetivo.
- Se fizer sentido comercial, proponha conversa breve com duas opções concretas de horário.
- Se for fornecedor relevante, responda de forma curta e profissional.
- Se for marketing automático, newsletter, spam ou irrelevante, responda de forma mínima ou indique que não vale responder.

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
Use este material como base principal de linguagem, posicionamento e argumentos quando houver aderência ao e-mail.
Se for encaminhamento para time comercial, gestor, coordenador, decisor ou contato relevante, conecte a resposta a dores e soluções reais descritas abaixo.
Não mencione o material diretamente.

${reducedReference || "[não informado]"}

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
    "automação",
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
    "marketing"
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

  // tenta organizar minimamente em blocos mais úteis
  const finalBlocks = [];

  const strategicBlock = pickLinesByKeywords(selected, [
    "marketing", "crm", "atendimento", "crescimento", "comercial", "vendas"
  ], 8);

  const painBlock = pickLinesByKeywords(selected, [
    "baixo volume", "dependência", "dependencia", "leads inconsistentes",
    "previsibilidade", "no-show", "cadência", "cadencia", "falta de controle",
    "atendimento lento", "follow-up", "follow up"
  ], 8);

  const solutionBlock = pickLinesByKeywords(selected, [
    "crm", "kommo", "automação", "automações", "tráfego", "trafego",
    "landing page", "site", "dashboard", "funil", "atendimento", "pré-vendas", "pre-vendas"
  ], 12);

  if (strategicBlock.length) {
    finalBlocks.push("POSICIONAMENTO:\n" + strategicBlock.join("\n"));
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
