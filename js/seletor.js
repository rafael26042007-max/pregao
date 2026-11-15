/* =========================================================
   Pregão — seletor em gaveta para o celular
   ---------------------------------------------------------
   No celular, tocar em qualquer <select> abre uma gaveta que
   sobe de baixo, com as cores do tema do Pregão, em vez da
   lista nativa do Android/iOS (que usa as cores do sistema e
   o CSS não alcança).

   - Só liga em tela de toque (pointer: coarse). No PC, com
     mouse e teclado, o <select> nativo continua igual.
   - O <select> original continua sendo a fonte da verdade:
     a gaveta só muda select.value e dispara "change", então
     o resto do código não precisa saber que ela existe.
   - Funciona também com <select> criados depois (ex.: o tipo
     de alerta no painel), porque escuta o documento inteiro.
   - Botão "voltar" do Android fecha a gaveta.

   Atributos opcionais no HTML:
     <select data-title="Título da gaveta">
     <option data-hint="Texto menor embaixo">
   ========================================================= */
(() => {
  "use strict";

  const touch = matchMedia("(pointer: coarse)");
  let open = null; // { sel, overlay, pushed }

  /* ---------- 1. Título da gaveta ---------- */
  function titleOf(sel) {
    if (sel.dataset.title) return sel.dataset.title;
    const row = sel.closest(".set-row");
    if (row?.querySelector("b")) return row.querySelector("b").textContent.trim();
    const lab = sel.closest("label");
    if (lab) return lab.textContent.replace(sel.textContent, "").replace(/:\s*$/, "").trim();
    return sel.getAttribute("aria-label") || "Escolha uma opção";
  }

  /* ---------- 2. Abrir ---------- */
  function openSheet(sel) {
    if (open) closeSheet();
    const overlay = document.createElement("div");
    overlay.className = "sheet-overlay";
    const titleId = "sheet-title-" + Date.now();
    overlay.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="sheet-handle" aria-hidden="true"></div>
        <h3 class="sheet-title" id="${titleId}"></h3>
        <ul class="sheet-list" role="listbox"></ul>
      </div>`;
    overlay.querySelector(".sheet-title").textContent = titleOf(sel);

    const list = overlay.querySelector(".sheet-list");
    [...sel.options].forEach((opt) => {
      if (opt.hidden) return;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-opt";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", String(opt.value === sel.value));
      btn.disabled = opt.disabled;
      btn.dataset.value = opt.value;
      btn.innerHTML = `<span class="sheet-txt"><span class="sheet-label"></span>${opt.dataset.hint ? '<small class="sheet-hint"></small>' : ""}</span><span class="sheet-check" aria-hidden="true">✓</span>`;
      btn.querySelector(".sheet-label").textContent = opt.textContent;
      if (opt.dataset.hint) btn.querySelector(".sheet-hint").textContent = opt.dataset.hint;
      li.appendChild(btn);
      list.appendChild(li);
    });

    // Escolher uma opção
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".sheet-opt");
      if (!btn || btn.disabled) return;
      const changed = sel.value !== btn.dataset.value;
      sel.value = btn.dataset.value;
      closeSheet();
      if (changed) sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Tocar fora fecha
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSheet(); });

    document.body.appendChild(overlay);
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => overlay.classList.add("show"));

    // Rola até a opção marcada e põe o foco nela (acessibilidade)
    const cur = list.querySelector('[aria-selected="true"]') || list.querySelector(".sheet-opt");
    cur?.scrollIntoView({ block: "center" });
    cur?.focus({ preventScroll: true });

    // Botão "voltar" do Android: entra uma etapa no histórico que a gaveta consome
    let pushed = false;
    try { history.pushState({ pregaoSheet: true }, ""); pushed = true; } catch { /* sem histórico: tudo bem */ }
    open = { sel, overlay, pushed };
  }

  /* ---------- 3. Fechar ---------- */
  function closeSheet(fromBack = false) {
    if (!open) return;
    const { sel, overlay, pushed } = open;
    open = null;
    overlay.classList.remove("show");
    document.body.classList.remove("sheet-open");
    setTimeout(() => overlay.remove(), 220);
    if (pushed && !fromBack) history.back(); // tira a etapa que a gaveta tinha colocado
    sel.focus({ preventScroll: true });
  }

  addEventListener("popstate", () => { if (open) closeSheet(true); });
  addEventListener("keydown", (e) => { if (open && e.key === "Escape") { e.preventDefault(); closeSheet(); } });

  /* ---------- 4. Interceptar o toque no <select> ----------
     No celular os <select> ficam com pointer-events: none (CSS, body.touch-selects),
     então o toque cai no elemento de trás e o Android não abre a lista nativa.
     Aqui descobrimos, pela posição do dedo, em qual <select> a pessoa tocou. */
  function selectAt(x, y) {
    for (const sel of document.querySelectorAll("select")) {
      if (sel.disabled || !sel.offsetParent) continue; // escondido
      const r = sel.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return sel;
    }
    return null;
  }

  document.addEventListener("click", (e) => {
    if (!touch.matches || open || e.detail === 0) return; // e.detail 0 = "clique" de teclado
    const sel = selectAt(e.clientX, e.clientY);
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    openSheet(sel);
  }, true);

  /* ---------- 5. Liga/desliga conforme o tipo de tela ---------- */
  const apply = () => document.body.classList.toggle("touch-selects", touch.matches);
  apply();
  touch.addEventListener?.("change", apply);

  // Para testes e para outros arquivos, se precisarem
  window.pregaoSheet = { open: openSheet, close: () => closeSheet() };
})();
