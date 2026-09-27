import 'package:flutter/material.dart';

/// All color tokens derived from the Figma reference.
abstract final class AppColors {
  // Brand
  static const Color primary = Color(0xFF1A7A3C);       // deep green — buttons, CTAs
  static const Color primaryDark = Color(0xFF145C2D);   // pressed / splash background
  static const Color primaryLight = Color(0xFFE8F5EE);  // light tint — icon circles, card bg

  // Shield icon circle on splash / login
  static const Color iconCircleBg = Color(0xFF2A9D54);

  // Text
  static const Color textPrimary = Color(0xFF0D1B12);   // near-black
  static const Color textSecondary = Color(0xFF6B7280); // grey subtitles / placeholders
  static const Color textLink = Color(0xFF1A7A3C);      // "Sign Up", "Forgot Password?"

  // Input fields
  static const Color inputBorder = Color(0xFFD1D5DB);
  static const Color inputFill = Color(0xFFF9FAFB);
  static const Color inputIcon = Color(0xFF9CA3AF);

  // Surface
  static const Color surface = Color(0xFFFFFFFF);
  static const Color background = Color(0xFFF3F4F6);

  // Divider / outline
  static const Color divider = Color(0xFFE5E7EB);

  // Status — base
  static const Color error = Color(0xFFDC2626);
  static const Color success = Color(0xFF16A34A);

  // ---------------------------------------------------------------------------
  // Report status badge colors (Figma: Home + History screens)
  //
  // Each status has a text color and a matching light background tint.
  // ---------------------------------------------------------------------------

  // Pending — amber
  static const Color statusPendingText = Color(0xFFB45309);   // amber-700
  static const Color statusPendingBg   = Color(0xFFFEF3C7);   // amber-100

  // Pending stat-card icon (slightly brighter than text)
  static const Color statusPendingIcon = Color(0xFFD97706);   // amber-600

  // In Progress — blue
  static const Color statusInProgressText = Color(0xFF1D4ED8); // blue-700
  static const Color statusInProgressBg   = Color(0xFFDBEAFE); // blue-100

  // Resolved — green (uses a tint distinct from primaryLight icon circles)
  static const Color statusResolvedText = Color(0xFF15803D);   // green-700
  static const Color statusResolvedBg   = Color(0xFFDCFCE7);   // green-100

  // Rejected — red. Not rendered by the reference design yet; it exists for the
  // Phase 4 review queue, and so the API's fourth status has a colour rather
  // than falling through to a crash.
  static const Color statusRejectedText = Color(0xFFB91C1C);   // red-700
  static const Color statusRejectedBg   = Color(0xFFFEE2E2);   // red-100

  // Unknown — grey, for a status this build of the app does not recognise
  // (a newer server enum value, say). Deliberately neutral: it must not read
  // as good news or bad news.
  static const Color statusUnknownText = Color(0xFF4B5563);    // gray-600
  static const Color statusUnknownBg   = Color(0xFFF3F4F6);    // gray-100

  // Checkbox accent
  static const Color checkboxActive = Color(0xFF1A7A3C);

  // ---------------------------------------------------------------------------
  // Report category colours — icon + matching light background
  // ---------------------------------------------------------------------------

  static const Color categoryPothole = Color(0xFF78716C);
  static const Color categoryPotholeBg = Color(0xFFF5F5F4);

  static const Color categoryFlooding = Color(0xFF2563EB);
  static const Color categoryFloodingBg = Color(0xFFDBEAFE);

  static const Color categoryStreetlight = Color(0xFFD97706);
  static const Color categoryStreetlightBg = Color(0xFFFEF3C7);

  static const Color categoryWaste = Color(0xFFEA580C);
  static const Color categoryWasteBg = Color(0xFFFFEDD5);

  static const Color categoryWater = Color(0xFF0891B2);
  static const Color categoryWaterBg = Color(0xFFCFFAFE);

  static const Color categoryOther = Color(0xFF6B7280);
  static const Color categoryOtherBg = Color(0xFFF3F4F6);
}
