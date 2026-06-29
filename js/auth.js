// auth.js — Authentication module
import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Auth State Observer ──
// Redirects to login if not authenticated (call on app pages)
export function requireAuth(redirectTo = 'index.html') {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = redirectTo;
      } else {
        resolve(user);
      }
    });
  });
}

// ── Login ──
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── Register ──
export async function register(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) {
    await updateProfile(cred.user, { displayName: name });
  }
  return cred.user;
}

// ── Logout ──
export async function logout() {
  await signOut(auth);
  window.location.href = 'index.html';
}

// ── Get current user ──
export function getCurrentUser() {
  return auth.currentUser;
}

// ── Get user initials for avatar ──
export function getUserInitials(user) {
  if (!user) return '?';
  if (user.displayName) {
    return user.displayName.split(' ')
      .slice(0, 2)
      .map(n => n[0])
      .join('')
      .toUpperCase();
  }
  return user.email[0].toUpperCase();
}

// ── Redirect if already logged in (for login page) ──
export function redirectIfLoggedIn(redirectTo = 'dashboard.html') {
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = redirectTo;
  });
}
