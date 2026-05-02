"""Python service writing Firestore."""
from firebase_admin import firestore
db = firestore.client()


def create_app(uid, payload):
    doc = db.collection("applications").document()
    doc.set({
        "userId": uid,
        "status": "draft",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "title": payload["title"],
    })


def update_user(uid, name):
    db.collection("users").document(uid).update({
        "displayName": name,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
