import 'package:flutter_test/flutter_test.dart';
import 'package:civic_report/main.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';

void main() {
  testWidgets('App bootstraps without throwing', (WidgetTester tester) async {
    // Pump the real app root — verifies that CivicReportApp builds, the
    // MultiProvider is wired up, and the GoRouter renders the splash screen
    // without throwing. Full auth-flow integration tests belong in
    // test/features/auth/ once a mock HTTP client is set up.
    final authProvider = AuthProvider();
    await tester.pumpWidget(CivicReportApp(authProvider: authProvider));

    // Splash screen should be visible on cold launch
    expect(find.text('Civic Report'), findsOneWidget);
  });
}
