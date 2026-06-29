// Firebase Configuration — Igor Financeiro
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyDdKvnABHQzSke1uSxg5ZxP1zfBtCvPqig",
  authDomain: "financaspessoaligorbel.firebaseapp.com",
  projectId: "financaspessoaligorbel",
  storageBucket: "financaspessoaligorbel.firebasestorage.app",
  messagingSenderId: "264948375606",
  appId: "1:264948375606:web:00b6f1baaed0fe16f5b897",
  measurementId: "G-3YR6WJ1HS1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
