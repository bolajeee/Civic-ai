import 'package:flutter/material.dart';

/// All color tokens derived from the Figma reference.
abstract final class AppColors {
  // Brand
  static const Color primary = Color(0xFF1A7A3C);       // deep green — buttons, CTAs
  static const Color primaryDark = Color(0xFF145C2D);   // pressed / splash background
  static const Color primaryLight = Color(0xFFE8F5EE);  // light tint for backgrounds

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

  // Status
  static const Color error = Color(0xFFDC2626);
  static const Color success = Color(0xFF16A34A);

  // Checkbox accent
  static const Color checkboxActive = Color(0xFF1A7A3C);
}
