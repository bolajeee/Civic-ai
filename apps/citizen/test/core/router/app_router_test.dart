import 'package:civic_report/core/router/app_router.dart';
import 'package:civic_report/features/auth/providers/auth_provider.dart';
import 'package:flutter_test/flutter_test.dart';

/// Regression tests for the routing rules.
///
/// The app previously hung on the splash screen forever on a fresh install:
/// splash (`/`) was grouped with login/register as an "auth route", so once
/// `initialize()` settled on `unauthenticated` the redirect happily returned
/// null for `/` — the router was told staying there was fine, and nothing ever
/// moved. The first test below is that exact scenario.
void main() {
  group('initializing', () {
    test('splash is allowed to stay', () {
      expect(
        resolveRedirect(
          status: AuthStatus.initializing,
          location: AppRoutes.splash,
          permissionsGranted: false,
        ),
        isNull,
      );
    });

    test('any other location is pulled back to splash', () {
      for (final location in [
        AppRoutes.login,
        AppRoutes.home,
        AppRoutes.permissions,
        AppRoutes.report,
        AppRoutes.history,
      ]) {
        expect(
          resolveRedirect(
            status: AuthStatus.initializing,
            location: location,
            permissionsGranted: false,
          ),
          AppRoutes.splash,
          reason: '$location should be held at splash while initializing',
        );
      }
    });
  });

  group('unauthenticated', () {
    test('splash redirects to login — the fresh-install regression', () {
      expect(
        resolveRedirect(
          status: AuthStatus.unauthenticated,
          location: AppRoutes.splash,
          permissionsGranted: false,
        ),
        AppRoutes.login,
      );
    });

    test('login and register are reachable', () {
      for (final location in [AppRoutes.login, AppRoutes.register]) {
        expect(
          resolveRedirect(
            status: AuthStatus.unauthenticated,
            location: location,
            permissionsGranted: false,
          ),
          isNull,
          reason: '$location must be reachable while signed out',
        );
      }
    });

    test('protected routes redirect to login', () {
      for (final location in [
        AppRoutes.home,
        AppRoutes.permissions,
        AppRoutes.report,
        AppRoutes.history,
      ]) {
        expect(
          resolveRedirect(
            status: AuthStatus.unauthenticated,
            location: location,
            permissionsGranted: true,
          ),
          AppRoutes.login,
          reason: '$location must be gated behind login',
        );
      }
    });
  });

  group('authenticated', () {
    test('splash routes to home when permissions were granted', () {
      expect(
        resolveRedirect(
          status: AuthStatus.authenticated,
          location: AppRoutes.splash,
          permissionsGranted: true,
        ),
        AppRoutes.home,
      );
    });

    test('splash routes to permissions on first launch', () {
      expect(
        resolveRedirect(
          status: AuthStatus.authenticated,
          location: AppRoutes.splash,
          permissionsGranted: false,
        ),
        AppRoutes.permissions,
      );
    });

    test('login and register are escorted out', () {
      for (final location in [AppRoutes.login, AppRoutes.register]) {
        expect(
          resolveRedirect(
            status: AuthStatus.authenticated,
            location: location,
            permissionsGranted: true,
          ),
          AppRoutes.home,
        );
      }
    });

    test('real app routes pass through untouched', () {
      for (final location in [
        AppRoutes.home,
        AppRoutes.permissions,
        AppRoutes.report,
        AppRoutes.history,
      ]) {
        expect(
          resolveRedirect(
            status: AuthStatus.authenticated,
            location: location,
            permissionsGranted: true,
          ),
          isNull,
          reason: '$location must not be bounced while signed in',
        );
      }
    });
  });
}
