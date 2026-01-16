import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const apiBase = "https://api.openai.com/v1";

app.post("/generate", async (req, res) => {
  try {
    const { subject, messages } = req.body;

    const content = `${subject || ""}\n\n${messages || ""}`.trim();
    if (!content) {
      return res.status(400).json({ error: "Conteúdo vazio" });
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2"
    };

    // cria thread
    const threadRes = await fetch(`${apiBase}/threads`, {
      method: "POST",
      headers
    });
    const thread = await threadRes.json();

    // envia mensagem
    await fetch(`${apiBase}/threads/${thread.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        role: "user",
        content
      })
    });

    // roda assistant
    const runRes = await fetch(`${apiBase}/threads/${thread.id}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assistant_id: process.env.ASSISTANT_ID
      })
    });
    const run = await runRes.json();

    let status;
    let attempts = 0;

    do {
      await new Promise(r => setTimeout(r, 1500));
      const statusRes = await fetch(
        `${apiBase}/threads/${thread.id}/runs/${run.id}`,
        { headers }
      );
      status = await statusRes.json();
      attempts++;
    } while (status.status !== "completed" && attempts < 10);

    if (status.status !== "completed") {
      return res.status(500).json({ error: "Timeout" });
    }

    const messagesRes = await fetch(
      `${apiBase}/threads/${thread.id}/messages`,
      { headers }
    );
    const data = await messagesRes.json();

    const answer = data.data
      .reverse()
      .find(m => m.role === "assistant");

    res.json({
      response: answer?.content?.[0]?.text?.value || "Sem resposta"
    });

  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Backend rodando na porta ${process.env.PORT}`);
});
