/* =========================================================
   Pregão — Passar para outro aparelho por QR code
   ---------------------------------------------------------
   Aparelho A (que já está configurado) mostra um QR code.
   Aparelho B lê e recebe lista, carteira, alertas, preferências
   e (se marcado) as chaves. Assim B pula o guia de primeiros
   passos. Vale nos dois sentidos: PC → celular ou celular → PC.

   Duas formas de ler:
   1. Câmera normal do celular: o QR é um link do Pregão com
      os dados depois do "#". Abrir o link já traz os dados.
   2. "Ler QR code" dentro do Pregão (bom no PC com webcam):
      usa o leitor do navegador (BarcodeDetector) ou, se não
      houver, a biblioteca jsQR (js/vendor/jsqr.js).

   Segurança:
   - Os dados vão depois do "#" no link: essa parte NUNCA é
     enviada para o servidor (GitHub), fica só nos aparelhos.
   - O código vale 10 minutos.
   - Quem fotografar o QR com as chaves leva as chaves: a tela
     avisa e dá para desmarcar "Incluir minhas chaves".
   - B sempre mostra o que vai chegar e pede confirmação.

   Formato: #transfer=1.<z|j>.<base64url>
     z = JSON comprimido (deflate), j = JSON puro (navegador sem compressão)
     JSON = { e: validoAteMs, d: { "pregao.watchlist": [...], ... } }
   ========================================================= */

const TRANSFER_TTL = 10 * 60 * 1000;
// Marcado já ao carregar o script, antes do app iniciar: o guia (boas-vindas.js) não abre por cima
window.__pregaoIncomingTransfer = /#transfer=/.test(location.hash);
// Coisas deste aparelho que não fazem sentido no outro
const TRANSFER_SKIP = ["pregao.seenVersion", "pregao.privacyOk", "pregao.feedbackQueue", "pregao.demo", "pregao.importMsg"];

/* ---------- 1. Codificar / decodificar ---------- */
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

async function encodeTransfer(data) {
  const json = new TextEncoder().encode(JSON.stringify({ e: Date.now() + TRANSFER_TTL, d: data }));
  if ("CompressionStream" in window) {
    try { return `1.z.${b64url(await pipeBytes(json, new CompressionStream("deflate-raw")))}`; } catch { /* cai no JSON puro */ }
  }
  return `1.j.${b64url(json)}`;
}

async function decodeTransfer(code) {
  const [ver, kind, body] = String(code).split(".");
  if (ver !== "1" || !body) throw new Error("FORMATO");
  let bytes = unb64url(body);
  if (kind === "z") bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj || typeof obj.d !== "object") throw new Error("FORMATO");
  if (Date.now() > obj.e) throw new Error("EXPIRADO");
  return obj.d;
}

const transferUrl = (code) => `${location.origin}${location.pathname}#transfer=${code}`;
const codeFromText = (text) => (String(text).match(/#transfer=([\w.-]+)/) || [])[1] || null;

/* ---------- 2. Mostrar o QR (aparelho que já está configurado) ---------- */
let shareTimer = null;

async function renderShareQr() {
  const box = $("#qs-code");
  const withKeys = $("#qs-keys").checked;
  clearInterval(shareTimer);
  box.classList.remove("expired");
  $("#qs-again").hidden = true;
  box.innerHTML = '<span class="muted small">Gerando…</span>';
  try {
    const code = await encodeTransfer(collectBackupData(withKeys, TRANSFER_SKIP));
    const url = transferUrl(code);
    const qrcode = await loadQrLib();
    const qr = qrcode(0, "L");            // L = cabe mais coisa no mesmo QR
    qr.addData(url);
    qr.make();                            // lança erro se não couber
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    box.dataset.url = url;                // os testes leem daqui

    // contagem regressiva de 10 minutos
    const until = Date.now() + TRANSFER_TTL;
    const tick = () => {
      const left = Math.max(0, until - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $("#qs-timer").textContent = left ? `Vale por ${m}:${String(s).padStart(2, "0")}` : "Expirou";
      if (!left) { clearInterval(shareTimer); box.classList.add("expired"); $("#qs-again").hidden = false; }
    };
    tick();
    shareTimer = setInterval(tick, 1000);
  } catch {
    box.innerHTML = '<span class="small">Sua lista é grande demais para um QR code. Use <b>Exportar backup</b> (arquivo) logo acima.</span>';
    $("#qs-timer").textContent = "";
  }
}

function openShareQr() {
  closeSettings();
  $("#qr-share-overlay").hidden = false;
  renderShareQr();
}
function closeShareQr() {
  clearInterval(shareTimer);
  $("#qr-share-overlay").hidden = true;
  $("#qs-code").innerHTML = "";          // não deixa o QR com as chaves parado na tela
  delete $("#qs-code").dataset.url;
}

/* ---------- 3. Receber (aparelho novo) ---------- */
let pendingTransfer = null;

function summarize(d) {
  const n = (k) => (Array.isArray(d[k]) ? d[k].length : d[k] && typeof d[k] === "object" ? Object.keys(d[k]).length : 0);
  const items = [];
  items.push(`📋 ${n("pregao.watchlist")} ${n("pregao.watchlist") === 1 ? "ativo" : "ativos"} na lista`);
  if (n("pregao.portfolio")) items.push(`💼 ${n("pregao.portfolio")} na carteira`);
  if (n("pregao.alerts")) items.push(`🔔 ${n("pregao.alerts")} ${n("pregao.alerts") === 1 ? "alerta" : "alertas"}`);
  items.push(d["pregao.config"]?.finnhubKey ? "🔑 Suas chaves de API (pula a configuração)" : "🔑 Sem chaves (você configura depois)");
  return items;
}

async function receiveTransfer(code) {
  try {
    const data = await decodeTransfer(code);
    pendingTransfer = data;
    $("#tr-list").innerHTML = summarize(data).map((t) => `<li>${esc(t)}</li>`).join("");
    $("#transfer-overlay").hidden = false;
  } catch (err) {
    if (window.__pregaoIncomingTransfer) { window.__pregaoIncomingTransfer = false; if (!state.config.finnhubKey) emit("needKey"); }
    toast(err.message === "EXPIRADO"
      ? "Esse QR code expirou. Gere outro no outro aparelho (vale 10 minutos)."
      : "Não deu para ler os dados desse QR code. Gere outro e tente de novo.");
  }
}

function confirmTransfer() {
  if (!pendingTransfer) return;
  $("#transfer-overlay").hidden = true;
  toast("Dados recebidos. Recarregando…");
  applyBackupData(pendingTransfer);       // mesma rotina do backup (js/configuracoes.js)
}
function cancelTransfer() {
  pendingTransfer = null;
  $("#transfer-overlay").hidden = true;
  if (window.__pregaoIncomingTransfer) {
    window.__pregaoIncomingTransfer = false;
    if (!state.config.finnhubKey) emit("needKey");   // sem chave: volta o guia normal
  }
}

/* ---------- 4. Ler o QR com a câmera, dentro do Pregão ---------- */
let scan = null; // { stream, raf, detector }
let jsqrLib = null;

function loadJsQr() {
  if (jsqrLib) return jsqrLib;
  jsqrLib = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/jsqr.js";
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => { jsqrLib = null; reject(new Error("sem leitor")); };
    document.head.appendChild(s);
  });
  return jsqrLib;
}

async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes("qr_code")) {
        const d = new BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => (await d.detect(video))[0]?.rawValue || null;
      }
    } catch { /* usa o jsQR */ }
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data || null;
  };
}

// O que fazer com o texto lido (também chamado pelos testes)
function handleScannedText(text) {
  const code = codeFromText(text);
  if (!code) { $("#scan-msg").textContent = "Esse QR code não é do Pregão. Aponte para o código em ⚙ → Dados e backup → Mostrar QR code."; return false; }
  window.__pregaoIncomingTransfer = true;   // se cancelar a confirmação, o guia volta
  closeScanner(false);
  receiveTransfer(code);
  return true;
}

async function openScanner() {
  closeSettings();
  $("#welcome-overlay").hidden = true;      // o guia volta se a pessoa cancelar (recarregar)
  $("#qr-scan-overlay").hidden = false;
  $("#scan-msg").textContent = "Aponte a câmera para o QR code do outro aparelho.";
  if (!navigator.mediaDevices?.getUserMedia) {
    $("#scan-msg").textContent = "Este navegador não deixa usar a câmera. No celular, use a câmera normal do aparelho apontada para o QR code.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const video = $("#scan-video");
    video.srcObject = stream;
    await video.play();
    const detect = await makeDetector();
    scan = { stream, raf: 0 };
    let busy = false;
    const loop = async () => {
      if (!scan) return;
      if (!busy) {
        busy = true;
        try { const text = await detect(video); if (text && handleScannedText(text)) return; } catch { /* quadro ruim: tenta o próximo */ }
        busy = false;
      }
      scan.raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    $("#scan-msg").textContent = err && err.name === "NotAllowedError"
      ? "Sem permissão para a câmera. Libere no cadeado ao lado do endereço e tente de novo."
      : "Não encontrei uma câmera neste aparelho. Faça ao contrário: mostre o QR aqui e leia no celular.";
  }
}

function closeScanner(backToGuide = true) {
  if (scan) {
    cancelAnimationFrame(scan.raf);
    scan.stream.getTracks().forEach((t) => t.stop()); // desliga a câmera (a luzinha apaga)
    scan = null;
  }
  $("#scan-video").srcObject = null;
  $("#qr-scan-overlay").hidden = true;
  // [CORRIGIDO] fechou o leitor sem ler nada e ainda não tem chave: o guia volta
  if (backToGuide && !state.config.finnhubKey) emit("needKey");
}

/* ---------- 5. Ligações com o app ---------- */
on("init", () => {
  $("#set-qr-show").addEventListener("click", openShareQr);
  $("#set-qr-scan").addEventListener("click", openScanner);
  $("#wz-qr").addEventListener("click", openScanner);
  $("#qs-keys").addEventListener("change", renderShareQr);
  $("#qs-again").addEventListener("click", renderShareQr);
  $("#qs-close").addEventListener("click", closeShareQr);
  $("#scan-close").addEventListener("click", () => closeScanner());
  $("#tr-ok").addEventListener("click", confirmTransfer);
  $("#tr-cancel").addEventListener("click", cancelTransfer);
  $("#tr-close").addEventListener("click", cancelTransfer);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#qr-share-overlay").hidden) closeShareQr();
    if (!$("#qr-scan-overlay").hidden) closeScanner();   // (com teclado)
  });

  // Chegou pelo link do QR (câmera normal do celular)?
  const code = codeFromText(location.hash);
  if (code) {
    history.replaceState(null, "", location.pathname + location.search); // tira os dados da barra de endereço
    $("#welcome-overlay").hidden = true;                                  // nada de guia: os dados estão chegando
    receiveTransfer(code);
  }
});
