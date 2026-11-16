/* =========================================================
   Pregão — Privacidade
   ---------------------------------------------------------
   O Pregão NÃO usa cookies, rastreamento, anúncios nem
   contador de visitas. Ele só guarda no próprio aparelho
   (localStorage, chaves "pregao.*") o que precisa para
   funcionar: lista, carteira, alertas, chaves de API e
   preferências. Por isso não existe "Aceitar / Recusar":
   recusar não teria o que desligar.

   1. Aviso na 1ª visita (faixa embaixo, "Entendi").
   2. Aba ⚙ → Privacidade: o que fica guardado, para onde vão
      os pedidos e o botão "Apagar meus dados deste aparelho"
      (o mesmo "Apagar tudo" de Dados e backup).
   ========================================================= */

const STORAGE_PRIVACY = "pregao.privacyOk";

/* ---------- 1. Aviso na primeira visita ---------- */
function showPrivacyBanner() {
  if (load(STORAGE_PRIVACY, false)) return;
  const bar = $("#privacy-banner");

  // Espera o guia de primeiros passos fechar, para não empilhar duas coisas na tela
  const tryShow = () => {
    if (!$("#welcome-overlay").hidden) return setTimeout(tryShow, 800);
    // Se a faixa do modo demonstração estiver embaixo, fica logo acima dela
    const demo = $("#demo-banner");
    bar.style.bottom = demo && !demo.hidden ? `${demo.offsetHeight + 30}px` : "";
    bar.hidden = false;
  };
  setTimeout(tryShow, 900);
}

function closePrivacyBanner() {
  $("#privacy-banner").hidden = true;
  save(STORAGE_PRIVACY, true);
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
