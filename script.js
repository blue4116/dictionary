const STORAGE_KEY = "my-word-dictionary-v1";
const { createClient } = supabase;

let client = null;
let currentUser = null;
let entries = [];
let authMode = "login";
let todayWordId = null;
let reviewEntryId = null;
let reviewRevealed = false;

const $ = id => document.getElementById(id);
const dialog = $("entryDialog");
const form = $("entryForm");
const detailDialog = $("detailDialog");
const searchSuggestions = $("searchSuggestions");

function configured() {
  return SUPABASE_URL.startsWith("http") &&
         !SUPABASE_URL.includes("ここに") &&
         SUPABASE_PUBLISHABLE_KEY &&
         !SUPABASE_PUBLISHABLE_KEY.includes("ここに");
}

function setAuthMessage(message, error = true) {
  $("authMessage").textContent = message;
  $("authMessage").style.color = error ? "var(--danger)" : "var(--success)";
}

function setAuthMode(mode) {
  authMode = mode;
  $("loginTab").classList.toggle("active", mode === "login");
  $("signupTab").classList.toggle("active", mode === "signup");
  $("authSubmit").textContent = mode === "login" ? "ログイン" : "アカウントを作成";
  $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  setAuthMessage("");
}

function getAuthRedirectUrl() {
  // GitHub Pagesのようなサブパス公開にも対応して、
  // 「今開いているアプリのURL」へ確認後に戻します。
  return window.location.origin + window.location.pathname;
}

function handleAuthCallbackError() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");

  if (errorCode || errorDescription) {
    const message = errorCode === "otp_expired"
      ? "確認リンクの有効期限が切れているか、すでに確認済みです。新しい確認メールを送信してください。"
      : "メールアドレスの確認に失敗しました。確認メールをもう一度送信してください。";
    setAuthMessage(message);
    history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return true;
  }
  return false;
}

async function init() {
  if (!configured()) {
    setAuthMessage("Supabase設定がまだ完了していません。config.jsにProject URLとPublishable keyを設定してください。");
    $("authSubmit").disabled = true;
    return;
  }

  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const callbackHadError = handleAuthCallbackError();
  const { data } = await client.auth.getSession();

  if (data.session?.user) {
    await startApp(data.session.user);
  }

  client.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      await startApp(session.user);
    } else if (event === "SIGNED_OUT") {
      currentUser = null;
      entries = [];
      showAuth();
    }
  });
}

async function startApp(user) {
  currentUser = user;
  $("accountEmail").textContent = user.email || "ログイン中";
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
  await loadEntries();
  checkLegacyData();
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
}

async function loadEntries() {
  const { data, error } = await client
    .from("dictionary_entries")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("updated_at", { ascending: false });

  if (error) {
    showStatus("データを読み込めませんでした。SupabaseのSQL/RLS設定を確認してください。", true);
    console.error(error);
    return;
  }

  entries = data.map(fromDb);
  render();
}

function fromDb(row) {
  return {
    id: row.id,
    word: row.word,
    reading: row.reading || "",
    meaning: row.meaning || "",
    example: row.example || "",
    category: row.category || "",
    tags: row.tags || "",
    relatedWords: row.related_words || "",
    memo: row.memo || "",
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toDb(entry) {
  return {
    id: entry.id,
    user_id: currentUser.id,
    word: entry.word,
    reading: entry.reading || "",
    meaning: entry.meaning || "",
    example: entry.example || "",
    category: entry.category || "",
    tags: entry.tags || "",
    related_words: entry.relatedWords || "",
    memo: entry.memo || "",
    favorite: Boolean(entry.favorite),
    created_at: entry.createdAt,
    updated_at: entry.updatedAt
  };
}

async function saveNewEntry(entry) {
  const { error } = await client.from("dictionary_entries").insert(toDb(entry));
  if (error) throw error;
}

async function updateEntryCloud(entry) {
  const { error } = await client
    .from("dictionary_entries")
    .update(toDb(entry))
    .eq("id", entry.id)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

async function deleteEntryCloud(id) {
  const { error } = await client
    .from("dictionary_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[char]));
}

function formatDate(value, includeTime = false) {
  const options = { year:"numeric", month:"numeric", day:"numeric" };
  if (includeTime) Object.assign(options, { hour:"2-digit", minute:"2-digit" });
  return new Intl.DateTimeFormat("ja-JP", options).format(new Date(value));
}

function getCategories() {
  return [...new Set(entries.map(e => e.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ja"));
}

function parseRelatedWords(value) {
  return String(value || "")
    .split(/[,、，\n]+/)
    .map(word => word.trim())
    .filter(Boolean);
}

function normalizeWord(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function findEntryByWord(word) {
  const target = normalizeWord(word);
  return entries.find(entry => normalizeWord(entry.word) === target) || null;
}

function getRelatedEntryIds(entry) {
  const ids = new Set();
  parseRelatedWords(entry.relatedWords).forEach(word => {
    const match = findEntryByWord(word);
    if (match && match.id !== entry.id) ids.add(match.id);
  });
  return [...ids];
}

function getIncomingRelatedEntries(entry) {
  const target = normalizeWord(entry.word);
  return entries.filter(other =>
    other.id !== entry.id &&
    parseRelatedWords(other.relatedWords).some(word => normalizeWord(word) === target)
  );
}

function renderNetworkPanel() {
  const summary = $("networkSummary");
  const container = $("networkLinks");
  if (!summary || !container) return;

  const links = [];
  const seen = new Set();
  entries.forEach(entry => {
    parseRelatedWords(entry.relatedWords).forEach(word => {
      const target = findEntryByWord(word);
      if (!target || target.id === entry.id) return;
      const key = [entry.id, target.id].sort().join("::");
      if (seen.has(key)) return;
      seen.add(key);
      links.push([entry, target]);
    });
  });

  summary.textContent = `${links.length}つのつながり / ${entries.length}語`;
  if (!links.length) {
    container.innerHTML = '<div class="network-empty">関連語を登録すると、登録済みの言葉同士がここに表示されます。</div>';
    return;
  }

  container.innerHTML = links.slice(0, 12).map(([from, to]) => `
    <div class="network-link-row">
      <button class="network-word" onclick="focusEntry('${from.id}')">${escapeHtml(from.word)}</button>
      <span class="network-arrow">↔</span>
      <button class="network-word" onclick="focusEntry('${to.id}')">${escapeHtml(to.word)}</button>
    </div>
  `).join("");
}

function renderSearchSuggestions() {
  const values = new Set();
  entries.forEach(entry => {
    [entry.word, entry.reading, entry.category, ...String(entry.tags || "").split(",")].forEach(value => {
      const text = String(value || "").trim();
      if (text) values.add(text);
    });
  });
  searchSuggestions.innerHTML = [...values].sort((a,b)=>a.localeCompare(b,"ja")).map(value => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function getDiscoveryMatches(entry) {
  const targetTags = new Set(String(entry.tags || "").split(",").map(v=>v.trim().toLocaleLowerCase()).filter(Boolean));
  return entries.filter(other => {
    if (other.id === entry.id) return false;
    const sameCategory = entry.category && other.category && entry.category === other.category;
    const otherTags = String(other.tags || "").split(",").map(v=>v.trim().toLocaleLowerCase()).filter(Boolean);
    const sharedTag = otherTags.some(tag => targetTags.has(tag));
    const related = parseRelatedWords(entry.relatedWords).some(word => normalizeWord(word) === normalizeWord(other.word)) || parseRelatedWords(other.relatedWords).some(word => normalizeWord(word) === normalizeWord(entry.word));
    return sameCategory || sharedTag || related;
  });
}

function renderCategoryFilter() {
  const categories = getCategories();
  const current = $("categoryFilter").value;

  $("categoryFilter").innerHTML =
    '<option value="">すべてのカテゴリー</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  $("categoryFilter").value = categories.includes(current) ? current : "";
  $("categoryOptions").innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join("");
  $("categoryChips").innerHTML = categories.length
    ? categories.map(c => `<button class="category-chip" onclick="filterByCategory('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join("")
    : '<span class="reading">カテゴリーはまだありません</span>';
}

function renderStats() {
  $("totalCount").textContent = entries.length;
  $("favoriteCount").textContent = entries.filter(e => e.favorite).length;
  $("categoryCount").textContent = getCategories().length;
}

function miniEntryHtml(entry, dateKey) {
  return `<div class="mini-item" onclick="focusEntry('${entry.id}')">
    <div><span class="mini-word">${escapeHtml(entry.word)}</span>${entry.reading ? `<span class="mini-reading">${escapeHtml(entry.reading)}</span>` : ""}</div>
    <div class="mini-date">${formatDate(entry[dateKey], true)}</div>
  </div>`;
}

function getReviewCandidates() {
  return entries.filter(entry => entry.word);
}

function renderReview(preferredId = null) {
  const candidates = getReviewCandidates();
  const card = $("reviewCard");
  const progress = $("reviewProgress");
  if (!candidates.length) {
    reviewEntryId = null;
    reviewRevealed = false;
    progress.textContent = "0件";
    card.innerHTML = '<div class="review-empty">言葉を登録すると、ここで復習できます。</div>';
    $("reviewRevealButton").disabled = true;
    $("reviewNextButton").disabled = true;
    return;
  }
  let entry = preferredId ? candidates.find(e => e.id === preferredId) : null;
  if (!entry) entry = candidates[Math.floor(Math.random() * candidates.length)];
  reviewEntryId = entry.id;
  reviewRevealed = false;
  progress.textContent = `全${candidates.length}件から出題`;
  card.innerHTML = `
    <div class="review-label">思い出してみましょう</div>
    <div class="review-word">${escapeHtml(entry.word)}</div>
    ${entry.reading ? `<div class="review-reading">読み：${escapeHtml(entry.reading)}</div>` : ""}
    <div class="review-answer ${reviewRevealed ? "is-visible" : ""}">${reviewRevealed ? `<span class="review-answer-label">意味</span><div>${escapeHtml(entry.meaning || "まだ意味が登録されていません。")}</div>` : "答えを見るまで非表示"}</div>
  `;
  $("reviewRevealButton").disabled = false;
  $("reviewNextButton").disabled = false;
}

function revealReview() {
  const entry = entries.find(e => e.id === reviewEntryId);
  if (!entry) return;
  reviewRevealed = true;
  const answer = $("reviewCard").querySelector(".review-answer");
  if (answer) {
    answer.classList.add("is-visible");
    answer.innerHTML = `<span class="review-answer-label">意味</span><div>${escapeHtml(entry.meaning || "まだ意味が登録されていません。")}</div>`;
  }
  $("reviewRevealButton").disabled = true;
}

function renderDashboard() {
  const recent = [...entries].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
  const edited = [...entries].sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5);

  $("recentEntries").innerHTML = recent.length ? recent.map(e => miniEntryHtml(e,"createdAt")).join("") : '<div class="mini-empty">まだ言葉がありません。</div>';
  $("editedEntries").innerHTML = edited.length ? edited.map(e => miniEntryHtml(e,"updatedAt")).join("") : '<div class="mini-empty">まだ編集された言葉がありません。</div>';
  renderTodayWord();
  renderReview();
}

function renderTodayWord(preferredId = null) {
  if (!entries.length) {
    $("todayWord").innerHTML = '<div class="today-label">WORD OF TODAY</div><div class="today-title">まだ言葉がありません</div><div class="today-meaning">最初の言葉を登録すると、ここに今日のことばが表示されます。</div>';
    todayWordId = null;
    return;
  }

  let entry = preferredId ? entries.find(e => e.id === preferredId) : null;
  if (!entry) entry = entries[Math.floor(Math.random() * entries.length)];

  todayWordId = entry.id;
  $("todayWord").innerHTML = `
    <div class="today-label">WORD OF TODAY</div>
    <div class="today-title">${escapeHtml(entry.word)}${entry.favorite ? ' <span class="favorite-star">★</span>' : ""}</div>
    ${entry.reading ? `<div class="today-reading">${escapeHtml(entry.reading)}</div>` : ""}
    <p class="today-meaning">${entry.meaning ? escapeHtml(entry.meaning).slice(0,220) + (entry.meaning.length > 220 ? "…" : "") : "この言葉には、まだ意味が登録されていません。"}</p>
  `;
}

function normalizeSearchText(value) {
  return String(value || "").toLocaleLowerCase("ja")
    .normalize("NFKC")
    .replace(/[ァ-ン]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s　・、。,.!?！？「」『』（）()［］\[\]{}:：;；_-]/g, "");
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 3) return 4;
  let previous = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > 3) return 4;
    previous = current;
  }
  return previous[b.length];
}

function fuzzyFieldScore(query, value) {
  const field = normalizeSearchText(value);
  if (!field) return 0;
  if (field === query) return 120;
  if (field.includes(query)) return 100;
  if (query.includes(field) && field.length >= 2) return 72;
  // Japanese has no spaces, so compare short character windows as well as full words.
  const maxDistance = query.length <= 3 ? 1 : query.length <= 6 ? 2 : 3;
  let best = 0;
  const minLen = Math.max(1, query.length - maxDistance);
  const maxLen = Math.min(field.length, query.length + maxDistance);
  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i <= field.length - len; i++) {
      const distance = editDistance(query, field.slice(i, i + len));
      if (distance <= maxDistance) best = Math.max(best, 65 - distance * 18 - Math.abs(query.length - len) * 4);
    }
  }
  return best;
}

function getSearchScore(entry, rawQuery, includeSimilar) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 1;
  const directFields = [entry.word, entry.reading, entry.meaning, entry.example, entry.category, entry.tags, entry.relatedWords, entry.memo];
  const direct = Math.max(...directFields.map(value => fuzzyFieldScore(query, value)));
  if (direct > 0 || !includeSimilar) return direct;

  // If the query is close to a registered word, also surface words linked to it
  // through explicit related words, shared tags, or the same category.
  const anchor = entries
    .filter(other => other.id !== entry.id)
    .map(other => ({other, score: Math.max(fuzzyFieldScore(query, other.word), fuzzyFieldScore(query, other.reading), fuzzyFieldScore(query, other.tags), fuzzyFieldScore(query, other.category))}))
    .filter(item => item.score >= 45)
    .sort((a,b) => b.score-a.score)[0];
  if (!anchor) return 0;
  const source = anchor.other;
  const sameCategory = Boolean(source.category && entry.category && source.category === entry.category);
  const sourceTags = new Set(String(source.tags || "").split(",").map(v=>normalizeSearchText(v)).filter(Boolean));
  const sharedTag = String(entry.tags || "").split(",").some(v => sourceTags.has(normalizeSearchText(v)) && normalizeSearchText(v));
  const linked = parseRelatedWords(source.relatedWords).some(w => normalizeSearchText(w) === normalizeSearchText(entry.word)) || parseRelatedWords(entry.relatedWords).some(w => normalizeSearchText(w) === normalizeSearchText(source.word));
  return linked ? 48 + anchor.score * 0.1 : sharedTag ? 35 + anchor.score * 0.1 : sameCategory ? 25 + anchor.score * 0.1 : 0;
}

function render() {
  renderCategoryFilter();
  renderSearchSuggestions();
  renderStats();
  renderDashboard();
  renderNetworkPanel();

  const query = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;
  const favoriteOnly = $("favoriteFilter").value === "favorite";
  const discovery = $("discoveryFilter").value;
  const sort = $("sortSelect").value;

  const includeSimilar = $("fuzzySearchToggle")?.checked !== false;
  const scored = entries.map(entry => ({entry, score: getSearchScore(entry, query, includeSimilar)}));
  let filtered = scored.filter(({entry, score}) => {
    const hasRelated = parseRelatedWords(entry.relatedWords).length > 0 || getIncomingRelatedEntries(entry).length > 0;
    const isUnorganized = !entry.category || !entry.meaning || !entry.tags;
    return (!query || score > 0) && (!category || entry.category === category) && (!favoriteOnly || entry.favorite) && (!discovery || (discovery === "related" ? hasRelated : isUnorganized));
  });

  filtered.sort((a,b) => {
    if (query && includeSimilar && b.score !== a.score) return b.score-a.score;
    if (sort === "word") return a.entry.word.localeCompare(b.entry.word,"ja");
    if (sort === "created") return new Date(b.entry.createdAt)-new Date(a.entry.createdAt);
    return new Date(b.entry.updatedAt)-new Date(a.entry.updatedAt);
  });
  filtered = filtered.map(item => item.entry);

  $("dictionaryList").innerHTML = filtered.map(entry => {
    const related = parseRelatedWords(entry.relatedWords);
    const incoming = getIncomingRelatedEntries(entry);
    const relatedIds = getRelatedEntryIds(entry);
    return `<article class="entry-card">
      <div class="entry-top">
        <div><div class="word-row"><h3 class="word">${escapeHtml(entry.word)}</h3>${entry.favorite ? '<span class="favorite-star">★</span>' : ""}</div>
        ${entry.reading ? `<div class="reading">読み：${escapeHtml(entry.reading)}</div>` : ""}</div>
        <div class="entry-actions">
          <button class="small-button" onclick="openDetail('${entry.id}')">詳細を見る</button>
          <button class="small-button" onclick="toggleFavorite('${entry.id}')">${entry.favorite ? "★ お気に入り解除" : "☆ お気に入り"}</button>
          <button class="small-button" onclick="editEntry('${entry.id}')">編集</button>
          <button class="small-button delete" onclick="deleteEntry('${entry.id}')">削除</button>
        </div>
      </div>
      ${entry.meaning ? `<p class="entry-label">意味・自分なりの解釈</p><div class="entry-content">${escapeHtml(entry.meaning)}</div>` : ""}
      ${entry.example ? `<p class="entry-label">例文</p><div class="entry-content">${escapeHtml(entry.example)}</div>` : ""}
      ${entry.memo ? `<p class="entry-label">メモ</p><div class="entry-content">${escapeHtml(entry.memo)}</div>` : ""}
      ${entry.category ? `<div class="tags"><span class="tag"># ${escapeHtml(entry.category)}</span></div>` : ""}
      ${entry.tags ? `<div class="tags">${entry.tags.split(",").map(t=>t.trim()).filter(Boolean).map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${related.length ? `<p class="entry-label">関連する言葉</p><div class="related">${related.map(word=>{ const exists = Boolean(findEntryByWord(word)); const cls = exists ? "related-link is-registered" : "related-link is-unregistered"; const label = exists ? "登録済み" : "未登録"; return `<button class="${cls}" title="${label}" onclick='searchRelated(${JSON.stringify(word)})'>${escapeHtml(word)}<span class="related-status">${label}</span></button>`; }).join("")}</div>` : ""}
      ${incoming.length ? `<p class="entry-label">この言葉を関連語にしている言葉</p><div class="related incoming-related">${incoming.map(other => `<button class="related-link incoming-link" onclick="focusEntry('${other.id}')">${escapeHtml(other.word)}<span class="related-status">登録済み</span></button>`).join("")}</div>` : ""}
      ${relatedIds.length || incoming.length ? `<div class="connection-note">この言葉のつながり：${relatedIds.length + incoming.length}件</div>` : ""}
      <div class="entry-meta"><span>登録：${formatDate(entry.createdAt)}</span><span>最終更新：${formatDate(entry.updatedAt,true)}</span></div>
    </article>`;
  }).join("");

  $("resultSummary").textContent = `${filtered.length}件表示 ／ 全${entries.length}件`;
  $("emptyMessage").style.display = filtered.length ? "none" : "block";
}

function filterByCategory(category) { $("categoryFilter").value = category; render(); }
function searchRelated(word) {
  $("searchInput").value = word;
  $("categoryFilter").value = "";
  $("favoriteFilter").value = "";
  $("discoveryFilter").value = "";
  render();
  const exists = Boolean(findEntryByWord(word));
  showStatus(exists ? `「${word}」を表示しました。` : `「${word}」はまだ辞典に登録されていません。検索結果から追加できます。`);
  window.scrollTo({top:$('dictionaryList').getBoundingClientRect().top + window.scrollY - 110,behavior:"smooth"});
}
function focusEntry(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  $("searchInput").value = entry.word; $("categoryFilter").value = ""; $("favoriteFilter").value = ""; render();
  window.scrollTo({top:$("dictionaryList").getBoundingClientRect().top + window.scrollY - 110,behavior:"smooth"});
}

function relatedChipHtml(word, currentId = "") {
  const match = findEntryByWord(word);
  const cls = match ? "related-link is-registered" : "related-link is-unregistered";
  const label = match ? "登録済み" : "未登録";
  const action = match ? `openDetail('${match.id}')` : `searchRelated(${JSON.stringify(word)})`;
  return `<button class="${cls}" onclick='${action}'><span>${escapeHtml(word)}</span><span class="related-status">${label}</span></button>`;
}

function openDetail(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  const outgoing = parseRelatedWords(entry.relatedWords);
  const incoming = getIncomingRelatedEntries(entry);
  const registeredOutgoing = outgoing.filter(word => findEntryByWord(word));
  const unregisteredOutgoing = outgoing.filter(word => !findEntryByWord(word));

  $("detailTitle").textContent = entry.word;
  $("detailBody").innerHTML = `
    <div class="detail-word-head">
      <div>
        <div class="detail-word">${escapeHtml(entry.word)}${entry.favorite ? ' <span class="favorite-star">★</span>' : ""}</div>
        ${entry.reading ? `<div class="reading">読み：${escapeHtml(entry.reading)}</div>` : ""}
      </div>
      ${entry.category ? `<span class="tag"># ${escapeHtml(entry.category)}</span>` : ""}
    </div>

    ${entry.meaning ? `<section class="detail-section"><h3>意味・自分なりの解釈</h3><div class="detail-content">${escapeHtml(entry.meaning)}</div></section>` : ""}
    ${entry.example ? `<section class="detail-section"><h3>例文</h3><div class="detail-content">${escapeHtml(entry.example)}</div></section>` : ""}
    ${entry.memo ? `<section class="detail-section"><h3>メモ</h3><div class="detail-content">${escapeHtml(entry.memo)}</div></section>` : ""}
    ${entry.tags ? `<section class="detail-section"><h3>タグ</h3><div class="tags">${entry.tags.split(",").map(t=>t.trim()).filter(Boolean).map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join("")}</div></section>` : ""}

    <section class="detail-section connection-section">
      <div class="detail-section-heading"><h3>この言葉からつながる言葉</h3><span>${outgoing.length}件</span></div>
      ${outgoing.length ? `<div class="related detail-related">${outgoing.map(word => relatedChipHtml(word, entry.id)).join("")}</div>` : '<p class="detail-empty">関連する言葉はまだ登録されていません。</p>'}
    </section>

    <section class="detail-section connection-section">
      <div class="detail-section-heading"><h3>この言葉につながっている言葉</h3><span>${incoming.length}件</span></div>
      ${incoming.length ? `<div class="related detail-related">${incoming.map(other => `<button class="related-link incoming-link" onclick="openDetail('${other.id}')"><span>${escapeHtml(other.word)}</span><span class="related-status">登録済み</span></button>`).join("")}</div>` : '<p class="detail-empty">この言葉を関連語にしている言葉はありません。</p>'}
    </section>

    ${(() => { const discovery = getDiscoveryMatches(entry).filter(other => !outgoing.some(w => normalizeWord(w) === normalizeWord(other.word)) && !incoming.some(other2 => other2.id === other.id)); return discovery.length ? `<section class="detail-section"><div class="detail-section-heading"><h3>この言葉から探してみる</h3><span>${discovery.length}件</span></div><p class="discovery-note">同じカテゴリー・共通タグ・関連関係から見つかった言葉です。</p><div class="related detail-related">${discovery.slice(0,12).map(other => `<button class="related-link discovery-link" onclick="openDetail('${other.id}')"><span>${escapeHtml(other.word)}</span><span class="related-status">発見</span></button>`).join("")}</div></section>` : ""; })()}

    ${unregisteredOutgoing.length ? `<section class="detail-section"><div class="unregistered-note"><strong>未登録の関連語</strong><p>${unregisteredOutgoing.map(escapeHtml).join("、")}</p><button class="small-button" onclick="closeDetailAndSearch(${JSON.stringify(unregisteredOutgoing[0])})">「${escapeHtml(unregisteredOutgoing[0])}」を検索</button></div></section>` : ""}

    <div class="detail-meta"><span>登録：${formatDate(entry.createdAt)}</span><span>最終更新：${formatDate(entry.updatedAt,true)}</span></div>
    <div class="detail-actions"><button class="button" onclick="editEntryFromDetail('${entry.id}')">編集する</button><button class="button primary" onclick="closeDetailAndFocus('${entry.id}')">辞典で表示</button></div>
  `;
  detailDialog.showModal();
}

function editEntryFromDetail(id) {
  detailDialog.close();
  editEntry(id);
}

function closeDetailAndFocus(id) {
  detailDialog.close();
  focusEntry(id);
}

function closeDetailAndSearch(word) {
  detailDialog.close();
  searchRelated(word);
}

function draftStorageKey() {
  const owner = currentUser?.id || currentUser?.email || "guest";
  const entryId = $("entryId").value || "new";
  return `my-word-dictionary-draft-v1:${owner}:${entryId}`;
}

function readDraft(key = draftStorageKey()) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function collectFormData() {
  return {
    word: $("word").value, reading: $("reading").value, meaning: $("meaning").value,
    example: $("example").value, category: $("category").value, tags: $("tags").value,
    relatedWords: $("relatedWords").value, memo: $("memo").value, favorite: $("favorite").checked,
    savedAt: new Date().toISOString()
  };
}

function applyDraft(draft) {
  if (!draft) return;
  for (const field of ["word", "reading", "meaning", "example", "category", "tags", "relatedWords", "memo"]) {
    if (typeof draft[field] === "string") $(field).value = draft[field];
  }
  $("favorite").checked = Boolean(draft.favorite);
}

function saveDraft(showMessage = true) {
  const data = collectFormData();
  try {
    localStorage.setItem(draftStorageKey(), JSON.stringify(data));
    $("draftStatus").textContent = `途中保存しました（${new Date().toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"})}）`;
    if (showMessage) showStatus("入力内容を途中保存しました。この画面を閉じても、次に開いたときに復元できます。");
    return true;
  } catch (error) {
    $("draftStatus").textContent = "途中保存できませんでした。ブラウザーの保存領域を確認してください。";
    console.error(error);
    return false;
  }
}

function clearDraft() {
  try { localStorage.removeItem(draftStorageKey()); } catch {}
  $("draftStatus").textContent = "入力内容はこの端末に自動保存されます。";
}

function openNewEntry() {
  form.reset(); $("entryId").value = ""; $("favorite").checked = false; $("dialogTitle").textContent = "言葉を追加";
  const draft = readDraft();
  if (draft) { applyDraft(draft); $("draftStatus").textContent = "前回の途中保存を復元しました。"; }
  else $("draftStatus").textContent = "入力内容はこの端末に自動保存されます。";
  dialog.showModal(); $("word").focus();
}

function editEntry(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  $("entryId").value=e.id; $("word").value=e.word; $("reading").value=e.reading||""; $("meaning").value=e.meaning||"";
  $("example").value=e.example||""; $("category").value=e.category||""; $("tags").value=e.tags||"";
  $("relatedWords").value=e.relatedWords||""; $("memo").value=e.memo||""; $("favorite").checked=Boolean(e.favorite);
  $("dialogTitle").textContent="言葉を編集";
  const draft = readDraft();
  if (draft) { applyDraft(draft); $("draftStatus").textContent = "この言葉の前回の途中保存を復元しました。"; }
  else $("draftStatus").textContent = "入力内容はこの端末に自動保存されます。";
  dialog.showModal();
}

async function toggleFavorite(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  e.favorite = !e.favorite; e.updatedAt = new Date().toISOString();
  try { await updateEntryCloud(e); render(); } catch(error) { e.favorite=!e.favorite; showStatus("保存できませんでした。",true); console.error(error); }
}

async function deleteEntry(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  if (!confirm(`「${e.word}」を削除しますか？`)) return;
  try { await deleteEntryCloud(id); entries=entries.filter(x=>x.id!==id); render(); showStatus("削除しました。"); }
  catch(error) { showStatus("削除できませんでした。",true); console.error(error); }
}

$("closeDetailDialog").addEventListener("click", () => detailDialog.close());

detailDialog.addEventListener("click", event => {
  if (event.target === detailDialog) detailDialog.close();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const id=$("entryId").value, now=new Date().toISOString();
  const data={word:$("word").value.trim(),reading:$("reading").value.trim(),meaning:$("meaning").value.trim(),example:$("example").value.trim(),category:$("category").value.trim(),tags:$("tags").value.trim(),relatedWords:$("relatedWords").value.trim(),memo:$("memo").value.trim(),favorite:$("favorite").checked};
  if (!data.word) return;

  try {
    if (id) {
      const old=entries.find(e=>e.id===id); const updated={...old,...data,updatedAt:now};
      await updateEntryCloud(updated);
      entries=entries.map(e=>e.id===id?updated:e);
    } else {
      const created={id:crypto.randomUUID(),...data,createdAt:now,updatedAt:now};
      await saveNewEntry(created);
      entries.unshift(created);
    }
    clearDraft(); dialog.close(); showStatus("保存しました。"); render();
  } catch(error) {
    showStatus("保存できませんでした。Supabaseの設定とRLSを確認してください。",true); console.error(error);
  }
});

function exportBackup() {
  const backup={app:"ことば辞典",version:2,exportedAt:new Date().toISOString(),userEmail:currentUser.email,entries};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), a=document.createElement("a"), date=new Date().toISOString().slice(0,10);
  a.href=url; a.download=`ことば辞典_backup_${date}.json`; a.click(); URL.revokeObjectURL(url);
  showStatus(`${entries.length}件を書き出しました。`);
}

async function importBackup(file) {
  if (!file) return;
  const reader=new FileReader();
  reader.onload=async event=>{
    try {
      const backup=JSON.parse(event.target.result);
      if (!backup || !Array.isArray(backup.entries)) throw new Error("形式が違います");
      const cleaned=backup.entries.filter(e=>e&&typeof e.word==="string"&&e.word.trim()).map(e=>({
        id:crypto.randomUUID(), word:e.word.trim(), reading:e.reading||"", meaning:e.meaning||"", example:e.example||"",
        category:e.category||"", tags:e.tags||"", relatedWords:e.relatedWords||"", memo:e.memo||"", favorite:Boolean(e.favorite),
        createdAt:e.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString()
      }));
      if (!confirm(`${cleaned.length}件を現在のアカウントへ追加します。\n現在のデータは残ります。よろしいですか？`)) return;
      const rows=cleaned.map(toDb);
      const {error}=await client.from("dictionary_entries").insert(rows);
      if(error) throw error;
      await loadEntries(); showStatus(`${cleaned.length}件を復元しました。`);
    } catch(error) { showStatus("復元できませんでした。",true); console.error(error); }
  };
  reader.readAsText(file,"UTF-8");
}

function getLegacyEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}

function checkLegacyData() {
  const legacy=getLegacyEntries();
  if (!legacy.length) return;
  $("migrationCount").textContent=`${legacy.length}件の旧データを、現在のアカウントへ移行できます。`;
  $("migrationPanel").classList.remove("hidden");
}

async function migrateLegacyData() {
  const legacy=getLegacyEntries();
  if (!legacy.length) return;
  if (!confirm(`${legacy.length}件の旧データを現在のアカウントへ移行します。\n移行後も旧データはこの端末に残ります。よろしいですか？`)) return;

  try {
    const rows=legacy.map(e=>toDb({
      id:crypto.randomUUID(), word:e.word||"", reading:e.reading||"", meaning:e.meaning||"", example:e.example||"",
      category:e.category||"", tags:e.tags||"", relatedWords:e.relatedWords||"", memo:e.memo||"", favorite:Boolean(e.favorite),
      createdAt:e.createdAt||new Date().toISOString(), updatedAt:e.updatedAt||new Date().toISOString()
    })).filter(e=>e.word);

    const {error}=await client.from("dictionary_entries").insert(rows);
    if(error) throw error;
    await loadEntries();
    $("migrationPanel").classList.add("hidden");
    showStatus(`${rows.length}件をアカウントへ移行しました。`);
  } catch(error) { showStatus("旧データを移行できませんでした。",true); console.error(error); }
}

function showStatus(message,error=false) {
  const el=$("dataStatus"); el.textContent=message; el.style.color=error?"var(--danger)":"var(--success)";
  clearTimeout(showStatus.timer); showStatus.timer=setTimeout(()=>el.textContent="",5000);
}

$("loginTab").addEventListener("click",()=>setAuthMode("login"));
$("signupTab").addEventListener("click",()=>setAuthMode("signup"));

$("authForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if (!client) return;
  const email=$("authEmail").value.trim(), password=$("authPassword").value;
  $("authSubmit").disabled=true; setAuthMessage("処理しています…",false);

  try {
    if (authMode==="login") {
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error) throw error;
    } else {
      const {data,error}=await client.auth.signUp({
        email,
        password,
        options: {
          redirectTo: getAuthRedirectUrl()
        }
      });
      if(error) throw error;
      if(!data.session) {
        setAuthMessage("登録しました。届いた確認メールのボタンを押すと、このアプリに戻ってログインできます。",false);
      }
    }
  } catch(error) {
    setAuthMessage(error.message || "認証に失敗しました。");
  } finally {
    $("authSubmit").disabled=false;
  }
});

$("resetPasswordButton").addEventListener("click",async()=>{
  if(!client) return;
  const email=$("authEmail").value.trim();
  if(!email){setAuthMessage("先にメールアドレスを入力してください。");return;}
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:getAuthRedirectUrl()});
  if(error) setAuthMessage(error.message);
  else setAuthMessage("パスワード再設定用のメールを送信しました。",false);
});

$("logoutButton").addEventListener("click",async()=>{
  if(!client) return;
  await client.auth.signOut();
});

$("newEntryButton").addEventListener("click",openNewEntry);
$("saveDraftButton").addEventListener("click", () => saveDraft(true));
for (const id of ["word", "reading", "meaning", "example", "category", "tags", "relatedWords", "memo", "favorite"]) {
  $(id).addEventListener("input", () => saveDraft(false));
  $(id).addEventListener("change", () => saveDraft(false));
}
$("closeDialog").addEventListener("click",()=>dialog.close());
$("cancelButton").addEventListener("click",()=>dialog.close());
$("searchInput").addEventListener("input",render);
$("fuzzySearchToggle").addEventListener("change",render);
$("categoryFilter").addEventListener("change",render);
$("discoveryFilter").addEventListener("change",render);
$("favoriteFilter").addEventListener("change",render);
$("sortSelect").addEventListener("change",render);
$("clearFiltersButton").addEventListener("click",()=>{ $("searchInput").value=""; $("categoryFilter").value=""; $("favoriteFilter").value=""; $("discoveryFilter").value=""; $("sortSelect").value="updated"; render(); });
$("reviewRevealButton").addEventListener("click", revealReview);
$("reviewNextButton").addEventListener("click", () => renderReview());
$("randomButton").addEventListener("click",()=>{
  if(entries.length<2){renderTodayWord();return;}
  const candidates=entries.filter(e=>e.id!==todayWordId);
  renderTodayWord(candidates[Math.floor(Math.random()*candidates.length)].id);
});
$("todayWord").addEventListener("click",()=>{if(todayWordId)focusEntry(todayWordId);});
$("showRecentButton").addEventListener("click",()=>{$("sortSelect").value="created";$("searchInput").value="";$("categoryFilter").value="";$("favoriteFilter").value="";render();window.scrollTo({top:$("dictionaryList").getBoundingClientRect().top+window.scrollY-110,behavior:"smooth"});});
$("showEditedButton").addEventListener("click",()=>{$("sortSelect").value="updated";$("searchInput").value="";$("categoryFilter").value="";$("favoriteFilter").value="";render();window.scrollTo({top:$("dictionaryList").getBoundingClientRect().top+window.scrollY-110,behavior:"smooth"});});
$("exportButton").addEventListener("click",exportBackup);
$("importInput").addEventListener("change",event=>{importBackup(event.target.files[0]);event.target.value="";});
$("migrationButton").addEventListener("click",migrateLegacyData);

init();
