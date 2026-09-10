import 'package:flutter/material.dart';
import 'app_colors.dart';

abstract final class AppTextStyles {
  // Headings
  static const TextStyle heading1 = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    letterSpacing: -0.5,
  );

  static const TextStyle heading2 = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    letterSpacing: -0.3,
  );

  // Body
  static const TextStyle bodyMedium = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
    height: 1.5,
  );

  static const TextStyle bodySmall = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  // Label
  static const TextStyle label = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
  );

  // Button
  static const TextStyle button = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: AppColors.surface,
    letterSpacing: 0.2,
  );

  // Link
  static const TextStyle link = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    color: AppColors.textLink,
    decoration: TextDecoration.underline,
    decorationColor: AppColors.textLink,
  );

  // Splash brand name
  static const TextStyle splashTitle = TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: AppColors.surface,
    letterSpacing: -0.5,
  );

  static const TextStyle splashTagline = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: Color(0xCCFFFFFF), // white 80%
    height: 1.5,
  );
}
