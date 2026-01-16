import fetch from "node-fetch";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { subject, messages } = req.body || {};

    const content = `${subject || ""}\n\n${messages || ""}`.trim();
    if (!content) {
      return res.status(400).json({ error: "Conteúdo vazio" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ASSISTANT_ID = process.env.ASSISTANT_ID;

    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      return res.status(500).json({ error: "Variáveis de ambiente ausentes" });
    }

    const apiBase = "https://api.openai.com/v1";

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2"
    };

    // 1) cria thread
    const threadRes = await fetch(`${apiBase}/threads`, {
      method: "POST",
      headers
    });

    if (!threadRes.ok) {
      const err = await threadRes.text();
      return res.status(500).json({ error: "Erro ao criar thread", detail: err });
    }

    const thread = await threadRes.json();

    // 2) envia mensagem
    const msgRes = await fetch(`${apiBase}/threads/${thread.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content })
    });

    if (!msgRes.ok) {
      const err = await msgRes.text();
      return res.status(500).json({ error: "Erro ao enviar mensagem", detail: err });
    }

    // 3) cria run
    const runRes = await fetch(`${apiBase}/threads/${thread.id}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assistant_id: ASSISTANT_ID })
    });

    if (!runRes.ok) {
      const err = await runRes.text();
      return res.status(500).json({ error: "Erro ao iniciar run", detail: err });
    }

    const run = await runRes.json();

    // 4) polling
    let status = null;
    let attempts = 0;

    while (attempts < 10) {
      await new Promise((r) => setTimeout(r, 1500));

      const statusRes = await fetch(
        `${apiBase}/threads/${thread.id}/runs/${run.id}`,
        { headers }
      );

      status = await statusRes.json();
      if (status.status === "completed") break;

      attempts++;
    }

    if (!status || status.status !== "completed") {
      return res.status(500).json({ error: "Timeout ao aguardar resposta" });
    }

    // 5) pega resposta
    const messagesRes = await fetch(`${apiBase}/threads/${thread.id}/messages`, { headers });
    const data = await messagesRes.json();

    const answer = data.data?.reverse()?.find((m) => m.role === "assistant");
    const responseText = answer?.content?.[0]?.text?.value?.trim() || "Sem resposta";

    return res.status(200).json({ response: responseText });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno" });
  }
}
