/* =========================================================
   Pregão — Banco de dados (SQLite no navegador)
   ---------------------------------------------------------
   Cada preço que chega vira uma linha numa tabela SQLite que
   fica NESTE aparelho (sem servidor). Com isso o Pregão mostra,
   por exemplo, a mínima e a máxima dos últimos 7 dias.

   Como funciona:
   - sql.js (js/vendor/sql-wasm.js + .wasm) é o SQLite de verdade,
     compilado para WebAssembly. O banco roda na memória da página.
   - Para não perder nada ao fechar, o arquivo inteiro do banco é
     salvo no IndexedDB do navegador ("pregao-banco"), alguns
     segundos depois de cada gravação e ao sair da página.
   - Só UMA aba grava (Web Locks), senão uma aba apagaria o que
     a outra salvou. As outras abas só leem.
   - Guarda no máximo 1 preço por ativo por minuto e apaga o que
     tiver mais de 30 dias.

   SEGURANÇA (importante para o teste de invasão):
   TODA consulta usa parâmetros "?" com bind(). O valor nunca é
   colado no texto do SQL, então um símbolo como
     x'); DROP TABLE precos; --
   é tratado como TEXTO, e não como comando.
   ========================================================= */

/* ---------- 1. Configuração ---------- */
const BANCO_IDB = "pregao-banco";          // nome do IndexedDB que guarda o arquivo
const BANCO_STORE = "arquivos";
const BANCO_ARQUIVO = "pregao.sqlite";
const RETENCAO_MS = 30 * 864e5;            // 30 dias
const MINUTO = 60 * 1000;

// Estrutura do banco. "user_version" diz qual versão da estrutura o arquivo tem.
const SCHEMA_VERSAO = 1;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS precos (
    simbolo TEXT    NOT NULL,   -- ex.: AAPL, PETR4.SA, BINANCE:BTCUSDT
    minuto  INTEGER NOT NULL,   -- hora do preço arredondada para o minuto (ms desde 1970)
    preco   REAL    NOT NULL,   -- na moeda original do ativo
    moeda   TEXT    NOT NULL,   -- BRL ou USD
    PRIMARY KEY (simbolo, minuto)
  ) WITHOUT ROWID;
  PRAGMA user_version = ${SCHEMA_VERSAO};
`;

const banco = {
  db: null,          // o banco SQLite aberto
  pronto: null,      // Promise de abertura (abre uma vez só)
  gravador: false,   // esta aba é a que grava?
  fila: [],          // preços esperando para entrar
  ultimo: new Map(), // simbolo → "minuto:preco" já gravado (evita repetir)
  salvarTimer: null,
  sujo: false,       // tem mudança ainda não salva no IndexedDB
};

/* ---------- 2. IndexedDB: onde o arquivo do banco fica guardado ---------- */
function idbAbrir() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(BANCO_IDB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(BANCO_STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}
async function idbLer(chave) {
  const idb = await idbAbrir();
  return new Promise((ok, erro) => {
    const req = idb.transaction(BANCO_STORE).objectStore(BANCO_STORE).get(chave);
    req.onsuccess = () => { idb.close(); ok(req.result); };
    req.onerror = () => { idb.close(); erro(req.error); };
  });
}
async function idbGravar(chave, valor) {
  const idb = await idbAbrir();
  return new Promise((ok, erro) => {
    const tx = idb.transaction(BANCO_STORE, "readwrite");
    tx.objectStore(BANCO_STORE).put(valor, chave);
    tx.oncomplete = () => { idb.close(); ok(); };
    tx.onerror = () => { idb.close(); erro(tx.error); };
  });
}
// Apaga o IndexedDB inteiro (usado em "Apagar meus dados")
function bancoApagarTudo() {
  return new Promise((ok) => {
    try { banco.db?.close(); } catch { /* já fechado */ }
    banco.db = null;
    const req = indexedDB.deleteDatabase(BANCO_IDB);
    req.onsuccess = req.onerror = req.onblocked = () => ok();
  });
}

/* ---------- 3. Abrir o SQLite ---------- */
function carregarSqlJs() {
  return new Promise((ok, erro) => {
    if (window.initSqlJs) return ok(window.initSqlJs);
    const s = document.createElement("script");
    s.src = "js/vendor/sql-wasm.js";
    s.onload = () => ok(window.initSqlJs);
    s.onerror = () => erro(new Error("Não deu para carregar o SQLite"));
    document.head.appendChild(s);
  });
}

function bancoAbrir() {
  if (banco.pronto) return banco.pronto;
  banco.pronto = (async () => {
    const initSqlJs = await carregarSqlJs();
    const SQL = await initSqlJs({ locateFile: (f) => `js/vendor/${f}` });
    let bytes = null;
    try { bytes = await idbLer(BANCO_ARQUIVO); } catch { /* navegador sem IndexedDB: banco só na memória */ }
    try {
      banco.db = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
      banco.db.exec(SCHEMA);
    } catch {
      // arquivo estragado: começa um banco novo em vez de travar o app
      banco.db = new SQL.Database();
      banco.db.exec(SCHEMA);
    }
    // limpeza: tira o que passou de 30 dias
    banco.db.run("DELETE FROM precos WHERE minuto < ?", [Date.now() - RETENCAO_MS]);
    return banco.db;
  })();
  banco.pronto.catch(() => { banco.pronto = null; });
  return banco.pronto;
}

/* ---------- 4. Consultas (sempre com parâmetros "?") ---------- */
// Executa um SELECT com parâmetros e devolve uma lista de objetos { coluna: valor }
function bancoConsultar(sql, params = []) {
  const stmt = banco.db.prepare(sql);
  try {
    stmt.bind(params);
    const linhas = [];
    while (stmt.step()) linhas.push(stmt.getAsObject());
    return linhas;
  } finally {
    stmt.free(); // libera a memória do comando preparado
  }
}

// Mínima, máxima e quantidade de preços de um ativo desde `desde` (ms)
async function bancoResumo(simbolo, desde) {
  await bancoAbrir();
  return bancoConsultar(
    `SELECT MIN(preco) AS minima, MAX(preco) AS maxima, COUNT(*) AS total, MIN(minuto) AS primeiro
       FROM precos
      WHERE simbolo = ? AND minuto >= ?`,
    [simbolo, desde],
  )[0];
}

// Números do banco inteiro (aba Dados e backup)
async function bancoEstatisticas() {
  await bancoAbrir();
  const [r] = bancoConsultar("SELECT COUNT(*) AS linhas, COUNT(DISTINCT simbolo) AS ativos, MIN(minuto) AS desde FROM precos");
  const [p] = bancoConsultar("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()");
  return { ...r, bytes: p.bytes };
}

/* ---------- 5. Gravar os preços ---------- */
function bancoAnotar(simbolo) {
  if (!banco.gravador) return;
  const r = state.data[simbolo];
  if (!r || r.price == null || !r.lastTs) return;
  const minuto = Math.floor(r.lastTs / MINUTO) * MINUTO;
  const marca = `${minuto}:${r.price}`;
  if (banco.ultimo.get(simbolo) === marca) return;   // nada mudou desde a última vez
  banco.ultimo.set(simbolo, marca);
  banco.fila.push([simbolo, minuto, r.price, currencyOf(simbolo)]);
  if (banco.fila.length === 1) setTimeout(bancoGravarFila, 2000); // junta vários preços numa gravação só
}

async function bancoGravarFila() {
  if (!banco.fila.length) return;
  await bancoAbrir();
  const lote = banco.fila.splice(0);
  // INSERT OR REPLACE: no mesmo minuto, fica o preço mais recente
  const stmt = banco.db.prepare("INSERT OR REPLACE INTO precos (simbolo, minuto, preco, moeda) VALUES (?, ?, ?, ?)");
  try {
    banco.db.exec("BEGIN");                 // transação: grava o lote inteiro de uma vez (bem mais rápido)
    for (const linha of lote) stmt.run(linha);
    banco.db.exec("COMMIT");
  } catch {
    try { banco.db.exec("ROLLBACK"); } catch { /* nada a desfazer */ }
  } finally {
    stmt.free();
  }
  bancoAgendarSalvar();
}

/* ---------- 6. Salvar o arquivo no IndexedDB ---------- */
function bancoAgendarSalvar() {
  banco.sujo = true;
  clearTimeout(banco.salvarTimer);
  banco.salvarTimer = setTimeout(bancoSalvar, 10000);
}
async function bancoSalvar() {
  clearTimeout(banco.salvarTimer);
  if (!banco.gravador || !banco.db || !banco.sujo || window.__pregaoFrozen) return;
  banco.sujo = false;
  try { await idbGravar(BANCO_ARQUIVO, banco.db.export()); }
  catch { banco.sujo = true; }              // tenta de novo na próxima
}

/* ---------- 7. Na tela: painel da ação ---------- */
async function renderBancoSecao(simbolo) {
  const box = $("#d-db");
  if (!box) return;
  box.innerHTML = "";
  if (state.preview) return;
  let r;
  try { r = await bancoResumo(simbolo, Date.now() - 7 * 864e5); } catch { return; }
  if (state.detail !== simbolo) return;      // o painel já mudou de ação
  const desde = r.primeiro ? new Date(r.primeiro).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
  box.innerHTML = r.total >= 2
    ? `<h4>Últimos 7 dias <span class="d-tag">neste aparelho</span></h4>
       <dl class="kv">
         <div><dt>Mínima</dt><dd>${esc(fmtPrice(r.minima, simbolo))}</dd></div>
         <div><dt>Máxima</dt><dd>${esc(fmtPrice(r.maxima, simbolo))}</dd></div>
       </dl>
       <p class="d-note">${r.total} preços guardados desde ${esc(desde)}.</p>`
    : `<h4>Últimos 7 dias <span class="d-tag">neste aparelho</span></h4>
       <p class="d-note">O Pregão começou a guardar os preços desta ação agora. Volte depois para ver a mínima e a máxima da semana.</p>`;
}

/* ---------- 8. Na tela: ⚙ → Dados e backup ---------- */
async function renderBancoConfig() {
  const el = $("#db-stats");
  if (!el) return;
  try {
    const e = await bancoEstatisticas();
    const kb = e.bytes / 1024;
    const tamanho = kb > 1024 ? `${(kb / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(kb))} KB`;
    el.textContent = e.linhas
      ? `${e.linhas.toLocaleString("pt-BR")} preços de ${e.ativos} ${e.ativos === 1 ? "ativo" : "ativos"} · ${tamanho} · desde ${new Date(e.desde).toLocaleDateString("pt-BR")}`
      : "Ainda vazio: os preços entram aqui conforme chegam.";
  } catch {
    el.textContent = "Não deu para abrir o banco neste navegador.";
  }
}

// Baixa o arquivo .sqlite (abre no "DB Browser for SQLite", por exemplo)
async function bancoBaixar() {
  await bancoAbrir();
  await bancoGravarFila();
  const blob = new Blob([banco.db.export()], { type: "application/vnd.sqlite3" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pregao-${new Date().toISOString().slice(0, 10)}.sqlite`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function bancoLimparHistorico() {
  await bancoAbrir();
  banco.fila.length = 0;
  banco.ultimo.clear();
  banco.db.run("DELETE FROM precos");
  banco.db.run("VACUUM");                    // devolve o espaço
  banco.sujo = true;
  await bancoSalvar();
  toast("Histórico de preços apagado.");
  renderBancoConfig();
}

/* ---------- 9. Ligações com o app ---------- */
on("init", () => {
  // Quem grava: a primeira aba que pegar a trava. Ela segura até fechar.
  if (navigator.locks) {
    navigator.locks.request("pregao-banco", { ifAvailable: true }, (lock) => {
      if (!lock) return;                      // outra aba já grava
      banco.gravador = true;
      return new Promise(() => {});           // segura a trava enquanto a aba existir
    });
  } else banco.gravador = true;

  // Abre o banco sem atrapalhar o começo do app
  setTimeout(() => bancoAbrir().catch(() => {}), 1500);

  // Salva ao sair ou ao esconder a aba (no celular, a aba pode ser fechada a qualquer momento)
  addEventListener("pagehide", () => { bancoGravarFila().then(bancoSalvar); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") bancoGravarFila().then(bancoSalvar);
  });

  $("#db-download").addEventListener("click", () => bancoBaixar().catch(() => toast("Não deu para baixar o banco.")));
  armResetButton($("#db-clear"), "Apagar histórico", bancoLimparHistorico);
});
on("price", bancoAnotar);
on("detailOpen", renderBancoSecao);
on("settingsTab", (tab) => { if (tab === "data") renderBancoConfig(); });
