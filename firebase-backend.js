// firebase-backend.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, getDocs, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, runTransaction, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJSqERqx8Cu_Jts6NMATFJvWJpUm9rtsM",
  authDomain: "pixelcolor-83825.firebaseapp.com",
  projectId: "pixelcolor-83825",
  storageBucket: "pixelcolor-83825.firebasestorage.app",
  messagingSenderId: "798063431499",
  appId: "1:798063431499:web:3f2154ba7589e6acd362ce",
  measurementId: "G-DJBBR1BN3K"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (!user) {
        signInAnonymously(auth).catch(console.error);
    }
});

// Анонимный вход для игроков
signInAnonymously(auth).catch(console.error);

const Comm = {};

Comm.loginModerator = async (email, password) => {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, email: userCredential.user.email };
    } catch (e) { return { success: false, error: "Неверный Email или пароль" }; }
};

Comm.logout = async () => {
    await signOut(auth);
    await signInAnonymously(auth);
};

Comm.isModerator = () => currentUser && currentUser.email != null;

Comm.getApproved = async () => {
    const q = query(collection(db, "levels"), where("status", "==", "approved"), orderBy("likes", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

Comm.getPending = async () => {
    if (!Comm.isModerator()) return [];
    const q = query(collection(db, "levels"), where("status", "==", "pending"), orderBy("date", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

Comm.submit = async (levelData, author, anonymous) => {
    if (!currentUser) throw new Error("Нет соединения с сервером");
    await addDoc(collection(db, "levels"), {
        name: levelData.name,
        level: levelData,
        author: anonymous ? null : author,
        anonymous: anonymous,
        authorId: currentUser.uid,
        status: 'pending',
        likes: 0,
        date: serverTimestamp()
    });
};

Comm.approve = async (id) => { await updateDoc(doc(db, "levels", id), { status: 'approved' }); };
Comm.reject = async (id) => { await updateDoc(doc(db, "levels", id), { status: 'rejected' }); };
Comm.remove = async (id) => { await deleteDoc(doc(db, "levels", id)); };

Comm.hasLiked = async (levelId) => {
    if (!currentUser) return false;
    const docRef = doc(db, "likes", levelId, "users", currentUser.uid);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
};

Comm.like = async (levelId) => {
    if (!currentUser) return null;
    const likeRef = doc(db, "likes", levelId, "users", currentUser.uid);
    const levelRef = doc(db, "levels", levelId);

    try {
        return await runTransaction(db, async (transaction) => {
            const likeDoc = await transaction.get(likeRef);
            const levelDoc = await transaction.get(levelRef);
            if (!levelDoc.exists()) throw "Нет уровня";

            const currentLikes = levelDoc.data().likes || 0;
            if (likeDoc.exists()) {
                transaction.delete(likeRef);
                transaction.update(levelRef, { likes: Math.max(0, currentLikes - 1) });
                return { liked: false, likes: Math.max(0, currentLikes - 1) };
            } else {
                transaction.set(likeRef, { timestamp: serverTimestamp() });
                transaction.update(levelRef, { likes: currentLikes + 1 });
                return { liked: true, likes: currentLikes + 1 };
            }
        });
    } catch (e) { return null; }
};

window.PC = window.PC || {};
window.PC.community = Comm;