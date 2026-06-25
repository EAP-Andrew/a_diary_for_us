// ===========================================================
//  Journal Calendar — app logic (vanilla JS + Firebase)
// ===========================================================

import { firebaseConfig, useFirebaseStorage } from "./firebase-config.js?v=2";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, query, where,
  onSnapshot, addDoc, deleteDoc, doc, updateDoc, arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ---------- Init Firebase (with friendly error if not configured) ----------
let db, storage, configured = true;
try {
  if (firebaseConfig.apiKey.startsWith("PASTE_")) configured = false;
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
  if (useFirebaseStorage) storage = getStorage(fbApp);
} catch (e) {
  configured = false;
  console.error(e);
}

if (!configured) {
  const banner = document.getElementById("config-banner");
  banner.classList.remove("hidden");
  banner.innerHTML =
    "Firebase isn't configured yet. Open <strong>js/firebase-config.js</strong> and paste your config (see README.md). The app runs but nothing is saved.";
}

// ---------- Small helpers ----------
const $ = (sel) => document.querySelector(sel);
const ENTRIES = "entries";
const SONGS = "songs";

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

function initials(name) { return (name || "?").trim().charAt(0).toUpperCase(); }

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  // keep avatars within a violet → magenta range to match the theme
  const hue = 248 + (Math.abs(h) % 82);
  return `hsl(${hue} 58% 64%)`;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

function formatTime(date) {
  if (!date) return "just now";
  return date.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatLongDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// A per-browser id, used so people can delete their own posts.
function getClientId() {
  let id = localStorage.getItem("jc_clientId");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("jc_clientId", id); }
  return id;
}
const clientId = getClientId();

// ===========================================================
//  State
// ===========================================================
let username = localStorage.getItem("jc_username") || "";
let selectedDate = new Date();            // currently viewed day
let calMonth = new Date();                 // month shown in calendar
let pendingImageData = null;               // dataURL of staged image
let unsubDay = null;                       // firestore listener for the day
let unsubMonth = null;                     // listener for month dots
let unsubSongs = null;                     // listener for the day's shared songs

// ===========================================================
//  Username gate
// ===========================================================
function showApp() {
  $("#username-gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-name").textContent = username;
  const av = $("#user-avatar");
  av.textContent = initials(username);
  av.style.background = colorFor(username);
}

function showGate() {
  $("#app").classList.add("hidden");
  $("#username-gate").classList.remove("hidden");
  $("#username-input").value = username;
  setTimeout(() => $("#username-input").focus(), 50);
}

$("#username-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = $("#username-input").value.trim();
  if (!val) return;
  username = val;
  localStorage.setItem("jc_username", username);
  showApp();
});

$("#user-chip").addEventListener("click", showGate);

// ===========================================================
//  Theme (dark / light)
// ===========================================================
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("#theme-btn").textContent = theme === "dark" ? "light" : "dark";
  localStorage.setItem("jc_theme", theme);
}
$("#theme-btn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
});
applyTheme(localStorage.getItem("jc_theme") || "dark");

// ===========================================================
//  Calendar rendering
// ===========================================================
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let daysWithEntries = new Set();

function renderWeekdays() {
  $("#cal-weekdays").innerHTML = WEEKDAYS.map((d) => `<span>${d}</span>`).join("");
}

function renderCalendar() {
  const grid = $("#cal-grid");
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();

  $("#cal-title").textContent = calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const first = new Date(year, month, 1);
  // Monday-first offset
  let startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = isoDate(new Date());
  const selIso = isoDate(selectedDate);

  let html = "";
  for (let i = 0; i < startOffset; i++) html += `<div class="cal-cell empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const cellIso = `${year}-${pad(month + 1)}-${pad(day)}`;
    const classes = ["cal-cell"];
    if (cellIso === todayIso) classes.push("today");
    if (cellIso === selIso) classes.push("selected");
    const dot = daysWithEntries.has(cellIso) ? `<span class="dot"></span>` : "";
    html += `<button class="${classes.join(" ")}" data-date="${cellIso}">${day}${dot}</button>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => selectDate(parseISO(cell.dataset.date)));
  });
}

// Listen to all entries in the visible month to show "has entries" dots.
function watchMonth() {
  if (!configured) return;
  if (unsubMonth) unsubMonth();
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const start = `${year}-${pad(month + 1)}-01`;
  const end = `${year}-${pad(month + 1)}-31`;
  const q = query(collection(db, ENTRIES), where("date", ">=", start), where("date", "<=", end));
  unsubMonth = onSnapshot(q, (snap) => {
    daysWithEntries = new Set();
    snap.forEach((d) => daysWithEntries.add(d.data().date));
    renderCalendar();
  }, (err) => console.error("month listener", err));
}

$("#prev-month").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); watchMonth(); });
$("#next-month").addEventListener("click", () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); watchMonth(); });

// ===========================================================
//  Day navigation
// ===========================================================
function selectDate(date) {
  selectedDate = date;
  calMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  updateDayHeader();
  renderCalendar();
  watchMonth();
  watchDay();
  watchSongs();
  loadDraft();
  // gentle animation
  const pane = $(".journal-pane");
  pane.classList.remove("switching"); void pane.offsetWidth; pane.classList.add("switching");
}

function updateDayHeader() {
  $("#selected-date-label").textContent = formatLongDate(selectedDate);
  const isToday = isoDate(selectedDate) === isoDate(new Date());
  $("#today-badge").classList.toggle("hidden", !isToday);
  $("#date-search").value = isoDate(selectedDate);
}

$("#today-btn").addEventListener("click", () => selectDate(new Date()));
$("#prev-day").addEventListener("click", () => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); selectDate(d); });
$("#next-day").addEventListener("click", () => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); selectDate(d); });
$("#date-search").addEventListener("change", (e) => { if (e.target.value) selectDate(parseISO(e.target.value)); });

// ===========================================================
//  Entries — read (real-time) for the selected day
// ===========================================================
function watchDay() {
  if (!configured) { renderEntries([]); return; }
  if (unsubDay) unsubDay();
  const dayIso = isoDate(selectedDate);
  // Filter by date only (no composite index needed); sort chronologically in JS.
  const q = query(collection(db, ENTRIES), where("date", "==", dayIso));
  unsubDay = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
    renderEntries(items);
  }, (err) => console.error("day listener", err));
}

function renderEntries(items) {
  const container = $("#entries");
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>no entries for this day yet — be the first to write</p>
      </div>`;
    return;
  }
  container.innerHTML = items.map((it, idx) => entryHtml(it, idx === 0)).join("");
  wireEntryEvents();
}

function entryHtml(it, featured) {
  const created = toDate(it.createdAt);
  const replies = Array.isArray(it.replies) ? it.replies : [];
  const canDelete = it.clientId === clientId;

  const repliesHtml = replies.map((r) => `
    <div class="reply">
      <div class="reply-head">
        <span class="avatar" style="background:${colorFor(r.username)}">${initials(r.username)}</span>
        <span class="reply-author">${escapeHtml(r.username)}</span>
        <span class="reply-time">${formatTime(toDate(r.createdAt))}</span>
      </div>
      <div class="reply-text">${escapeHtml(r.text)}</div>
    </div>`).join("");

  return `
  <article class="entry ${featured ? "featured" : ""}" data-id="${it.id}">
    <div class="entry-head">
      <span class="avatar" style="background:${colorFor(it.username)}">${initials(it.username)}</span>
      <span class="entry-meta">
        <span class="entry-author">${escapeHtml(it.username)}</span>
        <span class="entry-time">${formatTime(created)}</span>
      </span>
      ${featured ? `<span class="featured-tag">entry of the day</span>` : ""}
    </div>
    ${it.text ? `<p class="entry-text">${escapeHtml(it.text)}</p>` : ""}
    ${it.imageUrl ? `<div class="entry-image"><img src="${it.imageUrl}" alt="image" loading="lazy" /></div>` : ""}
    <div class="entry-footer">
      <button class="reply-toggle" data-id="${it.id}">reply${replies.length ? ` (${replies.length})` : ""}</button>
      ${canDelete ? `<button class="delete-btn" data-id="${it.id}">delete</button>` : ""}
    </div>
    ${replies.length ? `<div class="replies">${repliesHtml}</div>` : ""}
    <form class="reply-form" data-id="${it.id}">
      <input class="reply-input" type="text" placeholder="your reply…" maxlength="500" />
      <button type="submit" class="btn btn-primary">send</button>
    </form>
  </article>`;
}

function wireEntryEvents() {
  document.querySelectorAll(".reply-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = document.querySelector(`.reply-form[data-id="${btn.dataset.id}"]`);
      form.classList.toggle("open");
      if (form.classList.contains("open")) form.querySelector("input").focus();
    });
  });
  document.querySelectorAll(".reply-form").forEach((form) => {
    form.addEventListener("submit", (e) => { e.preventDefault(); submitReply(form); });
  });
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
  });
  document.querySelectorAll(".entry-image img").forEach((img) => {
    img.addEventListener("click", () => window.open(img.src, "_blank"));
  });
}

// ===========================================================
//  Entries — write
// ===========================================================
async function submitEntry(e) {
  e.preventDefault();
  if (!configured) { alert("Firebase isn't configured (see README.md)."); return; }
  const text = $("#entry-text").value.trim();
  if (!text && !pendingImageData) return;

  const saveBtn = $("#save-btn");
  saveBtn.disabled = true; saveBtn.textContent = "saving…";

  try {
    let imageUrl = "";
    if (pendingImageData) imageUrl = await persistImage(pendingImageData);

    await addDoc(collection(db, ENTRIES), {
      date: isoDate(selectedDate),
      username,
      clientId,
      text,
      imageUrl,
      replies: [],
      createdAt: serverTimestamp(),
    });

    $("#entry-text").value = "";
    clearImage();
    clearDraft();
  } catch (err) {
    console.error(err);
    alert("Failed to save: " + err.message);
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "save";
  }
}

async function submitReply(form) {
  if (!configured) return;
  const input = form.querySelector("input");
  const text = input.value.trim();
  if (!text) return;
  const id = form.dataset.id;
  try {
    await updateDoc(doc(db, ENTRIES, id), {
      replies: arrayUnion({
        username, clientId, text,
        createdAt: new Date().toISOString(), // serverTimestamp not allowed inside arrays
      }),
    });
    input.value = "";
    form.classList.remove("open");
  } catch (err) {
    console.error(err);
    alert("Failed to reply: " + err.message);
  }
}

async function deleteEntry(id) {
  if (!confirm("Delete this entry?")) return;
  try { await deleteDoc(doc(db, ENTRIES, id)); }
  catch (err) { console.error(err); alert("Failed to delete: " + err.message); }
}

$("#composer").addEventListener("submit", submitEntry);

// ===========================================================
//  Music of the day — share a Spotify track for the selected day
// ===========================================================
// Accepts: open.spotify.com/track/ID, /album/ID, /playlist/ID, /episode/ID,
// localized links (/intl-fr/track/ID), and spotify:track:ID URIs.
function parseSpotify(url) {
  if (!url) return null;
  const s = url.trim();
  let m = s.match(/spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  return null;
}

function embedHeight(type) {
  // Compact player for single items, taller player for collections.
  return (type === "track" || type === "episode") ? 152 : 352;
}

function setMusicHint(msg, isError) {
  const hint = $("#music-hint");
  hint.textContent = msg || "";
  hint.classList.toggle("error", !!isError);
}

function watchSongs() {
  if (!configured) { renderSongs([]); return; }
  if (unsubSongs) unsubSongs();
  const dayIso = isoDate(selectedDate);
  const q = query(collection(db, SONGS), where("date", "==", dayIso));
  unsubSongs = onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
    renderSongs(items);
  }, (err) => console.error("songs listener", err));
}

function renderSongs(items) {
  const container = $("#songs");
  if (!items.length) { container.innerHTML = ""; return; }
  container.innerHTML = items.map(songHtml).join("");
  container.querySelectorAll(".song-delete").forEach((btn) =>
    btn.addEventListener("click", () => deleteSong(btn.dataset.id)));
}

function songHtml(it) {
  const canDelete = it.clientId === clientId;
  const h = embedHeight(it.spotifyType);
  const src = `https://open.spotify.com/embed/${it.spotifyType}/${it.spotifyId}`;
  return `
  <div class="song" data-id="${it.id}">
    <div class="song-head">
      <span class="avatar" style="background:${colorFor(it.username)}">${initials(it.username)}</span>
      <span class="song-author">${escapeHtml(it.username)}</span>
      <span class="song-time">${formatTime(toDate(it.createdAt))}</span>
      ${canDelete ? `<button class="song-delete" data-id="${it.id}">remove</button>` : ""}
    </div>
    <iframe src="${src}" height="${h}" loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowfullscreen></iframe>
  </div>`;
}

async function submitSong(e) {
  e.preventDefault();
  if (!configured) { setMusicHint("Firebase isn't configured (see README.md).", true); return; }
  const input = $("#music-input");
  const parsed = parseSpotify(input.value);
  if (!parsed) {
    setMusicHint("Hmm, that doesn't look like a Spotify link. Copy it from Share → Copy link.", true);
    return;
  }
  try {
    await addDoc(collection(db, SONGS), {
      date: isoDate(selectedDate),
      username,
      clientId,
      spotifyType: parsed.type,
      spotifyId: parsed.id,
      createdAt: serverTimestamp(),
    });
    input.value = "";
    setMusicHint("added to today's playlist 🎶", false);
  } catch (err) {
    console.error(err);
    setMusicHint("Failed to share: " + err.message, true);
  }
}

async function deleteSong(id) {
  if (!confirm("Remove this song?")) return;
  try { await deleteDoc(doc(db, SONGS, id)); }
  catch (err) { console.error(err); setMusicHint("Failed to remove: " + err.message, true); }
}

$("#music-form").addEventListener("submit", submitSong);

// ===========================================================
//  Images — drag & drop / file pick / preview
// ===========================================================
const dropzone = $("#dropzone");
const imageInput = $("#image-input");

$("#pick-image").addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => { if (imageInput.files[0]) handleImageFile(imageInput.files[0]); });

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) handleImageFile(file);
});

function handleImageFile(file) {
  // Downscale to keep uploads light (and under Firestore limits when inlining).
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      let { width, height } = img;
      if (width > max || height > max) {
        const ratio = Math.min(max / width, max / height);
        width = Math.round(width * ratio); height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      pendingImageData = canvas.toDataURL("image/jpeg", 0.85);
      showImagePreview(pendingImageData);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function showImagePreview(dataUrl) {
  $("#preview-img").src = dataUrl;
  $("#image-preview").classList.remove("hidden");
}
function clearImage() {
  pendingImageData = null;
  imageInput.value = "";
  $("#image-preview").classList.add("hidden");
  $("#preview-img").src = "";
}
$("#remove-image").addEventListener("click", clearImage);

// Convert dataURL -> Blob for Storage upload
function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function persistImage(dataUrl) {
  if (useFirebaseStorage && storage) {
    const blob = dataUrlToBlob(dataUrl);
    const path = `entries/${isoDate(selectedDate)}/${crypto.randomUUID()}.jpg`;
    const sref = storageRef(storage, path);
    await uploadBytes(sref, blob);
    return await getDownloadURL(sref);
  }
  // Fallback: inline the (already downscaled) image as a data URL in Firestore.
  return dataUrl;
}

// ===========================================================
//  Auto-save draft (per day, local only)
// ===========================================================
const draftKey = () => `jc_draft_${isoDate(selectedDate)}`;
function clearDraft() { localStorage.removeItem(draftKey()); $("#autosave-hint").textContent = ""; }

$("#entry-text").addEventListener("input", () => {
  const v = $("#entry-text").value;
  if (v) { localStorage.setItem(draftKey(), v); $("#autosave-hint").textContent = "draft saved"; }
  else clearDraft();
});

function loadDraft() {
  const v = localStorage.getItem(draftKey());
  $("#entry-text").value = v || "";
  $("#autosave-hint").textContent = v ? "draft restored" : "";
}

// ===========================================================
//  Boot
// ===========================================================
function boot() {
  renderWeekdays();
  if (username) showApp(); else showGate();
  selectDate(new Date());   // today selected by default (also loads any draft)
}

boot();
