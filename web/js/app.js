// vietlot web UI: hash-routed views over the local API (see README for the contract).
import { PRICE, GAMES, net, expectedValue, breakEvenJackpot, popularity, buildTickets, coverage, replay, smsLines } from "./formula.js";

/* ---------- formatting ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nf = (n, d = 0) => Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const dong = (n) => nf(Math.round(n)) + "đ";
const ty = (v) => nf(v / 1e9, 1) + " tỷ";
const pct = (x, d = 3) => nf(x * 100, d) + "%";
const signed = (v) => (v < 0 ? "−" : "+") + dong(Math.abs(v));
const dmy = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
const dm = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const WD = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const wd = (iso) => WD[new Date(iso + "T00:00:00").getDay()];
const when = (iso) => new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const LETTERS = "ABCDEFGHI";
const GIDS = ["655", "645"];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/* ---------- api + caches ---------- */
async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.body !== undefined) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(opts.body); }
  const r = await fetch("/api" + path, init);
  let j = null;
  try { j = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || `Lỗi ${r.status}`);
  return j;
}
const C = { state: null, draws: {}, asc: {}, keys: {}, lab: {}, purchases: null, syncLog: null };
const getState = async () => (C.state ??= await api("/state"));
const getDraws = async (g) => {
  if (!C.draws[g]) { C.draws[g] = await api(`/draws?game=${g}`); C.asc[g] = [...C.draws[g]].reverse(); }
  return C.draws[g];
};
const getPurchases = async () => (C.purchases ??= await api("/purchases"));
const getLab = async (g) => (C.lab[g] ??= await api(`/lab?game=${g}`));
const drawnKeys = (g) => (C.keys[g] ??= new Set(C.draws[g].map((d) => d.main.join("-"))));
const dropData = () => { C.state = C.purchases = null; C.draws = {}; C.asc = {}; C.keys = {}; C.lab = {}; };

const evInputs = (nx) => ({ jp1: nx.jp1, jp2: nx.jp2 ?? 0, sales: nx.sales });
const haveNext = (nx) => nx && nx.jp1 != null && nx.sales != null;

/* ---------- tiles ---------- */
let ix = 0;
const tile = (cls, inner, extra = "") => `<section class="tile ${cls}" style="--i:${ix++}"${extra}>${inner}</section>`;
const mk = (x, cls = "") => `<span class="mk ${cls}">${x}</span>`;
const prizeName = (g, key) => GAMES[g].prizes.find((p) => p.key === key)?.name ?? key;
const errTile = (e) => tile("s12", `<h2>Không tải được dữ liệu</h2><p role="alert">${esc(e.message)}</p><p>Máy chủ đã chạy chưa? Mở terminal ở thư mục dự án và gõ <code>python3 -m vietlot serve</code>.</p>`);
const busyTile = (msg) => tile("s12", `<p aria-busy="true">${esc(msg)}</p>`);

/* ---------- ticket parsing ---------- */
function parseTickets(text, n, max = 9) {
  const tickets = [], errs = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const nums = (line.match(/\d+/g) || []).map(Number);
    if (nums.length === 6 && new Set(nums).size === 6 && nums.every((x) => x >= 1 && x <= n)) tickets.push(nums.sort((a, b) => a - b));
    else errs.push(`Dòng ${i + 1}: cần đúng 6 số khác nhau từ 1 đến ${n}.`);
  });
  if (tickets.length > max) errs.push(`Tối đa ${max} vé mỗi lần.`);
  return { tickets: tickets.slice(0, max), errs };
}
const parseTy = (s) => {
  s = String(s).replace(/\s/g, "");
  const v = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(v) && v >= 0 ? v * 1e9 : null;
};
const parseCount = (s) => { const v = parseInt(String(s).replace(/\D/g, ""), 10); return Number.isFinite(v) ? v : null; };

/* ---------- shared analysis block (picker + own tickets) ---------- */
function evSet(g, tickets, alpha, inp) {
  const game = GAMES[g];
  const rho = tickets.map((t) => popularity(t, alpha));
  const ev = rho.map((r) => expectedValue(game, { ...inp, rho: r }));
  return { rho, ev, total: ev.reduce((s, x) => s + x, 0) };
}
function oddsFigures(g, tickets) {
  const game = GAMES[g];
  const c = coverage(tickets, game.n);
  return { c, any: c.any / c.total, ge4: c.ge4 / c.total, jp: tickets.length / c.total };
}
function replayHtml(g, tickets) {
  const asc = C.asc[g], game = GAMES[g];
  const r = replay(tickets, asc, game);
  const jp = r.tally.jp1 + (r.tally.jp2 || 0);
  const won = game.prizes.filter((p) => r.tally[p.key]).map((p) => `${r.tally[p.key]} lần ${p.name}`);
  const best = r.best ? `Nhiều số nhất: ${r.best.m} số, kỳ #${r.best.id} (${dmy(r.best.date)}).` : "Chưa lần nào trúng giải.";
  return `<h3>Nếu đã mua bộ này từ ${asc[0].date.slice(0, 4)}</h3>
    <p>${nf(asc.length)} kỳ × ${tickets.length} vé = chi ${dong(r.spent)}. Giải cố định nhận về ${dong(r.money)} sau thuế${jp ? `, chưa tính ${jp} lần Jackpot` : ""}. Chênh lệch ${signed(r.money - r.spent)}.</p>
    <p>${won.length ? esc(won.join(", ")) + ". " : ""}${best}</p>`;
}
function analysisHtml(g, tickets, alpha, inp) {
  const o = oddsFigures(g, tickets), e = evSet(g, tickets, alpha, inp);
  const cost = tickets.length * PRICE;
  return `<div class="pair">
      <div><p class="fig">${pct(o.any)}</p><p>Ít nhất một vé trúng giải (từ 3 số): <span class="cap">${nf(o.c.any)} / ${nf(o.c.total)} bộ số có thể quay</span></p></div>
      <div><p class="fig">${pct(o.ge4)}</p><p>Có vé trúng từ 4 số: <span class="cap">${nf(o.c.ge4)} / ${nf(o.c.total)}. Jackpot 1: 1 trên ${nf(1 / o.jp)}</span></p></div>
    </div>
    <p>Giá trị kỳ vọng cả bộ: <b>${dong(e.total)}</b> trên ${dong(cost)} đã chi (${pct(e.total / cost, 0)}). Vé trong bộ: ${e.rho.map((r, i) => `${LETTERS[i]} ρ ${nf(r, 2)}`).join(", ")}.</p>`;
}

/* ---------- Bảng ---------- */
const idk = (id) => "#" + String(id).padStart(5, "0");
const chip = (bought, id) => `<span class="chip ${bought ? "ok" : "due"}">${bought ? "Đã mua" : "Chưa mua"} kỳ ${idk(id)}</span>`;

// The user's own formula leads the board, answering "which numbers?" in one screen.
const balls = (T, sm = "") => `<div class="prows${sm}">${T.map((t, i) => `<div class="marks r${i % 5}">${t.map((x) => mk(x, "ball")).join("")}</div>`).join("")}</div>`;
function planTile(st) {
  const pl = st.plan, g = pl.game, game = GAMES[g], d = st.games[g], nx = d.next, T = pl.tickets;
  const o = oddsFigures(g, T);
  const rho = mean(T.map((t) => popularity(t, d.alpha)));
  const ev = haveNext(nx) ? expectedValue(game, { ...evInputs(nx), rho }) : null;
  const date = nx && nx.id === pl.next_draw ? `${wd(nx.date)} ${dmy(nx.date)}` : "";
  const buy = pl.next_bought
    ? `<p>Đã ghi vào sổ cho kỳ ${idk(pl.next_draw)}. Đừng gửi SMS lần nữa. <a href="#/so-ve">Mở sổ vé</a></p>`
    : `<code class="sms">${esc(pl.sms.join("\n"))}</code>
       <button type="button" class="btn red" data-act="copy" data-copy="${esc(pl.sms.join("\n"))}" data-k="copy">Sao chép tin nhắn, gửi 9969</button>
       <label class="field" for="plan-code">Mã vé (không bắt buộc)</label><input id="plan-code" data-in="plancode" autocomplete="off" value="${esc(P.planCode)}">
       <button type="button" class="btn" data-act="planBuy" data-k="planBuy">Đã gửi SMS, ghi vào sổ</button>
       <p class="cap" role="status" id="plan-msg"></p>`;
  return tile("s12 sun", `<div class="plan">
    <div class="pl-a">
      <h1>Số cho kỳ ${idk(pl.next_draw)}</h1>
      <p class="stat">${chip(pl.next_bought, pl.next_draw)}<span>${date}${nx && nx.jp1 ? `, Jackpot ${ty(nx.jp1)}` : ""}</span></p>
      ${balls(T)}
      <p class="lead">Không số nào dễ ra hơn số nào: mỗi bộ 6 số đều là 1 trên ${nf(game.total)}. Với ${dong(pl.cost_per_draw)}, 5 vé không chung số này là cách có cơ hội trúng cao nhất.</p>
    </div>
    <div class="pl-b">
      <div class="pair">
        <div><p class="fig">${pct(o.any)}</p><p>mỗi kỳ có ít nhất một giải</p></div>
        <div><p class="fig">${pct(o.ge4)}</p><p>có giải Nhì trở lên</p></div>
      </div>
      <p>${ev != null ? `Mỗi vé trung bình nhận lại <b>${dong(ev)}</b> trên ${dong(PRICE)}.` : ""} ${esc(pl.name)}: ${esc(pl.note)}</p>
      ${buy}
    </div></div>`);
}

// Your formula next to Mark Do's original (markdo27) and the two merged.
function markdoTile(st) {
  const g = st.plan ? st.plan.game : "655", d = st.games[g], md = d.markdo, n = GAMES[g].n;
  if (!md) return "";
  const sets = [
    st.plan && { cls: "mine", name: "Công thức của tôi", how: "5 vé rời, số ít người chọn", T: st.plan.tickets, sc: md.plan_scores, rho: md.plan_rho },
    { cls: "md", name: "Mark Do", how: `3 số nóng nhất (${md.hot.slice(0, 3).join(", ")}) + 3 số gan nhất (${md.overdue.slice(0, 3).join(", ")})`, T: [md.combo], sc: [md.combo_score], rho: md.combo_rho },
    { cls: "mix", name: "Gộp hai công thức", how: "5 vé rời, số chọn theo điểm Mark Do", T: md.merged, sc: md.merged_scores, rho: md.merged_rho },
  ].filter(Boolean);
  const col = (s) => {
    const c = coverage(s.T, n);
    return `<div class="cmp ${s.cls}"><h3>${s.name}</h3><p class="cap">${esc(s.how)}</p>${balls(s.T, " sm")}
      <dl class="kv"><dt>Có giải mỗi kỳ</dt><dd>${pct(c.any / c.total)}</dd><dt>Chi mỗi kỳ</dt><dd>${dong(s.T.length * PRICE)}</dd>
      <dt>Điểm Mark Do</dt><dd>${Math.round(mean(s.sc))}/100</dd><dt>Người chia Jackpot</dt><dd>×${nf(s.rho, 2)}</dd></dl></div>`;
  };
  const bt = md.backtest;
  return tile("s12", `<h2>Gộp với công thức Mark Do</h2>
    <div class="cmps">${sets.map(col).join("")}</div>
    <p>Điểm Mark Do không làm số dễ ra hơn: thử lại trên ${nf(bt.draws)} kỳ, cách chọn của Mark Do trùng trung bình ${nf(bt.mean_matches, 3)} số mỗi kỳ, chọn bừa là ${nf(bt.expected, 3)} (p = ${nf(bt.p, 2)}, như ngẫu nhiên). Bộ gộp có cùng cơ hội với bộ của bạn vì cũng là 5 vé rời; khác ở chỗ nhiều người chọn số nóng hơn, nên nếu trúng Jackpot phải chia cho nhiều người hơn. <b>Giữ bộ của bạn.</b> <a href="#/phong-thu">Xem phòng thử</a></p>`);
}

async function viewBang(root) {
  const st = await getState();
  const rows = GIDS.map((g) => ({ g, game: GAMES[g], d: st.games[g], nx: st.games[g].next }));
  const pl = st.plan;
  const first = pl ? planTile(st) : tile("s12 sun", `<h1>Chưa có công thức</h1><p>Thêm data/plan.json rồi tải lại.</p>`);
  const jp = rows.map(({ g, game, nx }) => tile(`s3 j${g}`, nx
    ? `<p class="fig">${nx.jp1 != null ? ty(nx.jp1) : "chưa rõ"}</p><p>Jackpot ${game.id === "655" ? "1 " : ""}${game.name}, kỳ #${nx.id}, ${wd(nx.date)} ${dm(nx.date)}</p>${nx.jp2 != null ? `<p>Jackpot 2: ${ty(nx.jp2)}</p>` : ""}`
    : `<p class="fig">chưa rõ</p><p>${game.name}: chưa có kỳ tới</p>`)).join("");
  const results = rows.map(({ g, game, d }) => {
    const l = d.last;
    if (!l) return tile("s6", `<h2>${game.name}</h2><p>Chưa có kỳ quay nào.</p>`);
    const p = l.prizes;
    const val = (key) => (key === "jp1" ? p.jp1 : key === "jp2" ? p.jp2 : net(GAMES[g].prizes.find((x) => x.key === key).value));
    const cnt = (key) => ({ jp1: p.n_jp1, jp2: p.n_jp2, p1: p.n1, p2: p.n2, p3: p.n3 })[key];
    const win = p
      ? `<table class="t"><thead><tr><th>Giải</th><th>Giá trị</th><th>Số vé trúng</th></tr></thead><tbody>${game.prizes.filter((x) => cnt(x.key) != null).map((x) => `<tr><td>${x.name}</td><td>${val(x.key) != null ? dong(val(x.key)) : "–"}</td><td>${nf(cnt(x.key))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="cap">Chưa có số vé trúng cho kỳ này.</p>`;
    return tile("s6", `<h2>Kết quả ${game.name}: kỳ #${l.id}, ${wd(l.date)} ${dmy(l.date)}</h2>
      <div class="drawn"><div class="marks">${l.main.map((x) => mk(x, "ball hit")).join("")}</div>${l.bonus != null ? `<div class="bonus">${mk(l.bonus, "ball")}<span class="cap">số đặc biệt</span></div>` : ""}</div>${win}`);
  }).join("");
  const L = st.ledger, netv = L.won - L.spent;
  root.innerHTML = [
    first, markdoTile(st), jp,
    tile("s3", `<h2>Sổ vé</h2><dl class="kv"><dt>Đã chi</dt><dd>${dong(L.spent)}</dd><dt>Đã trúng</dt><dd>${dong(L.won)}</dd><dt>Chênh lệch</dt><dd>${signed(netv)}</dd></dl><p class="cap">${L.tickets} vé trong ${L.purchases} lần mua. <a href="#/so-ve">Mở sổ vé</a></p>`),
    tile("s3", `<h2>Dữ liệu</h2><p>Cập nhật lần cuối ${st.synced_at ? when(st.synced_at) : "chưa lần nào"}.</p><button class="btn" data-act="sync" data-k="sync">Cập nhật ngay</button><div class="log" aria-live="polite">${syncLogHtml()}</div>`),
    results,
    `<figure class="tile photo" style="--i:${ix++}"><img src="assets/ve-so-buoi-som.jpg" width="1024" height="682" alt="Người bán vé số ven đường ngồi bên bàn nhỏ, ảnh đen trắng"></figure>`,
  ].join("");
}
function syncLogHtml() {
  const s = C.syncLog;
  if (!s) return "";
  const add = Object.entries(s.added || {}).map(([g, n]) => `${GAMES[g]?.name ?? g}: +${n} kỳ`).join(", ");
  return `<p><b>Xong.</b> ${esc(add)}</p><ul>${(s.log || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

/* ---------- Chọn vé ---------- */
const P = { game: "655", k: 5, mode: null, tickets: null, fresh: false, inp: null, inpGame: null, own: "", code: "", planCode: "", saved: "", saveErr: "", err: "" };
// "plan" = the user's own fixed set, "new" = a fresh set from the same formula.
const curT = () => (P.mode === "plan" && C.state.plan && C.state.plan.game === P.game ? C.state.plan.tickets : P.tickets);

function ensureInputs() {
  const nx = C.state.games[P.game].next;
  if (P.inpGame !== P.game) {
    P.inpGame = P.game;
    P.inp = nx ? { jp1: nx.jp1 ?? 0, jp2: nx.jp2 ?? 0, sales: nx.sales ?? 0 } : { jp1: 0, jp2: 0, sales: 0 };
  }
}
function build() {
  const game = GAMES[P.game], d = C.state.games[P.game];
  P.k = Math.min(Math.max(1, P.k), game.maxTickets);
  P.tickets = buildTickets({ k: P.k, alpha: d.alpha, drawnKeys: drawnKeys(P.game) });
  P.err = P.tickets ? "" : `Không chia được ${P.k} vé không trùng số theo các bộ lọc. Thử ít vé hơn.`;
  P.fresh = true; P.saved = ""; P.saveErr = "";
}
const spans = (k) => ({ 1: [12], 2: [6, 6], 3: [4, 4, 4], 4: [3, 3, 3, 3], 5: [4, 4, 4, 6, 6], 6: [4, 4, 4, 4, 4, 4], 7: [3, 3, 3, 3, 4, 4, 4], 8: [3, 3, 3, 3, 3, 3, 3, 3], 9: [4, 4, 4, 4, 4, 4, 4, 4, 4] })[k];

function slipHtml(g, tickets) {
  const n = GAMES[g].n, cols = n === 55 ? 11 : 9;
  const cells = [];
  for (let x = 1; x <= n; x++) {
    const o = tickets ? tickets.findIndex((t) => t.includes(x)) : -1;
    cells.push(`<span class="cell${o >= 0 ? " on" : ""}">${x}${o >= 0 ? `<i>${LETTERS[o]}</i>` : ""}</span>`);
  }
  return `<div class="slip" style="--cols:${cols}" role="img" aria-label="Phiếu số 1 đến ${n}, các số đã chọn được tô đen">${cells.join("")}</div>`;
}
const tyInput = (v) => (v ? nf(v / 1e9, 2) : "");

function renderPicker() {
  const root = document.getElementById("view");
  const st = C.state, g = P.game, game = GAMES[g], d = st.games[g], nx = d.next;
  const pl = st.plan && st.plan.game === g ? st.plan : null;
  if (!pl && P.mode === "plan") P.mode = "new";
  const isPlan = !!pl && P.mode === "plan", T = curT();
  ensureInputs();
  const gameSeg = `<div class="seg" role="group" aria-label="Trò chơi">${GIDS.map((id) => `<button type="button" data-act="game" data-v="${id}" data-k="g${id}" aria-pressed="${id === g}">${GAMES[id].name}</button>`).join("")}</div>`;
  const modeSeg = pl ? `<div class="seg" role="group" aria-label="Bộ vé">${[["plan", "Công thức của tôi"], ["new", "Bộ mới theo cùng công thức"]].map(([v, l]) => `<button type="button" data-act="mode" data-v="${v}" data-k="m${v}" aria-pressed="${P.mode === v}">${l}</button>`).join("")}</div>` : "";
  const dealBlock = isPlan
    ? `<p>${esc(pl.note)}</p><p>${chip(pl.next_bought, pl.next_draw)}</p>`
    : `<div class="stepper" role="group" aria-label="Số vé"><button type="button" data-act="dec" data-k="dec" aria-label="Bớt một vé">−</button><output aria-live="polite"><b>${P.k}</b> vé</output><button type="button" data-act="inc" data-k="inc" aria-label="Thêm một vé">+</button></div>
       <button type="button" class="btn red" data-act="deal" data-k="deal">Chia vé</button>`;
  const info = `<p class="cap">${nx ? `Kỳ tới #${nx.id}, ${wd(nx.date)} ${dm(nx.date)}. ` : ""}${isPlan ? "" : `Công thức: các vé không chung số, ưu tiên số ít người chọn, bỏ các kiểu số hay trùng. Tối đa ${game.maxTickets} vé mỗi lượt.`}</p>`;
  const control = `<h2>${game.name}</h2>${gameSeg}${modeSeg}${info}${dealBlock}`;
  ix = 0;
  const head = tile("s7 ink", `<h1>Chia vé không trùng số</h1><p>Kết quả quay luôn ngẫu nhiên đều, số nào cũng như số nào. Chỉ có hai việc đáng làm: các vé không chung số nào để dễ trúng giải hơn, và né số nhiều người chọn để ít phải chia jackpot.</p>`) + tile("s5", control);
  if (!T) {
    root.innerHTML = head + tile("s12", `<p role="alert">${esc(P.err || "Chưa có vé.")}</p>`);
    return;
  }
  const inp = P.inp, alpha = d.alpha;
  const o = oddsFigures(g, T), e = evSet(g, T, alpha, inp), cost = T.length * PRICE;
  const sp = spans(T.length), fresh = P.fresh && !isPlan;
  const tickets = T.map((t, i) => `<article class="tile tk${fresh ? " deal" : ""}${i === T.length - 1 && T.length % 2 ? " lone" : ""}" style="--span:${sp[i]};--i:${ix++}">
      <header><h3>Vé ${LETTERS[i]}</h3><span class="rho" title="Số vé khác trùng đúng bộ này, so với vé trung bình (1,0)">ρ ${nf(e.rho[i], 2)}</span></header>
      <div class="marks">${t.map((x) => mk(x)).join("")}</div>
      <p class="cap">Kỳ vọng <b data-ev="${i}">${dong(e.ev[i])}</b> trên ${dong(PRICE)}</p></article>`).join("");
  const sms = smsLines(game, T);
  const be = breakEvenJackpot(game, { jp2: inp.jp2, sales: inp.sales, rho: mean(e.rho) });
  const bought = isPlan && pl.next_bought;
  const ownBlock = `<h2>Vé của riêng bạn</h2><label class="field" for="own">Mỗi dòng một vé, 6 số cách nhau bằng dấu cách (${game.name}, số từ 1 đến ${game.n})</label>
      <textarea id="own" data-in="own" rows="6" spellcheck="false" placeholder="03 17 26 38 44 52">${esc(P.own)}</textarea>`;
  root.innerHTML = head
    + tile("s7", `<h2>Phiếu số: vé nào giữ số nào</h2>${slipHtml(g, T)}<p class="cap">Mỗi số chỉ nằm ở một vé, nên các vé không bao giờ trúng cùng lúc bằng cùng một số.</p>`)
    + `<div class="col s5">${tile("odds", `<div class="pair"><div><p class="fig" data-fig="any">${pct(o.any)}</p><p>Ít nhất một vé trúng giải (từ 3 số): <span class="cap">${nf(o.c.any)} / ${nf(o.c.total)} bộ số có thể quay</span></p></div><div><p class="fig">${pct(o.ge4)}</p><p>Có vé trúng từ 4 số: <span class="cap">${nf(o.c.ge4)} / ${nf(o.c.total)}</span></p></div></div>`)}
        ${tile("", `<p class="fig" data-evtot>${dong(e.total)}</p><p>Giá trị kỳ vọng cả bộ, trên ${dong(cost)} đã chi (<span data-evpct>${pct(e.total / cost, 0)}</span>)</p><p>Jackpot 1: 1 trên ${nf(1 / o.jp)}. Hoà vốn khi Jackpot 1 đạt <span data-be>${be ? ty(be) : "không bao giờ"}</span>.</p>`)}</div>`
    + tickets
    + tile("s5", `<h2>Giả định cho kỳ tới</h2>
        <label class="field" for="jp1">Jackpot 1 (tỷ đồng)</label><input id="jp1" data-in="jp1" inputmode="decimal" value="${tyInput(inp.jp1)}">
        ${g === "655" ? `<label class="field" for="jp2">Jackpot 2 (tỷ đồng)</label><input id="jp2" data-in="jp2" inputmode="decimal" value="${tyInput(inp.jp2)}">` : ""}
        <label class="field" for="sales">Số vé bán ra</label><input id="sales" data-in="sales" inputmode="numeric" value="${inp.sales ? nf(inp.sales) : ""}">
        <button type="button" class="btn soft" data-act="resetInp" data-k="resetInp">Lấy lại ước tính</button>
        <p class="cap">Đã điền sẵn từ ước tính của kỳ tới. Sửa để xem giá trị kỳ vọng đổi theo.</p>`)
    + `<div class="col s7">${tile("", `<h2>Tin nhắn mua vé</h2>${sms.map((l) => `<code class="sms">${esc(l)}</code>`).join("")}<button type="button" class="btn soft" data-act="copy" data-copy="${esc(sms.join("\n"))}" data-k="copy">Sao chép</button><p class="cap">Gửi tới 9969 bằng ZaloPay (Vietlott SMS). Chỉ khi có tin xác nhận “ky QSMT” đúng kỳ tới mới tính là mua được. <a href="#/luat">Xem đủ hướng dẫn</a></p>`)}
        ${tile("", `<h2>Lưu vào sổ</h2><label class="field" for="code">Mã vé (không bắt buộc)</label><input id="code" data-in="code" autocomplete="off" value="${esc(P.code)}">
          <button type="button" class="btn" data-act="save" data-k="save"${nx && !bought ? "" : " disabled"}>Lưu vào sổ</button>
          <p class="cap" role="status">${P.saveErr ? esc(P.saveErr) : P.saved ? esc(P.saved) + ' <a href="#/so-ve">Mở sổ vé</a>' : bought ? `Kỳ ${idk(pl.next_draw)} đã có trong sổ.` : nx ? `Ghi ${T.length} vé cho kỳ #${nx.id}.` : "Chưa có kỳ tới để ghi."}</p>`)}
        ${tile("", replayHtml(g, T))}</div>`
    + tile("s5", ownBlock) + tile("s7 own", `<div id="own-out"></div>`)
    + (P.err && !isPlan ? tile("s12", `<p role="alert">${esc(P.err)}</p>`) : "");
  P.fresh = false;
  updateOwn();
}
function updateOwn() {
  const out = document.getElementById("own-out");
  if (!out) return;
  const g = P.game, d = C.state.games[g];
  const { tickets, errs } = parseTickets(P.own, GAMES[g].n);
  let html = errs.length ? `<ul class="errs" role="alert">${errs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  if (tickets.length) html += analysisHtml(g, tickets, d.alpha, P.inp) + replayHtml(g, tickets);
  else if (!errs.length) html = `<p>Gõ vài vé vào ô bên trái để xem xác suất, giá trị kỳ vọng, độ phổ biến ρ và kết quả nếu đã mua bộ này từ đầu.</p>`;
  out.innerHTML = html;
}
function updateEv() {
  const g = P.game, game = GAMES[g], T = curT(), inp = P.inp, root = document.getElementById("view");
  if (!T) return;
  const e = evSet(g, T, C.state.games[g].alpha, inp), cost = T.length * PRICE;
  e.ev.forEach((v, i) => { const el = root.querySelector(`[data-ev="${i}"]`); if (el) el.textContent = dong(v); });
  const set = (sel, v) => { const el = root.querySelector(sel); if (el) el.textContent = v; };
  set("[data-evtot]", dong(e.total));
  set("[data-evpct]", pct(e.total / cost, 0));
  const be = breakEvenJackpot(game, { jp2: inp.jp2, sales: inp.sales, rho: mean(e.rho) });
  set("[data-be]", be ? ty(be) : "không bao giờ");
  updateOwn();
}
async function viewPicker() {
  const st = await getState();
  if (P.mode == null) P.mode = st.plan ? "plan" : "new";
  if (P.mode === "plan" && st.plan) P.game = st.plan.game;
  await getDraws(P.game);
  if (!P.tickets || P.tickets.length !== P.k) build();
  renderPicker();
}
function rerender() {
  const f = document.activeElement?.dataset?.k;
  const y = window.scrollY;
  renderPicker();
  window.scrollTo(0, y);
  if (f) document.querySelector(`#view [data-k="${f}"]`)?.focus({ preventScroll: true });
}

/* ---------- Sổ vé ---------- */
function ticketRow(g, t, res, i) {
  if (!res) return `<li><span class="marks sm">${t.map((x) => mk(x, "dim")).join("")}</span><span class="cap">chờ kết quả</span></li>`;
  const main = new Set(res.main), m = res.matches[i], key = res.prizes[i];
  const bonusHit = g === "655" && m === 5 && t.includes(res.bonus);
  const label = key ? `${m} số${bonusHit ? " + đặc biệt" : ""}: ${prizeName(g, key)}` : `${m} số`;
  return `<li><span class="marks sm">${t.map((x) => mk(x, main.has(x) ? "hit" : bonusHit && x === res.bonus ? "" : "dim")).join("")}</span><span>${esc(label)}</span></li>`;
}
async function viewLedger(root) {
  const [st, list] = await Promise.all([getState(), getPurchases()]);
  const spent = list.reduce((s, p) => s + p.cost, 0), won = list.reduce((s, p) => s + (p.result ? p.result.won : 0), 0);
  // running net: oldest purchase first, pending purchases already count as spent
  const cum = new Map();
  let run = 0;
  for (const p of [...list].sort((a, b) => a.draw_id - b.draw_id || a.id - b.id)) { run += (p.result ? p.result.won : 0) - p.cost; cum.set(p.id, run); }
  const maxN = Math.max(1, ...list.map((p) => p.tickets.length));
  const dateOf = (p) => { const nx = st.games[p.game]?.next, d = p.draw_date || (nx && nx.id === p.draw_id ? nx.date : ""); return d ? dmy(d) : "chưa quay"; };
  const rows = list.map((p) => `<tr>
      <td data-l="Kỳ quay"><b>#${p.draw_id}</b><br>${dateOf(p)}<br>${GAMES[p.game]?.name ?? p.game}</td>
      <td data-l="Vé và kết quả"><ul class="tl">${p.tickets.map((t, i) => ticketRow(p.game, t, p.result, i)).join("")}</ul>${p.code ? `<p class="cap code-id">Mã vé ${esc(p.code)}</p>` : ""}</td>
      <td data-l="Trùng (từng vé)">${p.result ? p.result.matches.join("-") : "–"}</td>
      <td data-l="Chi">${dong(p.cost)}</td>
      <td data-l="Tiền trúng">${p.result ? dong(p.result.won) : "chờ quay"}</td>
      <td data-l="Cộng dồn">${signed(cum.get(p.id))}</td>
      <td><button class="btn soft" data-act="del" data-id="${p.id}" data-k="del${p.id}">Xoá</button></td></tr>`).join("");
  const table = list.length
    ? `<div class="tablewrap"><table class="t stack"><thead><tr><th>Kỳ quay</th><th>Vé và kết quả</th><th>Trùng (vé 1–${maxN})</th><th>Chi</th><th>Tiền trúng</th><th>Cộng dồn</th><th><span class="sr">Xoá</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p>Chưa có vé nào trong sổ. Chia vé ở mục Chọn vé rồi bấm “Lưu vào sổ”, hoặc thêm vé đã mua bằng biểu mẫu bên dưới.</p>`;
  const n655 = st.games["655"].next;
  root.innerHTML = [
    tile("s6 ink", `<h1>Vé đã mua, đã trúng bao nhiêu</h1><p>Chỉ giải thưởng đã quay mới được tính. Jackpot trúng lấy theo giá trị của kỳ đó, sau thuế.</p>`),
    tile("s2 fg", `<p class="fig">${dong(spent)}</p><p>Đã chi</p>`),
    tile("s2 fg", `<p class="fig">${dong(won)}</p><p>Đã trúng</p>`),
    tile("s2 fg", `<p class="fig">${signed(won - spent)}</p><p>Chênh lệch</p>`),
    tile("s12", table),
    tile("s12", `<h2>Thêm vé đã mua</h2><form class="formgrid" data-submit="add" novalidate>
      <div class="seg" role="radiogroup" aria-label="Trò chơi">${GIDS.map((id, i) => `<label><input type="radio" name="game" value="${id}"${i === 0 ? " checked" : ""}><span>${GAMES[id].name}</span></label>`).join("")}</div>
      <div><label class="field" for="a-draw">Kỳ quay</label><input id="a-draw" name="draw" inputmode="numeric" value="${n655 ? n655.id : ""}"></div>
      <div><label class="field" for="a-code">Mã vé (không bắt buộc)</label><input id="a-code" name="code" autocomplete="off"></div>
      <div class="wide"><label class="field" for="a-t">Vé, mỗi dòng một vé</label><textarea id="a-t" name="tickets" rows="5" spellcheck="false" placeholder="03 17 26 38 44 52"></textarea></div>
      <div class="wide"><button class="btn" type="submit" data-k="add">Thêm vào sổ</button><p class="cap" role="status" id="add-msg"></p></div></form>`),
  ].join("");
}

/* ---------- Phòng thử ---------- */
function barsHtml(g, f) {
  const n = GAMES[g].n, e = f.expected, sd = Math.sqrt(e * (1 - 6 / n));
  const M = Math.max(2.4 * sd, ...f.counts.map((c) => Math.abs(c - e)));
  const H = 120, band = ((2 * sd) / M) * H;
  const bars = f.counts.map((c, i) => {
    const dv = ((c - e) / M) * H;
    return `<li title="Số ${i + 1}: ${c} lần (kỳ vọng ${nf(e, 1)})"><span class="plot"><b class="${dv >= 0 ? "up" : "dn"}" style="--h:${Math.abs(dv).toFixed(1)}px"></b></span><span class="n">${i + 1}</span></li>`;
  }).join("");
  return `<ol class="bars" style="--n:${n};--band:${band.toFixed(1)}px" aria-label="Số lần mỗi số xuất hiện so với kỳ vọng">${bars}</ol>`;
}
function freqWords(f) {
  const base = `Kiểm định chi bình phương (χ²) cho thấy χ² = ${nf(f.chi2, 1)} với ${f.df} bậc tự do, p = ${nf(f.p, 2)}.`;
  return f.p >= 0.05
    ? `${base} Nói bằng lời: các số xuất hiện đều đến mức chỉ cần may rủi cũng ra như vậy. Không có số nào “nóng” hay “lạnh” thật.`
    : `${base} Nói bằng lời: độ lệch lớn hơn mức may rủi thường gặp, nhưng thử nhiều lần thì cứ 20 lần lại có 1 lần p < 0,05 do tình cờ, và độ lệch này cũng không cho biết kỳ sau ra số nào.`;
}
async function viewLab(root) {
  root.innerHTML = tile("s12", `<p aria-busy="true">Đang chạy backtest, lần đầu có thể mất vài giây…</p>`);
  const labs = await Promise.all(GIDS.map(getLab));
  ix = 0;
  const scored = labs[0].draws_scored;
  const sections = GIDS.map((g, i) => {
    const L = labs[i], game = GAMES[g];
    const expHit = L.expected_hit_rate ?? game.prizes.reduce((s, p) => s + p.count, 0) / game.total;
    const rows = L.strategies.map((s) => `<tr><td data-l="Chiến lược"><b>${esc(s.name)}</b><br><span class="cap">${esc(s.desc)}</span></td>
        <td data-l="Số trúng trung bình">${nf(s.mean_matches, 3)} <span class="cap">kỳ vọng ${nf(L.expected_matches, 3)}</span></td>
        <td data-l="Tỉ lệ trúng từ 3 số">${pct(s.hit_rate, 2)} <span class="cap">kỳ vọng ${pct(expHit, 2)}</span></td>
        <td data-l="p">${nf(s.p, 2)}</td><td data-l="Kết luận">${esc(s.verdict)}</td></tr>`).join("");
    const pl = L.plan;
    const planT = pl ? tile("s12", `<h2>${esc(pl.name)}</h2>
        <div class="trio"><div><p class="fig">${pct(pl.hit_rate, 1)}</p><p>Trúng ít nhất một giải: ${nf(pl.hits)} trên ${nf(pl.draws)} kỳ</p></div>
        <div><p class="fig">${pct(pl.expected_hit_rate, 2)}</p><p>Kỳ vọng nếu hoàn toàn ngẫu nhiên</p></div>
        <div><p class="fig">${nf(pl.p, 3)}</p><p>Giá trị p: ${pl.p < 0.05 ? "khác ngẫu nhiên, nhưng thử nhiều lần thì có lúc p dưới 0,05 do tình cờ" : "như ngẫu nhiên"}</p></div></div>
        <p>${esc(pl.note)}</p>`) : "";
    return planT + tile("s12", `<h2>${game.name}: ${nf(L.draws_scored)} kỳ được chấm</h2>
        <div class="tablewrap"><table class="t stack"><thead><tr><th>Chiến lược</th><th>Số trúng trung bình</th><th>Tỉ lệ trúng từ 3 số</th><th>p</th><th>Kết luận</th></tr></thead><tbody>${rows}</tbody></table></div>`)
      + tile("s12", `<h2>${game.name}: mỗi số ra bao nhiêu lần</h2>${barsHtml(g, L.frequency)}<p>Cột lên là số ra nhiều hơn kỳ vọng ${nf(L.frequency.expected, 1)} lần, cột xuống là ít hơn. Vùng nhạt là dao động bình thường (hai độ lệch chuẩn). ${freqWords(L.frequency)}</p>`);
  }).join("");
  root.innerHTML = tile("s8 ink", `<h1>Không chiến lược nào thắng ngẫu nhiên</h1><p>Mỗi chiến lược chỉ được nhìn các kỳ trước kỳ nó đoán, rồi chấm trên ${nf(scored)} kỳ thật. Chiến lược nào có p dưới 0,05 thì thường là may: thử sáu cách, cứ 20 lần có một lần như vậy do tình cờ.</p>`)
    + tile("s4", `<p class="fig">${nf(labs[0].expected_matches, 2)}</p><p>Số trúng trung bình của một vé ngẫu nhiên ở Power 6/55, và các chiến lược bên dưới cũng quanh mức đó.</p>`)
    + sections;
}

/* ---------- Luật & tỉ lệ ---------- */
async function viewRules(root) {
  const st = await getState();
  const oddsTile = (g) => {
    const game = GAMES[g], nx = st.games[g].next, total = game.total;
    const any = game.prizes.reduce((s, p) => s + p.count, 0);
    const rows = game.prizes.map((p) => {
      const jp = p.key === "jp1" || p.key === "jp2";
      const v = p.key === "jp1" ? nx?.jp1 : p.key === "jp2" ? nx?.jp2 : p.value;
      const prize = v == null ? "tích luỹ" : jp ? `${ty(v)} kỳ tới, sau thuế ${ty(net(v))}` : `${dong(v)}, sau thuế ${dong(net(v))}`;
      const r = total / p.count;
      return `<tr><td data-l="Giải"><b>${p.name}</b><br><span class="cap">${p.match}</span></td><td data-l="Số bộ số">${nf(p.count)}</td><td data-l="Tỉ lệ">1 trong ${nf(r, r < 100 ? 1 : 0)}</td><td data-l="Giải thưởng">${prize}</td></tr>`;
    }).join("");
    return tile("s6", `<h2>${game.name}, quay ${game.days}</h2><div class="tablewrap"><table class="t stack"><thead><tr><th>Giải</th><th>Số bộ số</th><th>Tỉ lệ</th><th>Giải thưởng</th></tr></thead><tbody>${rows}<tr><td data-l="Giải"><b>Bất kỳ giải nào</b></td><td data-l="Số bộ số">${nf(any)}</td><td data-l="Tỉ lệ">1 trong ${nf(total / any, 1)}</td><td data-l="Giải thưởng">từ 3 số trở lên</td></tr></tbody></table></div><p class="cap">Tổng ${nf(total)} bộ số. Thuế 10% phần giải của mỗi vé vượt 20 triệu đồng, như công thức của trang này đang tính.</p>`);
  };
  root.innerHTML = [
    tile("s6 ink", `<h1>Luật chơi và tỉ lệ thật</h1><p>Chọn 6 số, quay 6 số (Power 6/55 có thêm một số đặc biệt). Mỗi vé ${dong(PRICE)}. Số nào cũng có cơ hội như nhau, vé trúng hay không là chuyện may.</p>`),
    tile("s6", `<h2>Mua bằng tin nhắn</h2><ol class="steps"><li>Chép dòng tin nhắn ở mục Chọn vé.</li><li>Gửi tới <b>9969</b> bằng ZaloPay, mục Vietlott SMS.</li><li>Đợi tin xác nhận. Tin phải ghi “ky QSMT” đúng kỳ quay tới.</li><li>Không có xác nhận thì <b>đừng gửi lại</b>. Gọi <b>1900 599 822</b> để hỏi.</li></ol>`),
    oddsTile("655"), oddsTile("645"),
    tile("s12", `<h2>Chơi có chừng mực</h2><p>Về lâu dài mỗi vé ${dong(PRICE)} lấy lại ít hơn ${dong(PRICE)}. Chỉ chơi bằng số tiền bạn sẵn sàng mất hẳn, đặt trước hạn mức mỗi tháng và đừng nâng lên để gỡ. Chỉ người từ 18 tuổi trở lên được mua. Nếu thấy khó dừng, hãy dừng và nói với người thân.</p>`),
  ].join("");
}

/* ---------- actions ---------- */
const ACT = {
  game(b) { P.game = b.dataset.v; const pl = C.state.plan; P.mode = pl && pl.game === P.game ? "plan" : "new"; P.inpGame = null; viewPickerSwitch(); },
  mode(b) { P.mode = b.dataset.v; rerender(); },
  inc() { P.k = Math.min(P.k + 1, GAMES[P.game].maxTickets); build(); rerender(); },
  dec() { P.k = Math.max(P.k - 1, 1); build(); rerender(); },
  deal() { P.mode = "new"; build(); rerender(); },
  resetInp() { P.inpGame = null; ensureInputs(); rerender(); },
  async copy(b) {
    const text = b.dataset.copy;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    b.textContent = "Đã sao chép";
    setTimeout(() => { b.textContent = "Sao chép"; }, 1600);
  },
  async save(b) {
    const nx = C.state.games[P.game].next;
    b.disabled = true; b.setAttribute("aria-busy", "true");
    try {
      const body = { game: P.game, draw_id: nx.id, tickets: curT() };
      if (P.code.trim()) body.code = P.code.trim();
      const r = await api("/purchases", { method: "POST", body });
      C.purchases = null; C.state = null; await getState();
      P.saved = `Đã lưu ${r.tickets.length} vé cho kỳ #${r.draw_id}, ${dong(r.cost)}.`; P.saveErr = "";
    } catch (e) { P.saveErr = e.message; P.saved = ""; }
    rerender();
  },
  async planBuy(b) {
    const pl = C.state.plan, msg = document.getElementById("plan-msg");
    b.disabled = true; b.setAttribute("aria-busy", "true");
    try {
      const body = { game: pl.game, draw_id: pl.next_draw, tickets: pl.tickets };
      if (P.planCode.trim()) body.code = P.planCode.trim();
      await api("/purchases", { method: "POST", body });
      P.planCode = ""; C.purchases = C.state = null; await route(true);
    } catch (e) { msg.textContent = e.message; b.disabled = false; b.removeAttribute("aria-busy"); }
  },
  async del(b) {
    if (!confirm("Xoá lần mua này khỏi sổ vé?")) return;
    b.disabled = true;
    try { await api(`/purchases/${b.dataset.id}`, { method: "DELETE" }); C.purchases = C.state = null; await route(true); } catch (e) { alert(e.message); b.disabled = false; }
  },
  async sync(b) {
    b.disabled = true; b.setAttribute("aria-busy", "true"); b.textContent = "Đang cập nhật…";
    const log = b.parentElement.querySelector(".log");
    log.textContent = "Có thể mất tới 30 giây.";
    try { C.syncLog = await api("/sync", { method: "POST", body: {} }); dropData(); await route(true); }
    catch (e) { b.disabled = false; b.removeAttribute("aria-busy"); b.textContent = "Cập nhật ngay"; log.innerHTML = `<p role="alert">${esc(e.message)}</p>`; }
  },
};
async function viewPickerSwitch() { await getDraws(P.game); build(); rerender(); }

const INP = {
  jp1(el) { const v = parseTy(el.value); if (v != null) { P.inp.jp1 = v; updateEv(); } },
  jp2(el) { const v = parseTy(el.value); if (v != null) { P.inp.jp2 = v; updateEv(); } },
  sales(el) { const v = parseCount(el.value); if (v != null) { P.inp.sales = v; updateEv(); } },
  code(el) { P.code = el.value; },
  plancode(el) { P.planCode = el.value; },
  own(el) { P.own = el.value; clearTimeout(INP.t); INP.t = setTimeout(updateOwn, 250); },
};
const SUBMIT = {
  async add(f) {
    const msg = document.getElementById("add-msg"), g = f.game.value, n = GAMES[g].n;
    const { tickets, errs } = parseTickets(f.tickets.value, n);
    if (errs.length || !tickets.length) { msg.textContent = errs[0] || "Nhập ít nhất một vé."; return; }
    const draw = parseCount(f.draw.value);
    if (!draw) { msg.textContent = "Nhập số kỳ quay."; return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const body = { game: g, draw_id: draw, tickets };
      if (f.code.value.trim()) body.code = f.code.value.trim();
      await api("/purchases", { method: "POST", body });
      C.purchases = C.state = null; await route(true);
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  },
};

/* ---------- router ---------- */
const VIEWS = { bang: [viewBang, "Bảng"], "chon-ve": [viewPicker, "Chọn vé"], "so-ve": [viewLedger, "Sổ vé"], "phong-thu": [viewLab, "Phòng thử"], luat: [viewRules, "Luật & tỉ lệ"] };
let token = 0, enterTimer = 0;
async function route(stay = false) {
  const key = location.hash.replace(/^#\/?/, "") || "bang";
  const [fn, title] = VIEWS[key] || VIEWS.bang;
  const root = document.getElementById("view"), my = ++token;
  if (!stay) C.syncLog = null;
  document.title = `${title} · vietlot`;
  document.querySelectorAll(".links a").forEach((a) => (a.dataset.r === (VIEWS[key] ? key : "bang") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  root.className = "board";
  try {
    if (!stay) { ix = 0; root.innerHTML = busyTile("Đang tải…"); }
    ix = 0;
    await fn(root);
    if (my !== token) return;
  } catch (e) {
    if (my !== token) return;
    ix = 0; root.innerHTML = errTile(e);
  }
  if (stay) return;
  root.classList.add("enter");
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => root.classList.remove("enter"), 1600);
  window.scrollTo(0, 0);
  root.focus({ preventScroll: true });
}

const root = document.getElementById("view");
root.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && ACT[b.dataset.act]) { root.classList.remove("enter"); ACT[b.dataset.act](b, e); }
});
const onField = (e) => { const f = e.target.dataset?.in; if (f && INP[f]) INP[f](e.target); };
root.addEventListener("input", onField);
root.addEventListener("change", (e) => {
  onField(e);
  if (e.target.name === "game" && e.target.closest("form")) {
    const nx = C.state?.games[e.target.value]?.next;
    e.target.form.draw.value = nx ? nx.id : "";
  }
});
root.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-submit]");
  if (f) { e.preventDefault(); SUBMIT[f.dataset.submit](f); }
});
document.getElementById("nav-act").addEventListener("click", (e) => {
  if (location.hash === "#/chon-ve" && P.tickets) { e.preventDefault(); ACT.deal(); }
});
window.addEventListener("hashchange", () => route());
route();
