# Journal Calendar

A **collaborative diary** in the form of a calendar. Anyone with the link can pick a
date, write an entry, read what others wrote, reply, and add photos. Real‑time,
multi‑user, no complicated account — just a username.

Static frontend (HTML / CSS / Vanilla JS) hosted on **GitHub Pages**, with a
**Firebase** backend (Firestore + Storage) for persistence and real‑time updates.

---

## ✨ Features

- Interactive monthly calendar, month/day navigation, **current day auto‑selected** on open
- Write entries (today **or** past dates), timestamped
- Required username, stored locally (no login)
- Replies to entries — a conversation across time
- Image upload (click **or** drag & drop), automatically resized
- 🎵 **Music of the day** — paste a Spotify link and everyone can play it on the page
- Entry of the day highlighted + chronological scroll
- Persistent real‑time storage (Firestore `onSnapshot`)
- Pastel dark mode · search by date · "today" indicator · 💾 draft auto‑save

---

## 📂 Project structure

```
a_diary_for_us/
├── index.html              # app structure
├── .nojekyll               # prevents GitHub Pages from filtering files
├── css/
│   └── styles.css          # pastel theme + dark mode
├── js/
│   ├── firebase-config.js  # ⚙️ YOUR Firebase config (to fill in)
│   └── app.js              # all the logic
└── README.md
```

### Data model (Firestore)

Collection **`entries`**, one document per entry:

```json
{
  "date": "2026-06-25",
  "username": "Lou",
  "clientId": "local-uuid",
  "text": "Lovely day…",
  "imageUrl": "https://… (optional)",
  "replies": [
    { "username": "Sam", "text": "so good!", "createdAt": "2026-06-25T18:00:00Z", "clientId": "uuid" }
  ],
  "createdAt": "<serverTimestamp>"
}
```

Collection **`songs`**, one document per shared "music of the day":

```json
{
  "date": "2026-06-25",
  "username": "Lou",
  "clientId": "local-uuid",
  "spotifyType": "track",
  "spotifyId": "4PTG3Z6ehGkBFwjybzWkR8",
  "createdAt": "<serverTimestamp>"
}
```

Songs are rendered with Spotify's official embed player (an `<iframe>`), so they
play directly on the page — no Spotify API key or login required. Paste any link
from Spotify's **Share → Copy link** (track, album, playlist or episode).

---

## 🔧 1. Firebase setup

1. Go to <https://console.firebase.google.com> → **Create a project**.
2. In the project: **⚙️ Project settings → Your apps → Web (`</>`)**. Give it a
   nickname, register, and **copy the `firebaseConfig` object**.
3. Paste those values into [`js/firebase-config.js`](js/firebase-config.js):

   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

4. **Firestore Database** → *Create database* → *production* mode (we set the rules below).
5. **Storage** → *Get started* (for images). If your plan doesn't include Storage, set
   `useFirebaseStorage = false` in `firebase-config.js`: images will then be stored
   (compressed) directly in Firestore.

### Firestore security rules

⚠️ The app has no login: this diary is **open to anyone who has the link**. For private
use among close ones, just keep the link secret. Open but bounded rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /entries/{entry} {
      allow read: if true;
      allow create: if request.resource.data.username is string
                    && request.resource.data.date is string;
      allow update, delete: if true;
    }
    match /songs/{song} {
      allow read: if true;
      allow create: if request.resource.data.username is string
                    && request.resource.data.date is string
                    && request.resource.data.spotifyId is string;
      allow update, delete: if true;
    }
  }
}
```

### Storage security rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /entries/{allPaths=**} {
      allow read: if true;
      allow write: if request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

> These rules are intentionally permissive (no auth). To harden, add Firebase
> **Authentication** (anonymous or e‑mail) and gate writes on `request.auth != null`.

---

## 🚀 2. Deploy to GitHub Pages

1. Create a GitHub repo and push these files (commands below).
2. On GitHub: **Settings → Pages**.
3. *Source*: **Deploy from a branch**, branch **`main`**, folder **`/ (root)`** → *Save*.
4. Wait ~1 min. Your link: `https://<your-user>.github.io/<your-repo>/`.
5. Share that link — everyone writes in the same diary. 🎉

### Push the code

```bash
git add .
git commit -m "Journal Calendar"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

### Authorize your GitHub Pages domain in Firebase

Firebase **Authentication → Settings → Authorized domains**: add
`<your-user>.github.io` (useful if you enable auth later). Firestore/Storage work
without this step.

---

## 🧪 3. Test locally

Because `app.js` is an **ES module**, opening `index.html` by double‑click won't work
(CORS). Run a small server:

```bash
# Python
python -m http.server 5500
# or Node
npx serve .
```

Then open <http://localhost:5500>.

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| Yellow banner "Firebase isn't configured" | Fill in `js/firebase-config.js`. |
| `Missing or insufficient permissions` | Publish the Firestore rules above. |
| Images won't upload | Enable **Storage** + rules, or set `useFirebaseStorage = false`. |
| Blank page on GitHub Pages | Make sure `.nojekyll` exists and Pages points to `/(root)`. |
| Firestore index required | Follow the error link in the console — Firestore offers 1‑click creation. |

---

Made with 🤍 — *a diary, for us.*
