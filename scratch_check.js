import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBLYtTJtHGfIaIkdi5Qw41wm6sD-tEpGZQ",
  authDomain: "sjvps-5a7f0.firebaseapp.com",
  projectId: "sjvps-5a7f0",
  storageBucket: "sjvps-5a7f0.firebasestorage.app",
  messagingSenderId: "195226208341",
  appId: "1:195226208341:web:d8c0e179e136b4369e2cdc",
  measurementId: "G-6NQGNFC8PQ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkIndexRange() {
  const registerId = 1779264119644;
  const chunkSnap = await getDocs(collection(db, 'registers', registerId.toString(), 'chunks'));
  const allEntries = [];
  chunkSnap.docs.forEach((doc) => {
    const chunkData = doc.data();
    if (chunkData.entries) {
      allEntries.push(...chunkData.entries);
    }
  });

  console.log("Inspecting entries from row 155 to 168 (index 154 to 167):");
  const slice = allEntries.slice(154, 168);
  slice.forEach((e, i) => {
    console.log(`Index ${154 + i}: ID=${e.id}, rowNumber=${e.rowNumber}, studentName=${e.cells?.['1779264119649']}`);
  });
  
  process.exit(0);
}

checkIndexRange().catch(console.error);
