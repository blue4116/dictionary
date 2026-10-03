const STORAGE_KEY = "my-word-dictionary-v1";
const { createClient } = supabase;

let client = null;
let currentUser = null;
let entries = [];
let authMode = "login";
let todayWordId = null;

const $ = id => document.getElementById(id);
const dialog = $("entryDialog");
const form = $("entryForm");

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

function renderDashboard() {
  const recent = [...entries].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
  const edited = [...entries].sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5);

  $("recentEntries").innerHTML = recent.length ? recent.map(e => miniEntryHtml(e,"createdAt")).join("") : '<div class="mini-empty">まだ言葉がありません。</div>';
  $("editedEntries").innerHTML = edited.length ? edited.map(e => miniEntryHtml(e,"updatedAt")).join("") : '<div class="mini-empty">まだ編集された言葉がありません。</div>';
  renderTodayWord();
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

function render() {
  renderCategoryFilter();
  renderStats();
  renderDashboard();

  const query = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;
  const favoriteOnly = $("favoriteFilter").value === "favorite";
  const sort = $("sortSelect").value;

  let filtered = entries.filter(entry => {
    const text = [entry.word,entry.reading,entry.meaning,entry.example,entry.category,entry.tags,entry.relatedWords,entry.memo].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (!category || entry.category === category) && (!favoriteOnly || entry.favorite);
  });

  filtered.sort((a,b) => {
    if (sort === "word") return a.word.localeCompare(b.word,"ja");
    if (sort === "created") return new Date(b.createdAt)-new Date(a.createdAt);
    return new Date(b.updatedAt)-new Date(a.updatedAt);
  });

  $("dictionaryList").innerHTML = filtered.map(entry => {
    const related = (entry.relatedWords || "").split(",").map(x => x.trim()).filter(Boolean);
    return `<article class="entry-card">
      <div class="entry-top">
        <div><div class="word-row"><h3 class="word">${escapeHtml(entry.word)}</h3>${entry.favorite ? '<span class="favorite-star">★</span>' : ""}</div>
        ${entry.reading ? `<div class="reading">読み：${escapeHtml(entry.reading)}</div>` : ""}</div>
        <div class="entry-actions">
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
      ${related.length ? `<p class="entry-label">関連する言葉</p><div class="related">${related.map(word=>`<button class="related-link" onclick="searchRelated('${escapeHtml(word)}')">${escapeHtml(word)}</button>`).join("")}</div>` : ""}
      <div class="entry-meta"><span>登録：${formatDate(entry.createdAt)}</span><span>最終更新：${formatDate(entry.updatedAt,true)}</span></div>
    </article>`;
  }).join("");

  $("emptyMessage").style.display = filtered.length ? "none" : "block";
}

function filterByCategory(category) { $("categoryFilter").value = category; render(); }
function searchRelated(word) { $("searchInput").value = word; $("categoryFilter").value = ""; render(); window.scrollTo({top:0,behavior:"smooth"}); }
function focusEntry(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  $("searchInput").value = entry.word; $("categoryFilter").value = ""; $("favoriteFilter").value = ""; render();
  window.scrollTo({top:$("dictionaryList").getBoundingClientRect().top + window.scrollY - 110,behavior:"smooth"});
}

function openNewEntry() {
  form.reset(); $("entryId").value = ""; $("favorite").checked = false; $("dialogTitle").textContent = "言葉を追加"; dialog.showModal(); $("word").focus();
}

function editEntry(id) {
  const e = entries.find(x => x.id === id); if (!e) return;
  $("entryId").value=e.id; $("word").value=e.word; $("reading").value=e.reading||""; $("meaning").value=e.meaning||"";
  $("example").value=e.example||""; $("category").value=e.category||""; $("tags").value=e.tags||"";
  $("relatedWords").value=e.relatedWords||""; $("memo").value=e.memo||""; $("favorite").checked=Boolean(e.favorite);
  $("dialogTitle").textContent="言葉を編集"; dialog.showModal();
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
    dialog.close(); showStatus("保存しました。"); render();
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
      const {data,error}=await client.auth.signUp({email,password});
      if(error) throw error;
      if(!data.session) setAuthMessage("登録しました。確認メールが届く設定の場合は、メール確認後にログインしてください。",false);
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
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  if(error) setAuthMessage(error.message);
  else setAuthMessage("パスワード再設定用のメールを送信しました。",false);
});

$("logoutButton").addEventListener("click",async()=>{
  if(!client) return;
  await client.auth.signOut();
});

$("newEntryButton").addEventListener("click",openNewEntry);
$("closeDialog").addEventListener("click",()=>dialog.close());
$("cancelButton").addEventListener("click",()=>dialog.close());
$("searchInput").addEventListener("input",render);
$("categoryFilter").addEventListener("change",render);
$("favoriteFilter").addEventListener("change",render);
$("sortSelect").addEventListener("change",render);
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
