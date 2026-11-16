/* =========================================================
   Pregão — Privacidade
   ---------------------------------------------------------
   O Pregão NÃO usa cookies, rastreamento, anúncios nem
   contador de visitas. Ele só guarda no próprio aparelho
   (localStorage, chaves "pregao.*") o que precisa para
   funcionar: lista, carteira, alertas, chaves de API e
   preferências. Por isso não existe "Aceitar / Recusar":
   recusar não teria o que desligar.

   1. Aviso (faixa embaixo, "Entendi"):
      - quem ainda NÃO configurou a própria chave (visitante,
        modo demonstração) vê toda vez que abre o app;
      - quem já configurou vê uma vez; depois do "Entendi",
        não aparece mais.
   2. Aba ⚙ → Privacidade: o que fica guardado, para onde vão
      os pedidos e o botão "Apagar meus dados deste aparelho"
      (o mesmo "Apagar tudo" de Dados e backup).
   ========================================================= */

const STORAGE_PRIVACY = "pregao.privacyOk";       // localStorage: quem tem chave já viu
const SESSION_PRIVACY = "pregao.privacySeenNow";  // sessionStorage: já viu nesta visita (some ao fechar a aba)

// [ALTERADO] "Cadastrado" = já configurou a própria chave da Finnhub (isDemo vem de boas-vindas.js)
const isRegistered = () => !isDemo();

/* ---------- 1. Aviso ---------- */
function showPrivacyBanner() {
  if (sessionStorage.getItem(SESSION_PRIVACY)) return;                 // já viu nesta visita
  if (isRegistered() && load(STORAGE_PRIVACY, false)) return;          // tem chave e já disse "Entendi"
  const bar = $("#privacy-banner");

  // Espera o guia de primeiros passos fechar, para não empilhar duas coisas na tela
  const tryShow = () => {
    if (!$("#welcome-overlay").hidden) return setTimeout(tryShow, 800);
    if (!$("#news-overlay").hidden) return setTimeout(tryShow, 800);   // [CORRIGIDO] não aparece junto com "O que há de novo"
    // Se a faixa do modo demonstração estiver embaixo, fica logo acima dela
    const demo = $("#demo-banner");
    bar.style.bottom = demo && !demo.hidden ? `${demo.offsetHeight + 30}px` : "";
    bar.hidden = false;
  };
  setTimeout(tryShow, 900);
}

function closePrivacyBanner() {
  $("#privacy-banner").hidden = true;
  sessionStorage.setItem(SESSION_PRIVACY, "1");                        // não volta nesta visita
  if (isRegistered()) save(STORAGE_PRIVACY, true);                     // [ALTERADO] só quem tem chave não vê mais
}

/* ---------- 2. Ligações com o app ---------- */
on("init", () => {
  $("#privacy-ok").addEventListener("click", closePrivacyBanner);
  $("#privacy-more").addEventListener("click", () => {
    closePrivacyBanner();
    openSettings();
    showTab("privacy");
  });
  // "Apagar meus dados" usa a mesma confirmação em dois cliques do "Apagar tudo"
  armResetButton($("#privacy-reset"), "Apagar meus dados deste aparelho");
  showPrivacyBanner();
});
