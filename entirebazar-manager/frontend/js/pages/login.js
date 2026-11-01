import { auth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail } from '../firebase.js';

const form = document.getElementById('loginForm');
const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const msg = document.getElementById('message');
const submit = document.getElementById('submit');

function show(text, ok = false) {
  msg.textContent = text;
  msg.classList.remove('hidden');
}

onAuthStateChanged(auth, (user) => {
  if (user) location.replace('dashboard.html');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.classList.add('hidden');
  submit.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
    location.replace('dashboard.html');
  } catch (err) {
    // Deliberately generic: do not reveal whether the email exists.
    show(err && err.code === 'auth/too-many-requests'
      ? 'Too many attempts. Please wait a few minutes and try again.'
      : 'Invalid email or password.');
    submit.disabled = false;
  }
});

document.getElementById('reset').addEventListener('click', async () => {
  const email = emailEl.value.trim();
  if (!email) return show('Enter your email first, then press "Forgot password?".');
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (_) {
    /* ignore: never reveal whether the account exists */
  }
  return show('If an account exists for that email, a reset link has been sent.');
});
