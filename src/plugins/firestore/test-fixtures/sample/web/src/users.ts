// TS web app writing Firestore.
import { setDoc, updateDoc, doc, collection } from 'firebase/firestore';
import { db } from './firebase';

export async function createUser(uid: string, name: string, email: string) {
  await setDoc(doc(db, 'users', uid), {
    displayName: name,
    email,
    createdAt: new Date(),
  });
}

export async function changeStatus(id: string, status: string) {
  await updateDoc(doc(db, 'applications', id), {
    status,
    updatedAt: new Date(),
  });
}
