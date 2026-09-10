import 'package:flutter/foundation.dart';

abstract final class AppConstants {
  // ---------------------------------------------------------------------------
  // API base URL
  //
  // Resolution order:
  //   1. --dart-define=API_BASE_URL=https://... (CI / staging / prod builds)
  //   2. Platform-aware dev default:
  //      • Android emulator  → 10.0.2.2  (routes to host machine)
  //      • iOS simulator / desktop / web → 127.0.0.1
  // ---------------------------------------------------------------------------
  static final String baseUrl = () {
    const defined = String.fromEnvironment('API_BASE_URL');
    if (defined.isNotEmpty) return defined;

    // Runtime platform check — only needed for local dev
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3000';
    }
    return 'http://127.0.0.1:3000';
  }();

  // Token storage keys
  static const String keyAccessToken = 'access_token';
  static const String keyRefreshToken = 'refresh_token';
  static const String keyUserId = 'user_id';

  // Prefs keys
  static const String keyPermissionsGranted = 'permissions_granted';

  // Spacing
  static const double spacingXs = 4.0;
  static const double spacingSm = 8.0;
  static const double spacingMd = 16.0;
  static const double spacingLg = 24.0;
  static const double spacingXl = 32.0;
  static const double spacingXxl = 48.0;

  // Border radius
  static const double radiusSm = 8.0;
  static const double radiusMd = 12.0;
  static const double radiusLg = 16.0;
  static const double radiusButton = 50.0;

  // Input
  static const double inputHeight = 52.0;
}
