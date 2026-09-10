import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/register_screen.dart';
import '../../features/auth/screens/splash_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../features/permissions/screens/permissions_screen.dart';
import '../constants/app_constants.dart';

abstract final class AppRoutes {
  static const String splash = '/';
  static const String login = '/login';
  static const String register = '/register';
  static const String permissions = '/permissions';
  static const String home = '/home';
}

/// Builds the [GoRouter] instance.
///
/// Redirect logic (evaluated on every navigation + every [AuthProvider] change):
///
///   initializing          → hold on splash
///   unauthenticated       → any protected route goes to /login
///   authenticated
///     └─ permissions not yet granted → /permissions (first launch only)
///     └─ permissions already granted → /home
///     └─ on an auth route (login/register/splash) → /permissions or /home
GoRouter buildRouter(AuthProvider authProvider) {
  return GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: authProvider,
    redirect: (BuildContext context, GoRouterState state) async {
      final status = authProvider.status;
      final location = state.matchedLocation;

      // -----------------------------------------------------------------------
      // 1. Still checking storage — stay on splash
      // -----------------------------------------------------------------------
      if (status == AuthStatus.initializing) {
        return location == AppRoutes.splash ? null : AppRoutes.splash;
      }

      // -----------------------------------------------------------------------
      // 2. Not logged in — only auth routes are allowed
      // -----------------------------------------------------------------------
      final isAuthRoute = location == AppRoutes.login ||
          location == AppRoutes.register ||
          location == AppRoutes.splash;

      if (status == AuthStatus.unauthenticated) {
        return isAuthRoute ? null : AppRoutes.login;
      }

      // -----------------------------------------------------------------------
      // 3. Logged in — decide between /permissions and /home
      // -----------------------------------------------------------------------
      final prefs = await SharedPreferences.getInstance();
      final permissionsGranted =
          prefs.getBool(AppConstants.keyPermissionsGranted) ?? false;

      // Already on permissions screen — allow it
      if (location == AppRoutes.permissions) return null;

      // Already on home — allow it
      if (location == AppRoutes.home) return null;

      // Coming from an auth route or splash after login → go to permissions
      // first if they haven't been asked yet, otherwise straight to home.
      if (isAuthRoute) {
        return permissionsGranted ? AppRoutes.home : AppRoutes.permissions;
      }

      // Any other protected route while logged in — allow through
      return null;
    },
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
    ],
  );
}
