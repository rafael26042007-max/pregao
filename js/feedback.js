/* =========================================================
   Pregão — Feedback (⚙ Configurações → aba "Feedback")
   ---------------------------------------------------------
   Quem usa o app escreve uma ideia, um problema ou um elogio.
   Ao tocar em "Continuar no GitHub", abre a página de nova
   issue do repositório com título e texto já preenchidos:
   a pessoa só confere e toca em "Create" / "Submit".

   Por que GitHub Issues:
   - O Pregão não tem servidor; o GitHub guarda, numera e avisa
     o Rafael por e-mail de cada issue nova.
   - Fica público e a pessoa precisa de conta no GitHub (grátis).
     Por isso a tela avisa para não escrever dados pessoais e
     não existe campo de e-mail.
   - O modelo .github/ISSUE_TEMPLATE/feedback.md põe a etiqueta
     "feedback" sozinho, para filtrar fácil na aba Issues.

   NUNCA vão junto: chaves de API, carteira ou lista de ações.
   Os "detalhes técnicos" são só versão, sistema, navegador e
   tela, e a pessoa vê o texto exato antes de enviar.
   ========================================================= */

/* ---------- 1. Configuração ---------- */
const FEEDBACK_REPO = "rafael26042007-max/pregao";
const FB_MAX = 1500;            // caracteres por mensagem (a URL tem limite de tamanho)

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

/* ---------- 3. Monta o link da issue ---------- */
function feedbackIssueUrl(tipo, mensagem, detalhes) {
  const t = FB_TYPES[tipo] || FB_TYPES.ideia;
  const resumo = mensagem.replace(/\s+/g, " ").slice(0, 60) + (mensagem.length > 60 ? "…" : "");
  const title = `${t.emoji} [${t.label}] ${resumo}`;
  const body = [
    `**Tipo:** ${t.label}`,
    "",
    mensagem,
    ...(detalhes ? ["", "---", `<sub>${detalhes}</sub>`] : []),
    "",
    "<sub>Enviado pelo botão de feedback do Pregão.</sub>",
  ].join("\n");
  const q = new URLSearchParams({ template: "feedback.md", title, body });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${q}`;
}

/* ---------- 4. Tela ---------- */
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

function sendFeedback(e) {
  e.preventDefault();
  const msg = $("#fb-msg").value.trim().slice(0, FB_MAX);
  if (msg.length < 5) return;
  if (!navigator.onLine) { toast("Sem internet agora. Sua mensagem continua aqui, tente de novo quando a conexão voltar."); return; }

  const url = feedbackIssueUrl($("#fb-type").dataset.value || "ideia", msg, $("#fb-tech").checked ? feedbackDetails() : "");
  // [CORRIGIDO] sem "noopener" no 3º parâmetro: com ele o window.open SEMPRE devolve null
  const win = window.open(url, "_blank");
  if (win) win.opener = null;     // mesma proteção do noopener: o GitHub não consegue mexer nesta aba
  else location.href = url;       // bloqueador de pop-up: abre na mesma aba

  // Não apaga o texto: se a pessoa desistir no GitHub, ele continua aqui
  const done = $("#fb-done");
  done.hidden = false;
  done.querySelector("b").textContent = "Abrimos o GitHub com sua mensagem pronta 💛";
  done.querySelector("span").textContent = "Confira e toque em \"Create\" (ou \"Submit new issue\") para enviar. Depois disso, pode apagar o texto daqui.";
}

/* ---------- 5. Ligações com o app ---------- */
on("init", () => {
  document.querySelectorAll("[data-needs-feedback]").forEach((el) => (el.hidden = false));

  $("#fb-type").innerHTML = Object.entries(FB_TYPES).map(([k, t]) => `<button type="button" data-v="${k}">${t.emoji} ${t.label}</button>`).join("");
  fbSetType("ideia");
  $("#fb-type").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) fbSetType(b.dataset.v); });

  $("#fb-msg").maxLength = FB_MAX;
  $("#fb-msg").addEventListener("input", () => { fbUpdateCount(); $("#fb-done").hidden = true; });
  fbUpdateCount();
  $("#fb-tech-see").addEventListener("toggle", () => { $("#fb-preview").textContent = feedbackDetails(); });
  $("#fb-form").addEventListener("submit", sendFeedback);

  // atalho no rodapé
  $("#footer-feedback").addEventListener("click", () => { openSettings(); showTab("feedback"); setTimeout(() => $("#fb-msg").focus(), 50); });
});
