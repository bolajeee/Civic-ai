import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/register_screen.dart';
import '../../features/auth/screens/splash_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../features/permissions/screens/permissions_screen.dart';
import '../../features/report/screens/report_issue_screen.dart';

abstract final class AppRoutes {
  static const String splash = '/';
  static const String login = '/login';
  static const String register = '/register';
  static const String permissions = '/permissions';
  static const String home = '/home';
  static const String report = '/report';
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
///   authenticated    → onboarding routes are escorted to /permissions or
///                      /home; every real app route passes through
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

  // 3. Logged in — escort the onboarding routes to their destination.
  final isOnboardingRoute = location == AppRoutes.splash ||
      location == AppRoutes.login ||
      location == AppRoutes.register;

  if (isOnboardingRoute) {
    return permissionsGranted ? AppRoutes.home : AppRoutes.permissions;
  }

  // Any real app route (home, permissions, report, …) is allowed through.
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
        builder: (_, __) => const ReportIssueScreen(),
      ),
    ],
  );
}
