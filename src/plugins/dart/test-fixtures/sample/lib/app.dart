// Sample Dart app for parser tests.
import 'package:sample_app/services/user_service.dart';
import './config.dart';

class App {
  final String name = 'sample';

  Future<int> run() async {
    try {
      final svc = UserService();
      return await svc.fetchAll();
    } catch (_) {}
    return 0;
  }

  Future<void> badAsync() {
    // returns Future but body uses .then without await — flagged.
    return loadData().then((data) => print(data));
  }
}

int helper(int x) {
  if (x > 0) {
    if (x > 10) return 100;
    return 1;
  }
  return 0;
}

Future<String> loadData() async {
  return 'data';
}
