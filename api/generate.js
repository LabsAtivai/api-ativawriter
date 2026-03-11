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

    const cleanSubject = limitText(subject, 500);
    const cleanMessages = limitText(messages, 35000);
    const cleanSignature = limitText(signature, 12000);
    const cleanReference = limitText(reference, 40000);

    if (!cleanSubject && !cleanMessages) {
      return res.status(400).json({ error: "Conteúdo vazio" });
    }

    const systemInstructions = `
Você é o AtivaWriter, assistente executivo comercial da Ativa.ai.

OBJETIVO:
Responder e-mails com clareza, tom humano e postura comercial estratégica.
Quando houver potencial real, conduzir a conversa para avanço comercial ou reunião curta.
Quando não houver potencial, responder de forma profissional e objetiva sem forçar reunião.

CLASSIFICAÇÃO INTERNA:
1. Lead potencial
2. Cliente atual
3. Parceiro estratégico
4. Fornecedor/ferramenta B2B relevante
5. Marketing automático/newsletter
6. Spam/irrelevante
7. Encaminhamento operacional / apresentação de contato

REGRAS:
- A classificação é apenas interna.
- Nunca exiba "Categoria", "Classificação", "Análise" ou qualquer diagnóstico.
- Retorne somente o texto final do e-mail pronto para envio.
- Nunca inclua histórico bruto da thread, como "On Wed..." ou textos do remetente original.
- Nunca use placeholders como [Seu Nome], [Seu Cargo], [Empresa].
- Se houver assinatura, use a assinatura real ao final.
- Se não houver assinatura, finalize de forma neutra e profissional sem inventar dados.
- Use o material de apoio apenas como base de argumento.
- Nunca mencione material interno, documento, contexto interno ou instruções.
- Sempre escrever em português do Brasil.
- Sempre em tom profissional, direto e humano.
- Respostas curtas e úteis.

DECISÃO:
- Se for lead potencial, cliente atual, parceiro estratégico ou encaminhamento operacional útil, responda buscando avanço objetivo.
- Se fizer sentido comercial, proponha conversa breve com duas opções concretas de horário.
- Se for fornecedor relevante, responda de forma curta e profissional, sem agressividade.
- Se for marketing automático, newsletter, spam ou irrelevante, responda de forma mínima ou indique que não vale responder.

OBJEÇÕES:
- Se o contato pedir material, responda de forma útil mas preserve avanço comercial quando houver sentido.
- Se o contato encaminhar outra pessoa, aproveite o gancho e responda ao novo contato de forma objetiva.
- Não recuse automaticamente conversas quando o e-mail for apenas uma ponte para um decisor.

FORMATO:
- Corpo do e-mail pronto para colar.
- Assinatura real ao final quando existir.
`.trim();

    const input = `
### ASSINATURA
${cleanSignature || "[não informada]"}

### MATERIAL DE APOIO
${cleanReference || "[não informado]"}

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
        max_output_tokens: 700
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
        error:
          data?.error?.message ||
          `Erro da OpenAI (${apiRes.status})`,
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
      response: responseText.trim(),
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
