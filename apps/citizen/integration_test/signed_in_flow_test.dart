import 'package:civic_report/core/providers/app_settings_provider.dart';
import 'package:civic_report/core/services/token_storage_service.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';
import 'package:civic_report/main.dart';
import 'package:civic_report/shared/widgets/app_bottom_nav.dart';
import 'package:civic_report/shared/widgets/primary_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// On-device tests for a signed-in citizen, against the real API.
///
/// Credentials are supplied at run time and never stored in the repo:
///
///   flutter test integration_test/signed_in_flow_test.dart -d <device> \
///     --dart-define=TEST_EMAIL=you@example.com \
///     --dart-define=TEST_PASSWORD=...
///
/// Without them every test here is skipped.
const _email = String.fromEnvironment('TEST_EMAIL');
const _password = String.fromEnvironment('TEST_PASSWORD');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final skip = (_email.isEmpty || _password.isEmpty)
      ? 'TEST_EMAIL / TEST_PASSWORD not provided'
      : null;

  /// Pumps real time until [finder] matches. Used instead of pumpAndSettle
  /// because network spinners animate forever and would never "settle".
  Future<void> waitFor(
    WidgetTester tester,
    Finder finder, {
    Duration timeout = const Duration(seconds: 30),
    String? reason,
  }) async {
    final end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 300));
      if (finder.evaluate().isNotEmpty) return;
    }
    fail(reason ?? 'Timed out waiting for $finder');
  }

  Finder navItem(String label) => find.descendant(
        of: find.byType(AppBottomNav),
        matching: find.text(label),
      );

  Future<void> tapNav(WidgetTester tester, String label) async {
    await tester.tap(navItem(label));
    await tester.pump(const Duration(milliseconds: 500));
  }

  Future<void> signIn(WidgetTester tester) async {
    await TokenStorageService.instance.clearAll();
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();

    final auth = AuthProvider();
    final settings = AppSettingsProvider();
    await tester.pumpWidget(
      CivicReportApp(authProvider: auth, settingsProvider: settings),
    );
    await settings.initialize();
    await auth.initialize();
    await tester.pumpAndSettle(const Duration(seconds: 5));
    expect(find.text('Welcome Back'), findsOneWidget);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), _email);
    await tester.enterText(fields.at(1), _password);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.tap(find.widgetWithText(PrimaryButton, 'Sign In'));

    // First sign-in lands on the permissions screen; later ones go to Home.
    final permissions = find.text('Allow Access');
    final home = find.byType(AppBottomNav);
    await waitFor(
      tester,
      find.byWidgetPredicate(
        (_) => permissions.evaluate().isNotEmpty || home.evaluate().isNotEmpty,
      ),
      reason: 'Sign in did not reach permissions or home (bad credentials or '
          'API unreachable?)',
    );

    if (permissions.evaluate().isNotEmpty) {
      // "Skip" avoids OS permission dialogs, which the test cannot drive.
      await tester.tap(find.text('Skip for now'));
      await waitFor(tester, home);
    }
  }

  testWidgets('signs in and reaches Home', (tester) async {
    await signIn(tester);

    expect(find.text('Recent Reports'), findsOneWidget);
    expect(navItem('Home'), findsOneWidget);
    expect(navItem('Report'), findsOneWidget);
    expect(navItem('History'), findsOneWidget);
    expect(navItem('Profile'), findsOneWidget);
  }, skip: skip != null);

  testWidgets('bottom navigation reaches every tab', (tester) async {
    await signIn(tester);

    await tapNav(tester, 'Report');
    await waitFor(tester, find.text('Report an Issue'));
    expect(find.text('Select Category'), findsOneWidget);

    await tapNav(tester, 'History');
    await waitFor(tester, find.text('My Reports'));

    await tapNav(tester, 'Profile');
    await waitFor(tester, find.text('Edit Profile'));

    await tapNav(tester, 'Home');
    await waitFor(tester, find.text('Recent Reports'));
  }, skip: skip != null);

  testWidgets('profile sub-screens open and return', (tester) async {
    await signIn(tester);
    await tapNav(tester, 'Profile');
    await waitFor(tester, find.text('Edit Profile'));

    for (final entry in {
      'Help & Support': find.text('Help & Support'),
      'About': find.text('About'),
    }.entries) {
      await tester.ensureVisible(find.text(entry.key).first);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text(entry.key).first);
      await tester.pump(const Duration(milliseconds: 800));
      // Each sub-screen is pushed, so the profile list is no longer on top.
      expect(find.text('Edit Profile').hitTestable(), findsNothing,
          reason: '${entry.key} did not open');
      await tester.pageBack();
      await tester.pump(const Duration(milliseconds: 800));
      expect(find.text('Edit Profile'), findsOneWidget);
    }
  }, skip: skip != null);

  testWidgets('log out returns to login and clears the session',
      (tester) async {
    await signIn(tester);
    await tapNav(tester, 'Profile');
    await waitFor(tester, find.text('Log Out'));

    await tester.ensureVisible(find.text('Log Out'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Log Out'));

    await waitFor(tester, find.text('Welcome Back'));
    expect(await TokenStorageService.instance.getAccessToken(), isNull);
  }, skip: skip != null);
}
