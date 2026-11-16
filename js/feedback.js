/* =========================================================
   Pregão — Feedback (⚙ Configurações → aba "Feedback")
   ---------------------------------------------------------
   Quem usa o app escreve uma ideia, um problema ou um elogio.

   Caminho principal: Google Forms ("Feedback do Pregão", na
   conta do Rafael). A mensagem cai na planilha
   "Feedback do Pregão (respostas)" no Google Drive dele.
   - Não precisa de conta e é PRIVADO (só o Rafael vê).
   - O Pregão não tem servidor: a mensagem vai num POST direto
     para o "formResponse". O Google não deixa o site ler a
     resposta (mode: "no-cors"), então "deu certo" quer dizer
     "a internet entregou o pedido".
   - Sem internet: a mensagem fica guardada no aparelho
     (pregao.feedbackQueue) e é enviada sozinha quando a
     conexão voltar.

   Caminho alternativo: link "Prefere o GitHub?", que abre uma
   issue pública já preenchida (precisa de conta no GitHub).

   NUNCA vão junto: chaves de API, carteira ou lista de ações.
   Os "detalhes técnicos" são só versão, sistema, navegador e
   tela, e a pessoa vê o texto exato antes de enviar.

   Se um dia recriar o formulário: troque o id (o código entre
   /d/e/ e /viewform) e os números "entry." abaixo. Para achar
   os números, abra o formulário, F12 → Console e rode:
     FB_PUBLIC_LOAD_DATA_[1][1].map(q => [q[1], q[4][0][0]])
   ========================================================= */

/* ---------- 1. Configuração ---------- */
const FEEDBACK_FORM = window.PREGAO_FEEDBACK_FORM || {
  id: "1FAIpQLSdgV2mhrsxF9pXrI4mjJCuHYUUz6SoWcdh7rUM0_tPkrM6_lQ",
  fields: {
    tipo: "entry.1090213128",       // "Tipo" (Ideia / Problema / Elogio)
    mensagem: "entry.1187083978",   // "Mensagem"
    contato: "entry.2060438275",    // "Contato (opcional)"
    detalhes: "entry.776992108",    // "Detalhes técnicos"
  },
};
const FEEDBACK_REPO = "rafael26042007-max/pregao";  // caminho alternativo
const STORAGE_FB_QUEUE = "pregao.feedbackQueue";
const FB_MAX = 1500;            // caracteres por mensagem
const FB_COOLDOWN = 30 * 1000;  // intervalo mínimo entre envios (evita clique duplo e spam)
let fbLastSent = 0;

const FB_TYPES = {
  ideia:    { label: "Ideia",    emoji: "💡", hint: "O que faria o Pregão ficar melhor pra você?" },
  problema: { label: "Problema", emoji: "🐞", hint: "O que aconteceu? O que você esperava que acontecesse?" },
  elogio:   { label: "Elogio",   emoji: "💛", hint: "O que você mais gosta no Pregão?" },
};

/* ---------- 2. Detalhes técnicos (só o necessário pra achar um bug) ---------- */
function feedbackDetails() {
  const ua = navigator.userAgent;
  const browser = (ua.match(/(Edg|OPR|SamsungBrowser|Firefox|Chrome|Safari)\/[\d.]+/) || ["?"])[0];
  const so = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "?";
  const installed = matchMedia("(display-mode: standalone)").matches ? "app instalado" : "navegador";
  return `Versão ${APP_VERSION} · ${so} · ${browser} · ${installed} · tela ${screen.width}x${screen.height} · tema ${document.documentElement.dataset.theme === "light" ? "claro" : "escuro"} · moeda ${state.currency}`;
}

/* ---------- 3. Envio pelo Google Forms (e fila para quando estiver sem internet) ---------- */
async function postFeedback(item) {
  const f = FEEDBACK_FORM.fields;
  const body = new URLSearchParams();
  body.set(f.tipo, FB_TYPES[item.tipo]?.label || "Ideia");
  body.set(f.mensagem, item.mensagem);
  if (item.contato) body.set(f.contato, item.contato);
  if (item.detalhes) body.set(f.detalhes, item.detalhes);
  // no-cors: o Google recebe, mas o navegador não deixa ler a resposta.
  // Se a internet falhar, o fetch lança erro e caímos no catch de quem chamou.
  await fetch(`https://docs.google.com/forms/d/e/${encodeURIComponent(FEEDBACK_FORM.id)}/formResponse`, {
    method: "POST", mode: "no-cors", body,
  });
}

const getQueue = () => load(STORAGE_FB_QUEUE, []);
const setQueue = (q) => save(STORAGE_FB_QUEUE, q);

async function flushFeedbackQueue() {
  if (!navigator.onLine) return;
  const q = getQueue();
  if (!q.length) return;
  const rest = [];
  for (const item of q) {
    try { await postFeedback(item); } catch { rest.push(item); }
  }
  setQueue(rest);
  if (rest.length < q.length) toast("Seu feedback guardado foi enviado. Obrigado!");
  renderFbPending();
}

/* ---------- 4. Caminho alternativo: issue no GitHub ---------- */
function feedbackIssueUrl(tipo, mensagem, detalhes) {
  const t = FB_TYPES[tipo] || FB_TYPES.ideia;
  const resumo = mensagem.replace(/\s+/g, " ").slice(0, 60) + (mensagem.length > 60 ? "…" : "");
  const body = [
    `**Tipo:** ${t.label}`, "", mensagem,
    ...(detalhes ? ["", "---", `<sub>${detalhes}</sub>`] : []),
    "", "<sub>Enviado pelo botão de feedback do Pregão.</sub>",
  ].join("\n");
  const q = new URLSearchParams({ template: "feedback.md", title: `${t.emoji} [${t.label}] ${resumo}`, body });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${q}`;
}

function openGithubIssue(e) {
  e.preventDefault();
  const msg = $("#fb-msg").value.trim().slice(0, FB_MAX);
  const url = feedbackIssueUrl($("#fb-type").dataset.value || "ideia", msg || "(escreva aqui)", $("#fb-tech").checked ? feedbackDetails() : "");
  // sem "noopener" no 3º parâmetro: com ele o window.open SEMPRE devolve null
  const win = window.open(url, "_blank");
  if (win) win.opener = null;     // mesma proteção do noopener
  else location.href = url;       // bloqueador de pop-up: abre na mesma aba
}

/* ---------- 5. Tela ---------- */
function renderFbPending() {
  const n = getQueue().length;
  const el = $("#fb-pending");
  if (!el) return;
  el.hidden = !n;
  el.textContent = n === 1 ? "1 mensagem esperando internet para ser enviada." : `${n} mensagens esperando internet para serem enviadas.`;
}

function fbSetType(tipo) {
  $("#fb-type").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === tipo));
  $("#fb-type").dataset.value = tipo;
  $("#fb-msg").placeholder = FB_TYPES[tipo].hint;
}

function fbUpdateCount() {
  const n = $("#fb-msg").value.length;
  $("#fb-count").textContent = `${n}/${FB_MAX}`;
  $("#fb-send").disabled = $("#fb-msg").value.trim().length < 5;
}

async function sendFeedback(e) {
  e.preventDefault();
  const msg = $("#fb-msg").value.trim();
  if (msg.length < 5) return;
  const wait = FB_COOLDOWN - (Date.now() - fbLastSent);
  if (wait > 0) { toast(`Calma 🙂 Dá pra mandar outro em ${Math.ceil(wait / 1000)} s.`); return; }

  const item = {
    tipo: $("#fb-type").dataset.value || "ideia",
    mensagem: msg.slice(0, FB_MAX),
    contato: $("#fb-contact").value.trim().slice(0, 120),
    detalhes: $("#fb-tech").checked ? feedbackDetails() : "",
    quando: Date.now(),
  };

  const btn = $("#fb-send");
  btn.disabled = true; btn.textContent = "Enviando…";
  let sent = false;
  try {
    if (!navigator.onLine) throw new Error("offline");
    await postFeedback(item);
    sent = true;
  } catch {
    setQueue([...getQueue(), item]);   // guarda e manda depois
  }
  fbLastSent = Date.now();
  btn.textContent = "Enviar";

  // Limpa o formulário e mostra o "obrigado" (a mensagem já está segura: enviada ou na fila)
  $("#fb-msg").value = ""; $("#fb-contact").value = "";
  fbUpdateCount();
  const done = $("#fb-done");
  done.hidden = false;
  done.querySelector("b").textContent = sent ? "Recebido, obrigado! 💛" : "Sem internet agora, guardei sua mensagem.";
  done.querySelector("span").textContent = sent
    ? "O Rafael lê cada mensagem para decidir as próximas melhorias."
    : "Ela será enviada sozinha assim que a conexão voltar.";
  renderFbPending();
}

/* ---------- 6. Ligações com o app ---------- */
on("init", () => {
  $("#fb-type").innerHTML = Object.entries(FB_TYPES).map(([k, t]) => `<button type="button" data-v="${k}">${t.emoji} ${t.label}</button>`).join("");
  fbSetType("ideia");
  $("#fb-type").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) fbSetType(b.dataset.v); });

  $("#fb-msg").maxLength = FB_MAX;
  $("#fb-msg").addEventListener("input", () => { fbUpdateCount(); $("#fb-done").hidden = true; });
  fbUpdateCount();
  $("#fb-tech-see").addEventListener("toggle", () => { $("#fb-preview").textContent = feedbackDetails(); });
  $("#fb-form").addEventListener("submit", sendFeedback);
  $("#fb-github").addEventListener("click", openGithubIssue);

  // atalho no rodapé
  $("#footer-feedback").addEventListener("click", () => { openSettings(); showTab("feedback"); setTimeout(() => $("#fb-msg").focus(), 50); });

  renderFbPending();
  flushFeedbackQueue();
  addEventListener("online", flushFeedbackQueue);
});
