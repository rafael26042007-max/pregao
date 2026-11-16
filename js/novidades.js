/* =========================================================
   NOVIDADES DA VERSÃO
   ---------------------------------------------------------
   • Quando o Pregão é atualizado, mostra uma janela com o que
     mudou desde a última vez que a pessoa abriu o app.
   • Só entra o que importa para quem USA: nada de "refatorei",
     "testes", "corrigi variável". Escreva como se falasse com
     um amigo que não programa.
   • Pessoa nova (primeira visita) não vê: o guia de boas-vindas
     já apresenta tudo.
   • Se uma versão nova for publicada com o app aberto, aparece
     a faixa "Nova versão pronta · Atualizar".

   COMO LANÇAR UMA VERSÃO NOVA
   1. Adicione um item NO TOPO de CHANGELOG (versão, data, mudanças).
   2. Em sw.js, troque CACHE para "pregao-v" + a mesma versão.
      (o teste automático confere se os dois batem)
   3. git push. Os testes rodam e, se passarem, o site é publicado.
   ========================================================= */
"use strict";

/* ---------- 1. Histórico (o primeiro é a versão atual) ---------- */
const CHANGELOG = [
  {
    version: "3.0",
    date: "2026-11-16",
    items: [
      ["📷", "Passe tudo para outro aparelho por QR code: lista, carteira, alertas e chaves. O aparelho novo já sai configurado, sem o passo a passo."],
      ["🔁", "Funciona nos dois sentidos: mostre o QR no PC e leia com a câmera do celular, ou o contrário (⚙ → Dados e backup)."],
      ["✅", "Se o aparelho já tiver os mesmos dados, ele só avisa. Se tiver diferenças, mostra o que entra e o que sai antes de atualizar."],
    ],
  },
  {
    version: "2.9",
    date: "2026-11-16",
    items: [
      ["🖥️", "Em janelas estreitas e tablets, o botão de Configurações não fica mais cortado no topo."],
      ["📈", "Os gráficos de 1 e 3 meses agora terminam no preço de agora."],
      ["💼", "Filtro vazio explica o que fazer, por exemplo como colocar uma ação na carteira."],
      ["🧹", "O aviso de privacidade não aparece mais junto com a janela de novidades."],
    ],
  },
  {
    version: "2.8",
    date: "2026-11-16",
    items: [
      ["🍪", "Aviso de privacidade: o Pregão não usa cookies nem rastreamento. Quem ainda não configurou a própria chave vê o aviso a cada visita."],
      ["🔒", "Nova aba Privacidade: veja o que o Pregão guarda neste aparelho e para onde vão os pedidos."],
      ["🧹", "Usou num computador compartilhado? Em Privacidade, \"Apagar meus dados deste aparelho\" apaga lista, carteira, alertas e chaves."],
    ],
  },
  {
    version: "2.7",
    date: "2026-11-15",
    items: [
      ["✅", "As novidades agora só aparecem depois que a atualização termina de instalar, e não antes."],
    ],
  },
  {
    version: "2.6",
    date: "2026-11-15",
    items: [
      ["🔒", "O feedback agora é privado e não precisa de conta: é só escrever e tocar em Enviar."],
      ["📶", "Sem internet? A mensagem fica guardada e é enviada sozinha quando a conexão voltar."],
    ],
  },
  {
    version: "2.5",
    date: "2026-11-15",
    items: [
      ["💬", "Agora dá para mandar ideias, problemas e elogios direto pelo app: ⚙ Configurações → Feedback, ou \"Enviar feedback\" no rodapé."],
    ],
  },
  {
    version: "2.4",
    date: "2026-11-15",
    items: [
      ["🎨", "No celular, as listas de opções (moeda, ordem da lista, tempo de atualização, tipo de alerta) agora abrem numa gaveta com as cores do Pregão."],
      ["💱", "A escolha de moeda mostra o nome de cada uma: Real brasileiro, Dólar americano, Euro…"],
      ["↩️", "O botão voltar do celular fecha a gaveta de opções sem sair da tela."],
    ],
  },
  {
    version: "2.3",
    date: "2026-11-15",
    items: [
      ["📱", "No celular, a variação do dia no painel da ação não fica mais cortada na borda da tela."],
      ["🕒", "Quando o último preço não é de hoje (fim de semana, feriado), agora aparece o dia junto com a hora."],
    ],
  },
  {
    version: "2.2",
    date: "2026-11-13",
    items: [
      ["✨", "Agora você vê aqui o que mudou a cada atualização do Pregão."],
      ["⚡", "Mais estável com listas grandes: com muitas ações dos EUA, os preços não param mais de atualizar."],
      ["🔒", "Os links de notícias e dos sites das empresas ficaram mais seguros."],
    ],
  },
  {
    version: "2.1",
    date: "2026-11-12",
    items: [
      ["🧭", "Guia de primeiros passos e modo demonstração: dá para usar sem criar conta."],
      ["⤓", "Botão Baixar app no celular e no computador, com QR code."],
      ["🔑", "Ficou fácil achar sua chave de acesso e trazer seus dados de outro aparelho."],
      ["📱", "Topo da tela ajustado no celular."],
    ],
  },
  {
    version: "2.0",
    date: "2026-11-12",
    items: [
      ["🔔", "Alertas de preço com aviso, som e notificação."],
      ["💼", "Minha carteira: quanto você ganhou ou perdeu, no dia e no total."],
      ["↕", "Filtre, ordene e arraste os ativos da sua lista."],
      ["📰", "Notícias e indicadores de cada empresa."],
      ["☀", "Tema claro e app instalável."],
    ],
  },
];

const APP_VERSION_NUMBER = CHANGELOG[0].version;
const APP_VERSION = `${APP_VERSION_NUMBER} · ${new Date(CHANGELOG[0].date + "T12:00:00")
  .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
const STORAGE_SEEN = "pregao.seenVersion";

// "2.10" > "2.9" (compara número por número)
function versionGt(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/* ---------- 2. Janela de novidades ---------- */
function renderChangelog(entries, title) {
  $("#news-title").textContent = title;
  $("#news-body").innerHTML = entries.map((e) => `
    <div class="nv-version">
      <div class="nv-head">
        <span class="nv-badge">versão ${esc(e.version)}</span>
        <span class="muted small">${new Date(e.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
      </div>
      <ul class="nv-list">${e.items.map(([icon, text]) => `<li><span class="nv-ico">${icon}</span><span>${esc(text)}</span></li>`).join("")}</ul>
    </div>`).join("");
  $("#news-overlay").hidden = false;
}

function closeNews() {
  $("#news-overlay").hidden = true;
  save(STORAGE_SEEN, APP_VERSION_NUMBER); // só marca como visto depois de fechar
}

function showAllNews() { renderChangelog(CHANGELOG, "Histórico de novidades"); }

/* ---------- 3. Decide se mostra ao abrir ---------- */
// Lido AGORA, antes do app iniciar e salvar qualquer coisa: a pessoa já usava o Pregão?
const WAS_RETURNING_USER = ["pregao.watchlist", "pregao.config", "pregao.prefs", "pregao.theme"].some((k) => {
  try { return localStorage.getItem(k) !== null; } catch { return false; }
});

function checkWhatsNew() {
  let seen = load(STORAGE_SEEN, null);
  if (seen === null) {
    // Quem já usava antes deste recurso tem dados salvos: considera que viu a 2.1
    if (!WAS_RETURNING_USER) { save(STORAGE_SEEN, APP_VERSION_NUMBER); return; } // pessoa nova
    seen = "2.1";
  }
  const fresh = CHANGELOG.filter((e) => versionGt(e.version, seen));
  if (!fresh.length) return;

  const show = () => renderChangelog(fresh, fresh.length === 1 ? "O que há de novo" : "O que mudou desde a sua última visita");
  // Espera o guia de primeiros passos fechar, se estiver aberto
  const waitWizard = () => ($("#welcome-overlay").hidden ? show() : setTimeout(waitWizard, 800));

  // [ALTERADO] Só mostra depois que a atualização terminou de instalar.
  // Se o instalador ainda é o da versão antiga, fica esperando: quando o novo assumir
  // (bloco 4, "controllerchange"), ele chama pendingNews e a janela aparece.
  installedVersion().then((v) => {
    if (v === null || v === APP_VERSION_NUMBER) setTimeout(waitWizard, 600);
    else {
      pendingNews = waitWizard;
      navigator.serviceWorker?.getRegistration().then((r) => r && r.update()).catch(() => {}); // apressa a instalação
    }
  });
}

/* ---------- 4. Instalação da atualização ----------
   O "instalador" do app é o service worker (sw.js). A página é sempre baixada nova
   da internet, mas o instalador demora alguns segundos para se atualizar.
   Por isso a página pergunta a ele qual versão já está instalada:
   - igual à da página → instalação concluída: pode mostrar as novidades;
   - mais antiga (ou o instalador antigo nem sabe responder) → espera ele trocar;
   - mais nova → esta página está velha: mostra a faixa "Atualizar". */
let pendingNews = null; // novidades esperando a instalação terminar

function installedVersion() {
  if (window.__pregaoSwProbe) return window.__pregaoSwProbe();              // só nos testes
  const sw = "serviceWorker" in navigator && location.protocol.startsWith("http") && navigator.serviceWorker.controller;
  if (!sw) return Promise.resolve(null);  // sem instalador (1ª visita ou navegador sem suporte): nada a esperar
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve("?"), 1500);                     // instalador antigo não responde
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(String(e.data)); };
    sw.postMessage({ type: "version" }, [ch.port2]);
  });
}

function watchForUpdates() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  // [ALTERADO] O instalador novo assumiu: vê se ele é desta página ou de uma mais nova
  navigator.serviceWorker.addEventListener("controllerchange", async () => {
    const v = await installedVersion();
    if (v === APP_VERSION_NUMBER) {
      // a página já é a versão nova: instalação concluída, sem faixa de "Atualizar"
      $("#update-banner").hidden = true;
      if (pendingNews) { const show = pendingNews; pendingNews = null; setTimeout(show, 300); }
    } else if (v && v !== "?" && versionGt(v, APP_VERSION_NUMBER)) {
      $("#update-banner").hidden = false; // publicaram outra versão com o app aberto
    }
  });
  // Procura versão nova a cada 30 min e ao voltar para o app
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  setInterval(check, 30 * 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

/* ---------- 5. Ligações com o app ---------- */
on("init", () => {
  $("#news-close").addEventListener("click", closeNews);
  $("#news-ok").addEventListener("click", closeNews);
  $("#news-overlay").addEventListener("click", (e) => { if (e.target.id === "news-overlay") closeNews(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#news-overlay").hidden) closeNews(); });
  $("#update-reload").addEventListener("click", () => location.reload());
  $("#update-later").addEventListener("click", () => ($("#update-banner").hidden = true));
  const all = $("#show-news");
  if (all) all.addEventListener("click", () => { closeSettings(); showAllNews(); });

  checkWhatsNew();
  watchForUpdates();
});
