// Dart app writing Firestore.
import 'package:cloud_firestore/cloud_firestore.dart';

class AppService {
  final db = FirebaseFirestore.instance;

  Future<String> submit(String uid, String title) async {
    final ref = await db.collection('applications').add({
      'userId': uid,
      'title': title,
      'status': 'draft',
      'createdAt': FieldValue.serverTimestamp(),
    });
    return ref.id;
  }
}
