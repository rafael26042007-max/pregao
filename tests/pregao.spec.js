// =========================================================
// TESTES AUTOMÁTICOS DO PREGÃO
// ---------------------------------------------------------
// Rodam sozinhos no GitHub a cada git push. Se algum falhar,
// o site NÃO é publicado e o GitHub avisa por e-mail.
// Cada teste confere uma coisa que o usuário faz ou vê.
// =========================================================
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setup } = require("./dubles");

const root = path.join(__dirname, "..");
const US15 = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX", "AMD", "INTC", "KO", "PEP", "DIS", "NKE", "JPM"];

// Fecha qualquer janela (guia, novidades) que esteja aberta na frente
async function closeOverlays(page) {
  await page.evaluate(() => document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)));
}

/* ---------------- 1. Básico ---------------- */

test("abre sem erros e mostra a lista padrão", async ({ page }) => {
  const errors = await setup(page);
  await page.goto("/index.html");
  await expect(page.locator(".card")).toHaveCount(5);
  await expect(page.locator(".card-sym").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("preço ao vivo: selo AO VIVO e o preço muda sozinho", async ({ page }) => {
  await setup(page);
  await page.goto("/index.html");
  const card = page.locator(".card", { has: page.locator(".card-sym", { hasText: /^NVDA$/ }) });
  await expect(card.locator(".badge")).toHaveText("AO VIVO");
  const before = await card.locator(".card-price").textContent();
  await expect(card.locator(".card-price")).not.toHaveText(before, { timeout: 5000 });
});

/* ---------------- 2. Busca e prévia ---------------- */

test("busca mostra preço, abre a prévia e adiciona pela prévia", async ({ page }) => {
  await setup(page);
  await page.goto("/index.html");
  await page.fill("#search-input", "amazon");
  const row = page.locator("#search-results li[data-i]", { hasText: "AMZN" });
  await expect(row.locator(".r-price")).toBeVisible();
  await row.locator(".r-name").click();
  await expect(page.locator("#d-preview-tag")).toBeVisible();
  await expect(page.locator("#d-action")).toHaveText(/Adicionar/);
  await page.click("#d-action");
  await expect(page.locator("#d-action")).toHaveText(/Remover/);
  await expect(page.locator(".card-sym", { hasText: /^AMZN$/ })).toBeVisible();
});

/* ---------------- 3. Moeda ---------------- */

test("seletor de moeda converte dólar para real", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await expect(page.locator(".card-price")).toContainText("US$");
  await page.selectOption("#currency-select", "BRL");
  await expect(page.locator(".card-price")).toContainText("R$");            // 415,30 × 5 = 2.076,50
  await expect(page.locator(".card-price")).toContainText("2.076,50");
});

/* ---------------- 4. Alertas e carteira ---------------- */

test("alerta dispara quando o preço passa do valor", async ({ page }) => {
  await setup(page, { list: ["NVDA"] });
  await page.goto("/index.html");
  await page.locator(".card").first().click();
  const price = await page.evaluate(() => state.data.NVDA.price);
  await page.fill("#alert-value", (price * 1.002).toFixed(4));               // 0,2% acima: sobe em ~1 s
  await page.click("#alert-form button");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pregao.alerts")).NVDA[0].active), { timeout: 8000 }).toBe(false);
  await expect(page.locator("#toast")).toContainText("NVDA");
});

test("carteira: posição salva aparece no resumo do topo", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await page.locator(".card").first().click();
  await page.fill("#pos-qty", "10");
  await page.fill("#pos-avg", "400");
  await page.click("#pos-form button");
  await closeOverlays(page);
  await expect(page.locator("#portfolio-summary")).toBeVisible();
  await expect(page.locator("#portfolio-summary")).toContainText("Valor atual");
});

/* ---------------- 5. Limites das APIs ---------------- */

test("brapi: nunca dois pedidos ao mesmo tempo (evita o erro 429)", async ({ page }) => {
  await setup(page, { list: ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "MGLU3.SA"], brapiConcurrency429: true });
  await page.goto("/index.html");
  await page.waitForTimeout(9000);
  const c = await page.evaluate(() => window.__calls);
  expect(c.brapi).toBeGreaterThan(3);
  expect(c.brapiMax).toBe(1);
  expect(c.brapi429).toBe(0);
});

test("Finnhub: fica abaixo de 60 pedidos/min com 15 ações e o ao vivo caído", async ({ page }) => {
  await page.clock.install();
  await setup(page, { list: US15, wsFails: true });
  await page.goto("/index.html");
  await page.clock.runFor(60_000);                                            // 1º minuto: carga inicial
  const start = await page.evaluate(() => window.__calls.finnhub.length);
  await page.clock.runFor(60_000);                                            // 2º minuto: regime normal
  const perMinute = (await page.evaluate(() => window.__calls.finnhub.length)) - start;
  expect(perMinute).toBeGreaterThan(10);                                      // continua atualizando
  expect(perMinute).toBeLessThanOrEqual(55);                                  // e respeita o limite
});

/* ---------------- 6. Segurança ---------------- */

test("links 'javascript:' vindos das APIs são bloqueados", async ({ page }) => {
  await setup(page, { list: ["MSFT"], evilLinks: true });
  await page.goto("/index.html");
  await page.locator(".card").first().click();
  await expect(page.locator(".news-list li").first()).toBeVisible();
  const hrefs = await page.$$eval("#detail-overlay a", (as) => as.map((a) => a.getAttribute("href") || ""));
  expect(hrefs.some((h) => h.trim().toLowerCase().startsWith("javascript:"))).toBe(false);
  await expect(page.locator(".news-list li")).toHaveCount(1);                 // a notícia perigosa some
});

/* ---------------- 7. Primeiros passos e backup ---------------- */

test("sem chave: o guia abre e chave errada não passa do passo 1", async ({ page }) => {
  await setup(page, { keys: false });
  await page.goto("/index.html");
  await expect(page.locator("#welcome-overlay")).toBeVisible();
  await page.click("[data-go='1']");
  await page.fill("#wz-finnhub", "errada");
  await page.click("#wz-finnhub-next");
  await expect(page.locator("#wz-finnhub-status")).toContainText("inválida");
  await expect(page.locator(".wz-step[data-step='1']")).toBeVisible();
});

test("importar backup sem chaves mantém as chaves que já estavam", async ({ page }) => {
  await setup(page, { keys: { finnhubKey: "minha-chave" } });
  await page.goto("/index.html");
  // caminho sem acentos: o envio de arquivo do navegador de teste falha com acento no caminho
  const file = path.join(os.tmpdir(), `pregao-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: "pregao", version: "2.2", data: { "pregao.watchlist": [{ symbol: "MSFT", name: "Microsoft" }] } }));
  await closeOverlays(page);
  await page.evaluate(() => (window.__beforeImport = true));
  await page.setInputFiles("#set-import", file);
  // importar recarrega a página: espera a página nova (sem a marca) aparecer
  await expect.poll(() => page.evaluate(() => !window.__beforeImport).catch(() => false), { timeout: 10_000 }).toBe(true);
  await expect(page.locator(".card-sym")).toHaveText(["MSFT"], { timeout: 10_000 }); // a lista do backup chegou
  expect(await page.evaluate(() => state.config.finnhubKey)).toBe("minha-chave"); // e a chave continuou
});

/* ---------------- 8. Novidades da versão ---------------- */

test("novidades: quem já usava vê o que mudou; quem é novo não vê", async ({ browser }) => {
  // quem já usava (tem dados salvos de antes)
  const old = await browser.newPage();
  await setup(old, { storage: { "pregao.seenVersion": "2.1" } });
  await old.goto("/index.html");
  await expect(old.locator("#news-overlay")).toBeVisible();
  await expect(old.locator("#news-body")).toContainText("versão");
  await old.click("#news-ok");
  await old.reload();
  await old.waitForTimeout(1500);
  await expect(old.locator("#news-overlay")).toBeHidden();                    // não repete depois de ver
  // pessoa nova (nada salvo)
  const fresh = await browser.newPage();
  await setup(fresh, { keys: false });
  await fresh.goto("/index.html");
  await fresh.waitForTimeout(1500);
  await expect(fresh.locator("#news-overlay")).toBeHidden();
});

test("versão do service worker bate com a versão das novidades", async () => {
  const novidades = fs.readFileSync(path.join(root, "js/novidades.js"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const version = novidades.match(/version:\s*"([\d.]+)"/)[1];                // a primeira = a atual
  const cache = sw.match(/const CACHE = "pregao-v([\d.]+)"/)[1];
  expect(cache, "Atualize CACHE em sw.js para a versão nova do CHANGELOG").toBe(version);
});

test("service worker lista todos os arquivos js/ do site", async () => {
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) expect(sw, `faltou "${s}" na lista do sw.js`).toContain(`"${s}"`);
});

/* ---------------- 9. Celular ---------------- */

test("celular (360 px): nada sobra para os lados", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await setup(page);
  await page.goto("/index.html");
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#btn-settings")).toBeInViewport();
});

// [NOVO] O painel aberto também tem que caber: o selo de variação não pode passar da borda
test("celular (360 px): variação no painel não sai da tela", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await setup(page, { list: ["MSFT"], storage: { "pregao.currency": "BRL" } }); // em R$ o texto fica mais comprido
  await page.goto("/index.html");
  await page.locator(".card", { hasText: "MSFT" }).first().click();
  const ch = page.locator("#d-change");
  await expect(ch).toContainText("%");
  const box = await ch.boundingBox();
  expect(box.x + box.width, "o selo de variação passou da borda direita").toBeLessThanOrEqual(360);
});

// [NOVO] Gaveta de opções (js/seletor.js)
test("celular: opções abrem na gaveta do tema e o voltar fecha", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await setup(page, { list: ["MSFT", "AAPL"] });
  await page.goto("/index.html");
  // toque de dedo nas coordenadas (o <select> fica com pointer-events: none de propósito)
  const tapSort = async () => {
    await page.locator("#list-sort").scrollIntoViewIfNeeded();
    const b = await page.locator("#list-sort").boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tapSort();
  const sheet = page.locator(".sheet-overlay.show .sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".sheet-title")).toHaveText("Ordenar a lista");
  await sheet.locator(".sheet-opt", { hasText: "Maior queda" }).tap();
  await expect(page.locator(".sheet-overlay")).toHaveCount(0);
  await expect(page.locator("#list-sort")).toHaveValue("loss");      // o <select> de verdade mudou
  // voltar do Android fecha a gaveta sem sair da página
  await tapSort();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(page.locator(".sheet-overlay")).toHaveCount(0);
  await expect(page).toHaveURL(/index\.html/);
  await ctx.close();
});

test("PC com mouse: continua o seletor normal, sem gaveta", async ({ page }) => {
  await setup(page);
  await page.goto("/index.html");
  await page.selectOption("#list-sort", "name");
  await expect(page.locator("#list-sort")).toHaveValue("name");
  await expect(page.locator(".sheet-overlay")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains("touch-selects"))).toBe(false);
});

// [NOVO] Feedback (js/feedback.js) — Google Forms + GitHub como alternativa
const FORM = { id: "FORM123", fields: { tipo: "entry.1", mensagem: "entry.2", contato: "entry.3", detalhes: "entry.4" } };
async function openFeedback(page) {
  await page.locator("#footer-feedback").click();
  await expect(page.locator('section[data-panel="feedback"]')).toBeVisible();
}

test("feedback: envia para o formulário sem levar chaves", async ({ page }) => {
  await page.addInitScript((f) => { window.PREGAO_FEEDBACK_FORM = f; }, FORM);
  await setup(page, { keys: { finnhubKey: "CHAVE-SECRETA-123", brapiToken: "TOKEN-SECRETO-456" } });
  await page.goto("/index.html");
  await openFeedback(page);
  await page.locator("#fb-type button", { hasText: "Problema" }).click();
  await page.fill("#fb-msg", "O gráfico 1M não carrega na VALE3");
  await page.fill("#fb-contact", "@teste");
  await page.click("#fb-send");
  await expect(page.locator("#fb-done")).toContainText("Recebido");
  const sent = await page.evaluate(() => window.__calls.feedback);
  expect(sent).toHaveLength(1);
  expect(sent[0]["entry.1"]).toBe("Problema");
  expect(sent[0]["entry.2"]).toBe("O gráfico 1M não carrega na VALE3");
  expect(sent[0]["entry.3"]).toBe("@teste");
  expect(sent[0]["entry.4"]).toContain("Versão");
  expect(JSON.stringify(sent)).not.toContain("CHAVE-SECRETA-123"); // as chaves nunca vão junto
  expect(JSON.stringify(sent)).not.toContain("TOKEN-SECRETO-456");
  await expect(page.locator("#fb-msg")).toHaveValue("");
});

test("feedback: sem internet guarda e envia depois", async ({ page }) => {
  await page.addInitScript((f) => { window.PREGAO_FEEDBACK_FORM = f; }, FORM);
  await setup(page, { feedbackOffline: true });
  await page.goto("/index.html");
  await openFeedback(page);
  await page.fill("#fb-msg", "Ideia: alerta por e-mail");
  await page.click("#fb-send");
  await expect(page.locator("#fb-done")).toContainText("guardei");
  await expect(page.locator("#fb-pending")).toContainText("1 mensagem");
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem("pregao.feedbackQueue")));
  expect(q).toHaveLength(1);
});

test("feedback: alternativa do GitHub abre a issue pronta", async ({ page }) => {
  await page.addInitScript(() => { window.open = (u) => { (window.__opened ||= []).push(u); return {}; }; });
  await setup(page, { keys: { finnhubKey: "CHAVE-SECRETA-123" } });
  await page.goto("/index.html");
  await openFeedback(page);
  await page.fill("#fb-msg", "Queria alerta por notificação");
  await page.click("#fb-github");
  const url = new URL((await page.evaluate(() => window.__opened))[0]);
  expect(url.origin + url.pathname).toBe("https://github.com/rafael26042007-max/pregao/issues/new");
  expect(url.searchParams.get("title")).toContain("[Ideia] Queria alerta");
  expect(url.href).not.toContain("CHAVE-SECRETA-123");
  expect(await page.evaluate(() => window.__calls.feedback)).toBeUndefined(); // não mandou pro Forms
});

// [NOVO] Novidades só depois que a atualização terminou de instalar (js/novidades.js, bloco 4)
const OLD_USER = { "pregao.seenVersion": "2.5", "pregao.watchlist": [] };

test("novidades: esperam a instalação terminar e não pedem para atualizar", async ({ page }) => {
  // instalador ainda é a versão antiga
  await page.addInitScript(() => { window.__swV = "2.5"; window.__pregaoSwProbe = async () => window.__swV; });
  await setup(page, { storage: OLD_USER });
  await page.goto("/index.html");
  await page.waitForTimeout(1500);
  await expect(page.locator("#news-overlay")).toBeHidden();          // ainda instalando: nada de novidades

  // o instalador novo assume
  const cur = await page.evaluate(() => APP_VERSION_NUMBER);
  await page.evaluate((v) => { window.__swV = v; navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); }, cur);
  await expect(page.locator("#news-overlay")).toBeVisible();
  await expect(page.locator("#update-banner")).toBeHidden();         // a página já é a nova: sem "Atualizar"
});

test("novidades: versão publicada com o app aberto mostra Atualizar, não as novidades", async ({ page }) => {
  await page.addInitScript(() => { window.__swV = null; window.__pregaoSwProbe = async () => window.__swV; });
  await setup(page);
  await page.goto("/index.html");
  await page.evaluate(() => { window.__swV = "99.0"; navigator.serviceWorker.dispatchEvent(new Event("controllerchange")); });
  await expect(page.locator("#update-banner")).toBeVisible();
  await expect(page.locator("#news-overlay")).toBeHidden();
});

test("novidades: com o instalador de verdade, aparecem quando ele já é da versão nova", async ({ page }) => {
  await setup(page, { storage: OLD_USER });
  await page.goto("/index.html");
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  // pergunta de verdade ao sw.js
  const cur = await page.evaluate(() => APP_VERSION_NUMBER);
  expect(await page.evaluate(() => installedVersion())).toBe(cur);
  await expect(page.locator("#news-overlay")).toBeVisible({ timeout: 5000 });
});

// [NOVO] Privacidade (js/privacidade.js)
test("privacidade: aviso na 1ª visita, Entendi guarda e não volta", async ({ page }) => {
  await setup(page, { privacyBanner: true });
  await page.goto("/index.html");
  const bar = page.locator("#privacy-banner");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Sem cookies");
  await page.click("#privacy-ok");
  await expect(bar).toBeHidden();
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(bar).toBeHidden();
});

test("privacidade: Saiba mais abre a aba e Apagar meus dados limpa o aparelho", async ({ page }) => {
  await setup(page, { privacyBanner: true, list: ["MSFT"] });
  await page.goto("/index.html");
  await page.click("#privacy-more");
  await expect(page.locator('section[data-panel="privacy"]')).toBeVisible();
  await expect(page.locator('section[data-panel="privacy"]')).toContainText("não usa cookies");
  const btn = page.locator("#privacy-reset");
  await btn.click();
  await expect(btn).toHaveText("Toque de novo para confirmar");   // 1º clique só arma
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pregao.")).length)).toBeGreaterThan(0);
  await btn.click();                                               // 2º clique apaga
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pregao.")))).toEqual([]);
});

test("privacidade: quem não configurou a chave vê o aviso a cada visita", async ({ context }) => {
  const page = await context.newPage();
  await setup(page, { keys: false, privacyBanner: true });
  await page.goto("/index.html");
  await page.click("#wz-demo");                                    // modo demonstração (sem chave)
  const bar = page.locator("#privacy-banner");
  await expect(bar).toBeVisible();
  await page.click("#privacy-ok");
  await page.reload();                                             // mesma visita: não repete
  await page.waitForTimeout(1500);
  await expect(bar).toBeHidden();

  const outra = await context.newPage();                           // nova visita (outra aba)
  await setup(outra, { keys: false, privacyBanner: true });
  await outra.goto("/index.html");
  await expect(outra.locator("#privacy-banner")).toBeVisible();
});

// [NOVO] Achados do teste como usuário (16/11)
test("topo: a ⚙ cabe na tela em qualquer largura (320 a 1000 px)", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  for (const currency of ["orig", "BRL"]) {          // "Moeda original" é o rótulo mais largo
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.evaluate((c) => localStorage.setItem("pregao.currency", JSON.stringify(c)), currency);
    await page.reload();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => state.currency)).toBe(currency);
    for (let w = 320; w <= 1000; w += 10) {
      await page.setViewportSize({ width: w, height: 700 });
      const r = await page.evaluate(() => ({ right: document.querySelector("#btn-settings").getBoundingClientRect().right, vw: innerWidth }));
      expect(r.right, `largura ${w} px, moeda ${currency}`).toBeLessThanOrEqual(r.vw);
    }
  }
});

test("privacidade: a faixa espera a janela de novidades fechar", async ({ page }) => {
  await setup(page, { privacyBanner: true, storage: { "pregao.seenVersion": "2.0", "pregao.watchlist": [] } });
  await page.goto("/index.html");
  await expect(page.locator("#news-overlay")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator("#privacy-banner")).toBeHidden();        // não aparece junto
  await page.click("#news-ok");
  await expect(page.locator("#privacy-banner")).toBeVisible();
});

test("lista: filtro vazio diz o que fazer", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await page.click('#list-filter button[data-f="pos"]');
  await expect(page.locator("#filter-empty")).toContainText("Minha posição");
  await page.click('#list-filter button[data-f="b3"]');
  await expect(page.locator("#filter-empty")).toContainText("Petrobras");
});

test("gráfico 1M/3M: o último ponto é o preço de agora", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  const r = await page.evaluate(() => {
    const day = 864e5, now = Date.now();
    const rr = { price: 41.30, lastTs: now, hist: { "1M": { pts: [{ t: now - 3 * day, p: 40 }, { t: now - 2 * day, p: 41.68 }] } } };
    const novoDia = seriesFor(rr, "1M");
    rr.hist["1M"].pts.push({ t: now - 60_000, p: 41.5 });            // histórico já tem hoje
    const mesmoDia = seriesFor(rr, "1M");
    return { novoDia: novoDia.map((p) => p.p), mesmoDia: mesmoDia.map((p) => p.p) };
  });
  expect(r.novoDia).toEqual([40, 41.68, 41.30]);   // entrou no fim
  expect(r.mesmoDia).toEqual([40, 41.68, 41.30]);  // trocou o ponto de hoje
});

// [NOVO] QR code entre aparelhos (js/transferir.js)
async function qrUrlFrom(page, { keys = true } = {}) {
  await page.click("#btn-settings");
  await page.click('#settings-nav button[data-tab="data"]');
  await page.click("#set-qr-show");
  if (!keys) await page.uncheck("#qs-keys");
  await expect(page.locator("#qs-code svg")).toBeVisible();
  if (!keys) await page.waitForTimeout(300);
  return page.locator("#qs-code").getAttribute("data-url");
}

test("QR: aparelho novo recebe tudo e pula o guia", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await setup(a, { keys: { finnhubKey: "CHAVE-A" }, list: ["MSFT", "AAPL", "PETR4.SA"], storage: { "pregao.currency": "BRL" } });
  await a.goto("/index.html");
  const url = await qrUrlFrom(a);
  expect(url).toContain("#transfer=1.");
  await a.click("#qs-close");
  await expect(a.locator("#qs-code svg")).toHaveCount(0);           // QR some da tela ao fechar

  const b = await (await browser.newContext()).newPage();            // outro aparelho, sem nada
  await setup(b, { keys: false });
  await b.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(b.locator("#transfer-overlay")).toBeVisible();
  await expect(b.locator("#welcome-overlay")).toBeHidden();         // sem guia por cima
  expect(b.url()).not.toContain("transfer");                        // dados saem da barra de endereço
  await expect(b.locator("#tr-list")).toContainText("3 ativos");
  await expect(b.locator("#tr-list")).toContainText("chaves");
  await b.click("#tr-ok");
  await b.waitForLoadState("load");
  await b.waitForTimeout(1500);
  const got = await b.evaluate(() => ({ cfg: JSON.parse(localStorage.getItem("pregao.config")), list: JSON.parse(localStorage.getItem("pregao.watchlist")).map((i) => i.symbol), cur: JSON.parse(localStorage.getItem("pregao.currency")) }));
  expect(got.cfg.finnhubKey).toBe("CHAVE-A");
  expect(got.list).toEqual(["MSFT", "AAPL", "PETR4.SA"]);
  expect(got.cur).toBe("BRL");
  await expect(b.locator("#welcome-overlay")).toBeHidden();
});

test("QR: sem marcar as chaves, elas não vão", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await setup(page, { keys: { finnhubKey: "CHAVE-SECRETA" }, list: ["MSFT"] });
  await page.goto("/index.html");
  const url = await qrUrlFrom(page, { keys: false });
  const outro = await (await browser.newContext()).newPage();        // decodifica no OUTRO aparelho
  await setup(outro);
  await outro.goto("/index.html");
  const data = await outro.evaluate((u) => decodeTransfer(codeFromText(u)), url);
  expect(data["pregao.config"]).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain("CHAVE-SECRETA");
  expect(data["pregao.watchlist"]).toHaveLength(1);
});

test("QR: código vencido avisa e volta o guia", async ({ page }) => {
  await setup(page, { keys: false });
  await page.goto("/index.html");
  const code = await page.evaluate(() => "1.j." + b64url(new TextEncoder().encode(JSON.stringify({ e: Date.now() - 1000, d: { "pregao.watchlist": [] } }))));
  await page.goto("/index.html#transfer=" + code);
  await page.reload();
  await expect(page.locator(".toast")).toContainText("expirou");
  await expect(page.locator("#transfer-overlay")).toBeHidden();
  await expect(page.locator("#welcome-overlay")).toBeVisible();
});

test("QR: o leitor (jsQR) lê a imagem gerada, mesmo com lista grande", async ({ page }) => {
  const big = Array.from({ length: 40 }, (_, i) => `SYM${i}`);
  const portfolio = Object.fromEntries(big.slice(0, 15).map((s) => [s, { qty: 10, avg: 12.34 }]));
  await setup(page, { keys: { finnhubKey: "x".repeat(40), brapiKey: "y".repeat(22), twelveKey: "z".repeat(32) }, list: big, storage: { "pregao.portfolio": portfolio } });
  await page.goto("/index.html");
  const url = await qrUrlFrom(page);
  const read = await page.evaluate(async () => {
    const svg = document.querySelector("#qs-code svg").outerHTML;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg", '<svg width="600" height="600"'));
    await img.decode();
    const c = document.createElement("canvas"); c.width = 600; c.height = 600;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 600, 600); ctx.drawImage(img, 0, 0, 600, 600);
    const jsQR = await loadJsQr();
    return jsQR(ctx.getImageData(0, 0, 600, 600).data, 600, 600)?.data;
  });
  expect(read).toBe(url);
  // lido no MESMO aparelho que criou: reconhece a própria identidade e manda abrir no outro
  await page.click("#qs-close");
  await page.evaluate((u) => handleScannedText(u), read);
  await expect(page.locator(".toast")).toContainText("criado neste próprio aparelho");
  await expect(page.locator("#transfer-overlay")).toBeHidden();
});

test("QR: fechar o leitor sem ler nada traz o guia de volta", async ({ page }) => {
  await setup(page, { keys: false });
  await page.goto("/index.html");
  await page.click("#wz-qr");
  await expect(page.locator("#qr-scan-overlay")).toBeVisible();
  await expect(page.locator("#welcome-overlay")).toBeHidden();
  await page.click("#scan-close");
  await expect(page.locator("#welcome-overlay")).toBeVisible();
});

test("QR: aparelho que já tem os mesmos dados só avisa", async ({ browser }) => {
  const same = { keys: { finnhubKey: "CHAVE-A" }, list: ["MSFT", "AAPL"] };
  const a = await (await browser.newContext()).newPage();
  await setup(a, same);
  await a.goto("/index.html");
  const url = await qrUrlFrom(a);
  const b = await (await browser.newContext()).newPage();
  await setup(b, same);
  await b.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(b.locator(".toast")).toContainText("mesmos dados");
  await expect(b.locator("#transfer-overlay")).toBeHidden();
});

test("QR: aparelho com dados diferentes vê o que entra e o que sai", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await setup(a, { keys: { finnhubKey: "CHAVE-A" }, list: ["MSFT", "AAPL"] });
  await a.goto("/index.html");
  const url = await qrUrlFrom(a);
  const b = await (await browser.newContext()).newPage();
  await setup(b, { keys: { finnhubKey: "CHAVE-A" }, list: ["MSFT", "TSLA"] });
  await b.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(b.locator("#transfer-overlay")).toBeVisible();
  await expect(b.locator("#tr-title")).toHaveText("Atualizar com os dados do outro aparelho?");
  await expect(b.locator("#tr-list")).toContainText("entram AAPL");
  await expect(b.locator("#tr-list")).toContainText("saem TSLA");
  await expect(b.locator("#tr-list")).toContainText("as mesmas deste aparelho");
});

// [NOVO] Identificação do aparelho no QR code
test("QR: PC sem câmera não abre tela preta e ensina o caminho pelo link", async ({ page }) => {
  await page.addInitScript(() => { window.__pregaoCamera = false; });
  await setup(page, { keys: false });
  await page.goto("/index.html");
  await expect(page.locator("#wz-qr")).toHaveText(/trazer de lá/);
  await page.click("#wz-qr");
  await expect(page.locator("#scan-title")).toHaveText("Este computador não tem câmera");
  await expect(page.locator("#scan-video")).toBeHidden();
  await expect(page.locator("#scan-steps")).toContainText("Enviar link");
});

test("QR: com câmera, o guia oferece ler o QR code", async ({ page }) => {
  await page.addInitScript(() => { window.__pregaoCamera = true; });
  await setup(page, { keys: false });
  await page.goto("/index.html");
  await expect(page.locator("#wz-qr")).toHaveText(/ler QR code/);
});

test("QR: no PC sem compartilhar do sistema, Copiar link copia o mesmo link do QR", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true }));
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  const url = await qrUrlFrom(page);
  await expect(page.locator("#qs-help")).toContainText("celular");
  await expect(page.locator("#qs-link")).toHaveText("Copiar link");
  await page.click("#qs-link");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test("QR: mostrando no celular, a instrução fala do computador", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 760 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
  const page = await ctx.newPage();
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await page.evaluate(() => openShareQr());
  await expect(page.locator("#qs-help")).toContainText("computador");
});

test("QR: o próprio link aberto no mesmo aparelho avisa para abrir no outro", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  const url = await qrUrlFrom(page);
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await page.reload();
  await expect(page.locator(".toast")).toContainText("OUTRO aparelho");
  await expect(page.locator("#transfer-overlay")).toBeHidden();
  // a identidade não vai no QR nem no backup
  const data = await page.evaluate((u) => decodeTransfer(codeFromText(u)).catch((e) => e.message), url);
  expect(data).toBe("MESMO_APARELHO");
  expect(await page.evaluate(() => Object.keys(collectBackupData(true)))).not.toContain("pregao.deviceId");
});

test("QR: aba Chaves de API também oferece trazer por QR code", async ({ page }) => {
  await page.addInitScript(() => { window.__pregaoCamera = false; });
  await setup(page, { keys: false, storage: { "pregao.demo": true } });
  await page.goto("/index.html");
  await page.click("#btn-settings");
  await expect(page.locator("#hint-qr")).toHaveText("Trazer do celular");
  await page.click("#hint-qr");
  await expect(page.locator("#scan-steps")).toBeVisible();
});

test("novidades: versão de correção aparece com o rótulo correções", async ({ page }) => {
  await setup(page, { storage: { "pregao.seenVersion": "3.0", "pregao.watchlist": [] } });
  await page.goto("/index.html");
  await expect(page.locator("#news-overlay")).toBeVisible();
  await expect(page.locator(".nv-badge", { hasText: "3.0.100" })).toHaveText("versão 3.0.100 · correções");
  await expect(page.locator(".nv-badge", { hasText: "versão 4.0" })).toHaveText("versão 4.0"); // importante: sem rótulo
});

// [NOVO] Banco de dados SQLite (js/banco.js)
const bancoAberto = (page) => page.waitForFunction(() => typeof banco !== "undefined" && !!banco.db, null, { timeout: 15000 });
const contar = (page, simbolo) => page.evaluate((s) => bancoConsultar("SELECT COUNT(*) AS n FROM precos WHERE simbolo = ?", [s])[0].n, simbolo);

test("banco: preços que chegam viram linhas e sobrevivem ao recarregar", async ({ page }) => {
  await setup(page, { list: ["AAPL"] });
  await page.goto("/index.html");
  await bancoAberto(page);
  await expect.poll(() => contar(page, "AAPL"), { timeout: 8000 }).toBeGreaterThan(0);
  await page.evaluate(async () => { await bancoGravarFila(); banco.sujo = true; await bancoSalvar(); });
  await page.reload();
  await bancoAberto(page);
  expect(await contar(page, "AAPL")).toBeGreaterThan(0);
  // no máximo 1 linha por minuto: vários ticks no mesmo minuto não multiplicam linhas
  expect(await page.evaluate(() => bancoConsultar("SELECT COUNT(*) AS n FROM (SELECT simbolo, minuto FROM precos GROUP BY simbolo, minuto HAVING COUNT(*) > 1)")[0].n)).toBe(0);
});

test("banco: símbolo com SQL malicioso é tratado como texto (parâmetros ?)", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await bancoAberto(page);
  const r = await page.evaluate(async () => {
    const ataque = "x'); DROP TABLE precos; --";
    const resumo = await bancoResumo(ataque, 0);
    banco.db.run("INSERT INTO precos VALUES (?, ?, ?, ?)", [ataque, 1, 1, "USD"]);
    const tabela = bancoConsultar("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'precos'");
    const guardado = bancoConsultar("SELECT simbolo FROM precos WHERE simbolo = ?", [ataque]);
    return { total: resumo.total, tabela: tabela.length, guardado: guardado[0]?.simbolo };
  });
  expect(r.total).toBe(0);
  expect(r.tabela).toBe(1);                                   // a tabela continua existindo
  expect(r.guardado).toBe("x'); DROP TABLE precos; --");       // virou só um texto
});

test("banco: painel mostra mínima e máxima de 7 dias", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await bancoAberto(page);
  await page.evaluate(() => {
    const agora = Date.now();
    banco.db.run("INSERT INTO precos VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      ["MSFT", agora - 3 * 864e5, 100, "USD", "MSFT", agora - 2 * 864e5, 200, "USD", "MSFT", agora - 10 * 864e5, 50, "USD"]);
  });
  await page.locator(".card", { hasText: "MSFT" }).first().click();
  const box = page.locator("#d-db");
  await expect(box).toContainText("Últimos 7 dias");
  await expect(box).toContainText("US$ 100,00");                // a de 10 dias atrás (50) fica de fora
  await expect(box).toContainText("US$ 200,00");
});

test("banco: baixar .sqlite, apagar histórico e limpeza de 30 dias", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await bancoAberto(page);
  await page.evaluate(() => banco.db.run("INSERT INTO precos VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    ["MSFT", Date.now(), 10, "USD", "VELHO", Date.now() - 40 * 864e5, 5, "USD"]));
  await page.click("#btn-settings");
  await page.click('#settings-nav button[data-tab="data"]');
  await expect(page.locator("#db-stats")).toContainText("preços de");

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#db-download")]);
  const fs = require("fs");
  const head = fs.readFileSync(await dl.path()).subarray(0, 15).toString();
  expect(head).toBe("SQLite format 3");                        // é um arquivo SQLite de verdade

  // limpeza: salva e reabre; o de 40 dias some
  await page.evaluate(async () => { banco.sujo = true; await bancoSalvar(); });
  await page.reload();
  await bancoAberto(page);
  expect(await contar(page, "VELHO")).toBe(0);
  expect(await contar(page, "MSFT")).toBeGreaterThan(0);

  await page.click("#btn-settings");
  await page.click('#settings-nav button[data-tab="data"]');
  await page.click("#db-clear");
  await expect(page.locator("#db-clear")).toHaveText("Toque de novo para confirmar");
  await page.click("#db-clear");
  await expect(page.locator("#db-stats")).toContainText("Ainda vazio");
});

test("banco: só uma aba grava", async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage(); await setup(a, { list: ["MSFT"] }); await a.goto("/index.html");
  await a.waitForTimeout(500);
  const b = await ctx.newPage(); await b.goto("/index.html");
  await b.waitForTimeout(800);
  const g = [await a.evaluate(() => banco.gravador), await b.evaluate(() => banco.gravador)];
  expect(g.filter(Boolean)).toHaveLength(1);
});

test("banco: Apagar meus dados também apaga o banco de preços", async ({ page }) => {
  await setup(page, { list: ["MSFT"] });
  await page.goto("/index.html");
  await bancoAberto(page);
  await page.evaluate(async () => { banco.db.run("INSERT INTO precos VALUES (?, ?, ?, ?)", ["MSFT", Date.now(), 1, "USD"]); banco.sujo = true; await bancoSalvar(); });
  await page.click("#btn-settings");
  await page.click('#settings-nav button[data-tab="privacy"]');
  await page.click("#privacy-reset");
  await page.click("#privacy-reset");
  await page.waitForTimeout(1500);                               // apaga e recarrega
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain("pregao-banco");
});
