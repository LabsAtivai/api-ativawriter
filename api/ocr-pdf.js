import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import formidable from "formidable";
import pdfParse from "pdf-parse";

export const config = {
  api: {
    bodyParser: false
  }
};

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MIN_USEFUL_TEXT_CHARS = 100;
const OCR_TIMEOUT_MS = 90000;

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  let tempDir = null;

  try {
    const { file } = await parseSingleFile(req);

    if (!file) {
      return res.status(400).json({ success: false, error: "Arquivo PDF não enviado." });
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ativawriter-ocr-"));

    const inputPdfPath = path.join(tempDir, "input.pdf");
    const outputPdfPath = path.join(tempDir, "output-ocr.pdf");
    const sidecarTxtPath = path.join(tempDir, "output.txt");

    await fs.copyFile(file.filepath, inputPdfPath);

    // 1) tenta extração nativa primeiro
    const nativeText = await extractPdfText(inputPdfPath);
    if (!isInsufficientPdfText(nativeText)) {
      return res.status(200).json({
        success: true,
        extractedText: nativeText,
        source: "native"
      });
    }

    // 2) OCR via Docker
    await runOcrmyPdfInDocker({
      inputPdfPath,
      outputPdfPath,
      sidecarTxtPath,
      timeoutMs: OCR_TIMEOUT_MS
    });

    if (!fsSync.existsSync(sidecarTxtPath)) {
      return res.status(500).json({
        success: false,
        error: "OCR executou, mas o TXT sidecar não foi criado."
      });
    }

    const sidecarText = normalizeText(await fs.readFile(sidecarTxtPath, "utf8"));

    if (isInsufficientPdfText(sidecarText)) {
      return res.status(422).json({
        success: false,
        error: "OCR concluído, mas o texto extraído foi insuficiente."
      });
    }

    return res.status(200).json({
      success: true,
      extractedText: sidecarText,
      source: "ocrmypdf"
    });
  } catch (error) {
    console.error("[OCR] Erro interno:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Erro interno no OCR."
    });
  } finally {
    if (tempDir) {
      await safeRm(tempDir);
    }
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseSingleFile(req) {
  const form = formidable({
    multiples: false,
    maxFiles: 1,
    maxFileSize: MAX_FILE_SIZE_BYTES,
    keepExtensions: true
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      resolve({ fields, file });
    });
  });
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000/g, "")
    .trim();
}

function getUsefulTextLength(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[|_~`´^"'=+\-*/\\[\]{}()<>.,;:!?]/g, "")
    .length;
}

function isInsufficientPdfText(text) {
  return getUsefulTextLength(text) < MIN_USEFUL_TEXT_CHARS;
}

async function extractPdfText(pdfPath) {
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer).catch(() => null);
  return normalizeText(parsed?.text || "");
}

async function runOcrmyPdfInDocker({ inputPdfPath, outputPdfPath, sidecarTxtPath, timeoutMs }) {
  const tempDir = path.dirname(inputPdfPath);
  const dockerMountPath = "/data";

  const inputInsideContainer = `${dockerMountPath}/input.pdf`;
  const outputInsideContainer = `${dockerMountPath}/output-ocr.pdf`;
  const sidecarInsideContainer = `${dockerMountPath}/output.txt`;

  const hostMount =
    process.platform === "win32"
      ? tempDir.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1")
      : tempDir;

  const args = [
    "run",
    "--rm",
    "-v",
    `${hostMount}:${dockerMountPath}`,
    "ativawriter-ocr",
    "--sidecar",
    sidecarInsideContainer,
    "-l",
    "por",
    "--skip-text",
    "--optimize",
    "0",
    inputInsideContainer,
    outputInsideContainer
  ];

  await runCommand("docker", args, timeoutMs);

  if (!fsSync.existsSync(sidecarTxtPath)) {
    throw new Error("Docker OCR executou, mas não gerou o arquivo TXT sidecar.");
  }
}

function runCommand(command, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGKILL");
      reject(new Error(`Timeout ao executar ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += String(data);
    });

    child.stderr.on("data", (data) => {
      stderr += String(data);
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Falha ao iniciar ${command}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        return reject(
          new Error(
            `Comando falhou (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`
          )
        );
      }

      resolve({ stdout, stderr });
    });
  });
}

async function safeRm(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {}
}
