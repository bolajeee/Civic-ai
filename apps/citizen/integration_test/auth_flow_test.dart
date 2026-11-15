import 'package:civic_report/core/providers/app_settings_provider.dart';
import 'package:civic_report/core/services/token_storage_service.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';
import 'package:civic_report/main.dart';
import 'package:civic_report/shared/widgets/primary_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// On-device tests for the unauthenticated half of the citizen app.
///
/// They run against the real platform channels (secure storage, shared
/// preferences) on a phone, but never submit a form that would reach the API,
/// so they are deterministic and need no backend or test account.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  /// Wipes any session left by an earlier run so every test is a fresh install.
  Future<void> boot(WidgetTester tester) async {
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
  }

  Finder fieldWithHint(String hint) => find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.hintText == hint,
      );

  Future<void> tapVisible(
    WidgetTester tester,
    Finder finder, {
    bool settle = true,
  }) async {
    // On a real phone the soft keyboard shrinks the viewport and can cover the
    // target, so drop focus (and with it the keyboard) before scrolling, and
    // give the real keyboard animation time to finish.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    // Transient UI such as a snackbar disappears while settling, so callers
    // that assert on it pass settle: false and only pump a few frames.
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
    }
  }

  Future<void> goToRegister(WidgetTester tester) async {
    await tapVisible(tester, find.text('Sign Up'));
    expect(find.text('Create Account'), findsWidgets);
  }

  Finder registerField(int index) => find.byType(TextFormField).at(index);

  group('fresh install', () {
    testWidgets('lands on the login screen, not the splash', (tester) async {
      await boot(tester);

      expect(find.text('Welcome Back'), findsOneWidget);
      expect(find.text('Sign In'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
    });
  });

  group('login', () {
    testWidgets('empty submit shows required-field errors', (tester) async {
      await boot(tester);

      await tapVisible(tester, find.widgetWithText(PrimaryButton, 'Sign In'));

      expect(find.text('Email is required'), findsOneWidget);
      expect(find.text('Password is required'), findsOneWidget);
    });

    testWidgets('rejects a malformed email', (tester) async {
      await boot(tester);

      await tester.enterText(fieldWithHint('e.g. adaeze@domain.ng'), 'nope');
      await tester.enterText(fieldWithHint('••••••••'), 'secret123');
      await tapVisible(tester, find.widgetWithText(PrimaryButton, 'Sign In'));

      expect(find.text('Enter a valid email address'), findsOneWidget);
      expect(find.text('Password is required'), findsNothing);
    });

    testWidgets('password visibility toggle works', (tester) async {
      await boot(tester);

      bool obscured() => tester
          .widget<TextField>(fieldWithHint('••••••••'))
          .obscureText;

      expect(obscured(), isTrue);
      await tapVisible(tester, find.byIcon(Icons.visibility_off_outlined));
      expect(obscured(), isFalse);
      await tapVisible(tester, find.byIcon(Icons.visibility_outlined));
      expect(obscured(), isTrue);
    });

    testWidgets('forgot password opens recovery with the typed email',
        (tester) async {
      await boot(tester);

      await tester.enterText(
        fieldWithHint('e.g. adaeze@domain.ng'),
        'ada@example.com',
      );
      await tapVisible(tester, find.text('Forgot Password?'));

      expect(find.text('Recover your account'), findsOneWidget);
      expect(find.text('ada@example.com'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Welcome Back'), findsOneWidget);
    });
  });

  group('registration', () {
    testWidgets('empty submit shows every required-field error',
        (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tapVisible(
          tester, find.widgetWithText(PrimaryButton, 'Create Account'));

      expect(find.text('Full name is required'), findsOneWidget);
      expect(find.text('NIN is required'), findsOneWidget);
      expect(find.text('Email is required'), findsOneWidget);
    });

    testWidgets('NIN accepts digits only and must be 11 long', (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tester.enterText(registerField(1), '12ab34');
      await tester.pump();
      expect(
        tester.widget<TextFormField>(registerField(1)).controller!.text,
        '1234',
        reason: 'letters must be filtered out by the input formatter',
      );

      await tapVisible(
          tester, find.widgetWithText(PrimaryButton, 'Create Account'));
      expect(find.text('NIN must be exactly 11 digits'), findsOneWidget);
    });

    testWidgets('requires first and last name', (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tester.enterText(registerField(0), 'Ada');
      await tapVisible(
          tester, find.widgetWithText(PrimaryButton, 'Create Account'));

      expect(find.text('Please enter your first and last name'),
          findsOneWidget);
    });

    testWidgets('flags a short password and a mismatch', (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tester.enterText(registerField(4), 'short');
      await tester.enterText(registerField(5), 'different');
      await tapVisible(
          tester, find.widgetWithText(PrimaryButton, 'Create Account'));

      expect(find.text('Password must be at least 8 characters'),
          findsOneWidget);
      expect(find.text('Passwords do not match'), findsOneWidget);
    });

    testWidgets('valid form without accepting terms is blocked',
        (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tester.enterText(registerField(0), 'Ada Okafor');
      await tester.enterText(registerField(1), '12345678901');
      await tester.enterText(registerField(2), 'ada@example.com');
      await tester.enterText(registerField(4), 'password123');
      await tester.enterText(registerField(5), 'password123');
      await tapVisible(
        tester,
        find.widgetWithText(PrimaryButton, 'Create Account'),
        settle: false,
      );

      expect(
        find.text('Please agree to the Terms & Conditions to continue.'),
        findsOneWidget,
      );
      // Still on the registration screen: nothing was submitted.
      expect(find.text('Join to start building a functional Nigeria.'),
          findsOneWidget);
    });

    testWidgets('"Sign In" returns to the login screen', (tester) async {
      await boot(tester);
      await goToRegister(tester);

      await tapVisible(tester, find.text('Sign In'));

      expect(find.text('Welcome Back'), findsOneWidget);
    });
  });
}
