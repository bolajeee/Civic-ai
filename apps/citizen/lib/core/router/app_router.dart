import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/register_screen.dart';
import '../../features/auth/screens/splash_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../features/permissions/screens/permissions_screen.dart';
import '../../features/profile/screens/profile_screen.dart';
import '../../features/report/providers/report_history_provider.dart';
import '../../features/report/screens/history_screen.dart';
import '../../features/report/screens/report_screen.dart';
import '../../features/report/screens/report_details_screen.dart';

abstract final class AppRoutes {
  static const String splash = '/';
  static const String login = '/login';
  static const String register = '/register';
  static const String permissions = '/permissions';
  static const String home = '/home';
  static const String report = '/report';
  static const String history = '/history';
  static const String profile = '/profile';
  static const String reportDetails = '/report-details/:id';
}

/// Decides where a navigation to [location] should actually land.
///
/// Extracted from [buildRouter] as a pure function so the routing rules — the
/// exact thing that once left the app stranded on the splash screen — can be
/// unit-tested without standing up a widget tree. Returns the location to
/// redirect to, or null to allow [location].
///
/// Rules:
///   initializing     → splash is the only valid destination
///   unauthenticated  → login/register only; everything else → /login
///   authenticated    → the onboarding routes are escorted to /permissions or
///                      /home, and /permissions escorts itself to /home once
///                      its flag is set; every real app route passes through
///
/// Splash (`/`) is deliberately NOT grouped with login/register as an "auth
/// route". It is the router's `initialLocation`, so treating it as a valid
/// destination once the status has settled parks the app there forever — the
/// bug this split exists to prevent. Splash is only reachable while
/// `initializing`.
String? resolveRedirect({
  required AuthStatus status,
  required String location,
  required bool permissionsGranted,
}) {
  // 1. Still initializing — splash is the only place to be
  if (status == AuthStatus.initializing) {
    return location == AppRoutes.splash ? null : AppRoutes.splash;
  }

  // 2. Not logged in — only login/register are reachable.
  //    Splash, permissions, home, report → /login
  if (status == AuthStatus.unauthenticated) {
    return location == AppRoutes.login || location == AppRoutes.register
        ? null
        : AppRoutes.login;
  }

  // 3. Logged in — the onboarding screens hand off once their job is done.
  //
  // /permissions is tested separately, before the generic onboarding check,
  // because it is the one screen that has to move itself: the citizen taps
  // "Grant" or "Skip" while already standing on it. A rule that merely allowed
  // it through — which is what both this function and the inline copy it
  // replaced used to do — declared their current location fine and left them
  // stranded there, which is the hang.
  if (location == AppRoutes.permissions) {
    return permissionsGranted ? AppRoutes.home : null;
  }

  final isOnboardingRoute = location == AppRoutes.splash ||
      location == AppRoutes.login ||
      location == AppRoutes.register;

  if (isOnboardingRoute) {
    return permissionsGranted ? AppRoutes.home : AppRoutes.permissions;
  }

  // Any real app route (home, report, history, …) is allowed through.
  return null;
}

/// Builds the [GoRouter] instance.
///
/// The redirect is fully SYNCHRONOUS — no async I/O inside the callback.
/// [AuthProvider] owns [permissionsGranted] and loads it from SharedPreferences
/// during [initialize], so by the time the first notifyListeners() fires the
/// flag is already available. The decision itself lives in [resolveRedirect].
GoRouter buildRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: authProvider,
    // Deliberately thin. The rules live in [resolveRedirect] so there is one
    // copy of them, unit-testable without a widget tree. An earlier version
    // inlined a second, `async` copy here that re-read SharedPreferences on
    // every navigation — and the two had already drifted apart.
    redirect: (BuildContext context, GoRouterState state) => resolveRedirect(
      status: authProvider.status,
      location: state.matchedLocation,
      permissionsGranted: authProvider.permissionsGranted,
    ),
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (_, __) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (_, __) => const RegisterScreen(),
      ),
      GoRoute(
        path: AppRoutes.permissions,
        builder: (_, __) => const PermissionsScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (_, __) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.report,
        builder: (_, __) => const ReportScreen(),
      ),
      GoRoute(
        path: AppRoutes.history,
        builder: (_, state) => HistoryScreen(
          initialFilter: state.uri.queryParameters['filter'],
          highlightId: state.uri.queryParameters['id'],
        ),
      ),
      GoRoute(
        path: AppRoutes.reportDetails,
        builder: (context, state) {
          // Read from the history provider rather than `GET /api/reports/:id`,
          // which the API does not serve. Every route into this screen is a tap
          // on a row that came from that list, so the report is already held.
          // The providers sit above MaterialApp.router in main.dart, which is
          // what makes them reachable from here.
          final id = state.pathParameters['id'];
          final report =
              id == null ? null : context.read<ReportHistoryProvider>().byPublicId(id);

          return report == null
              ? const _ReportNotFoundScreen()
              : ReportDetailsScreen(report: report);
        },
      ),
      GoRoute(
        path: AppRoutes.profile,
        builder: (_, __) => const ProfileScreen(),
      ),
    ],
  );
}

/// Shown when a report id does not resolve.
///
/// The realistic way to land here is a stale or shared link: the id is
/// well-formed but the report is not in the page this device has loaded —
/// `fetchHistory` returns the newest twenty, so an older report is simply not
/// held. It offers a way onward rather than the dead end this used to be.
///
/// Deliberately plain, and deliberately the only widget in this file: the
/// router is not where presentation lives.
class _ReportNotFoundScreen extends StatelessWidget {
  const _ReportNotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report Details')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.search_off_rounded, size: 40),
              const SizedBox(height: 16),
              const Text(
                'Report not found',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              const Text(
                'It may not be in the reports loaded on this device.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () => context.go(AppRoutes.history),
                child: const Text('Back to my reports'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
