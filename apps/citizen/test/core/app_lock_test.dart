import 'dart:async';

import 'package:civic_report/core/security/app_lock.dart';
import 'package:civic_report/core/security/app_lock_gate.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeLocalAuth implements LocalAuthentication {
  bool supported = true;
  bool result = true;
  int prompts = 0;

  /// When set, the check waits for this instead of answering at once.
  Completer<bool>? pending;

  @override
  Future<bool> isDeviceSupported() async => supported;

  @override
  Future<bool> authenticate({
    required String localizedReason,
    Iterable<dynamic> authMessages = const [],
    bool biometricOnly = false,
    bool sensitiveTransaction = true,
    bool persistAcrossBackgrounding = false,
  }) async {
    prompts++;
    final waiting = pending;
    return waiting == null ? result : await waiting.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class SignedIn extends AuthProvider {
  SignedIn(this.signedIn);
  final bool signedIn;

  @override
  bool get isAuthenticated => signedIn;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeLocalAuth auth;
  late AppLock lock;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    auth = FakeLocalAuth();
    lock = AppLock(auth: auth, relockAfter: Duration.zero);
  });

  Future<void> pumpGate(WidgetTester tester, {bool signedIn = true}) =>
      tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AppLock>.value(value: lock),
          ChangeNotifierProvider<AuthProvider>.value(value: SignedIn(signedIn)),
        ],
        child: MaterialApp(
          builder: (_, child) => AppLockGate(child: child!),
          home: const Scaffold(body: Text('Home')),
        ),
      ));

  test('off by default; turning it on needs the phone check and is saved', () async {
    await lock.initialize();
    expect(lock.enabled, isFalse);
    expect(lock.locked, isFalse);

    expect(await lock.setEnabled(true), isNull);
    expect(auth.prompts, 1);
    expect(lock.enabled, isTrue);
    expect(lock.locked, isFalse, reason: 'just proved it is them');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(AppLock.prefsKey), isTrue);

    // A fresh launch starts locked.
    final relaunched = AppLock(auth: auth);
    await relaunched.initialize();
    expect(relaunched.locked, isTrue);
  });

  test('a phone with no screen lock cannot turn it on', () async {
    auth.supported = false;
    expect(await lock.setEnabled(true), contains('Set a screen lock'));
    expect(lock.enabled, isFalse);
    expect(auth.prompts, 0);
  });

  test('a failed check changes nothing', () async {
    auth.result = false;
    expect(await lock.setEnabled(true), isNotNull);
    expect(lock.enabled, isFalse);
  });

  test('locks again after time in the background, but not after its own trips',
      () {
    lock.debugSet(enabled: true, locked: false);

    lock.allowNextResume();
    lock.didChangeAppLifecycleState(AppLifecycleState.paused);
    lock.didChangeAppLifecycleState(AppLifecycleState.resumed);
    expect(lock.locked, isFalse, reason: 'came back from the messages app');

    lock.didChangeAppLifecycleState(AppLifecycleState.paused);
    lock.didChangeAppLifecycleState(AppLifecycleState.resumed);
    expect(lock.locked, isTrue);
  });

  testWidgets('the lock screen covers the app, offers 112, and unlocks',
      (tester) async {
    auth.pending = Completer<bool>();
    lock.debugSet(enabled: true, locked: true);
    await pumpGate(tester);
    await tester.pump();
    expect(find.text('Civic Report is locked'), findsOneWidget);
    expect(find.text('Emergency call 112'), findsOneWidget);
    // It asked straight away.
    expect(auth.prompts, 1);
    auth.pending!.complete(true);
    await tester.pump();
    expect(find.text('Civic Report is locked'), findsNothing);
    expect(find.text('Home'), findsOneWidget);
  });

  testWidgets('a failed unlock keeps the app covered', (tester) async {
    auth.result = false;
    lock.debugSet(enabled: true, locked: true);
    await pumpGate(tester);
    await tester.pump();
    await tester.pump();
    expect(find.text('Not unlocked. Try again.'), findsOneWidget);
    await tester.tap(find.text('Unlock'));
    await tester.pump();
    expect(auth.prompts, 2);
    expect(find.text('Civic Report is locked'), findsOneWidget);
  });

  testWidgets('signed out, there is nothing to lock', (tester) async {
    lock.debugSet(enabled: true, locked: true);
    await pumpGate(tester, signedIn: false);
    await tester.pump();
    expect(find.text('Civic Report is locked'), findsNothing);
    expect(auth.prompts, 0);
  });
}
