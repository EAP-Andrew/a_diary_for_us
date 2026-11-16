// ===========================================================
//  Firebase configuration
//  -----------------------------------------------------------
//  1. Go to https://console.firebase.google.com  → create a project
//  2. Add a Web app (</>) and copy the config object here
//  3. Enable Firestore Database (production or test mode)
//  4. Enable Storage (for image uploads)
//  See README.md for full step-by-step + security rules.
// ===========================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBTvunCTKAkpGGZHBhUaVmFMSg5_xC8XP0",
  authDomain: "a-diary-for-us.firebaseapp.com",
  projectId: "a-diary-for-us",
  storageBucket: "a-diary-for-us.firebasestorage.app",
  messagingSenderId: "917590695875",
  appId: "1:917590695875:web:bbbe120e8db02309352776",
  measurementId: "G-8NW1XSFMQM"
};

// Optional: turn image uploads on/off. If your Firebase plan does not
// include Storage, set this to false — text entries will still work and
// small images will be inlined as data URLs in Firestore instead.
export const useFirebaseStorage = false;
