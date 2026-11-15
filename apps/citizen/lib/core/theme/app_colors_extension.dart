import 'package:flutter/material.dart';
import '../constants/app_colors.dart';

/// Theme-aware colour tokens. Widgets read these through `context.colors`
/// instead of the light-only constants in [AppColors], so they follow the
/// active [ThemeData] (light or dark).
@immutable
class AppColorsExtension extends ThemeExtension<AppColorsExtension> {
  const AppColorsExtension({
    required this.primary,
    required this.primaryLight,
    required this.textPrimary,
    required this.textSecondary,
    required this.textLink,
    required this.inputBorder,
    required this.inputFill,
    required this.inputIcon,
    required this.surface,
    required this.background,
    required this.divider,
    required this.statusPendingText,
    required this.statusPendingBg,
    required this.statusPendingIcon,
    required this.statusInProgressText,
    required this.statusInProgressBg,
    required this.statusResolvedText,
    required this.statusResolvedBg,
    required this.statusRejectedText,
    required this.statusRejectedBg,
    required this.statusUnknownText,
    required this.statusUnknownBg,
  });

  final Color primary;
  final Color primaryLight;
  final Color textPrimary;
  final Color textSecondary;
  final Color textLink;
  final Color inputBorder;
  final Color inputFill;
  final Color inputIcon;
  final Color surface;
  final Color background;
  final Color divider;
  final Color statusPendingText;
  final Color statusPendingBg;
  final Color statusPendingIcon;
  final Color statusInProgressText;
  final Color statusInProgressBg;
  final Color statusResolvedText;
  final Color statusResolvedBg;
  final Color statusRejectedText;
  final Color statusRejectedBg;
  final Color statusUnknownText;
  final Color statusUnknownBg;

  static const AppColorsExtension light = AppColorsExtension(
    primary: AppColors.primary,
    primaryLight: AppColors.primaryLight,
    textPrimary: AppColors.textPrimary,
    textSecondary: AppColors.textSecondary,
    textLink: AppColors.textLink,
    inputBorder: AppColors.inputBorder,
    inputFill: AppColors.inputFill,
    inputIcon: AppColors.inputIcon,
    surface: AppColors.surface,
    background: AppColors.background,
    divider: AppColors.divider,
    statusPendingText: AppColors.statusPendingText,
    statusPendingBg: AppColors.statusPendingBg,
    statusPendingIcon: AppColors.statusPendingIcon,
    statusInProgressText: AppColors.statusInProgressText,
    statusInProgressBg: AppColors.statusInProgressBg,
    statusResolvedText: AppColors.statusResolvedText,
    statusResolvedBg: AppColors.statusResolvedBg,
    statusRejectedText: AppColors.statusRejectedText,
    statusRejectedBg: AppColors.statusRejectedBg,
    statusUnknownText: AppColors.statusUnknownText,
    statusUnknownBg: AppColors.statusUnknownBg,
  );

  static const AppColorsExtension dark = AppColorsExtension(
    primary: Color(0xFF61D48A),
    primaryLight: Color(0xFF1F3A29),
    textPrimary: Color(0xFFF1F5F2),
    textSecondary: Color(0xFFAAB8AE),
    textLink: Color(0xFF61D48A),
    inputBorder: Color(0xFF34443A),
    inputFill: Color(0xFF18231C),
    inputIcon: Color(0xFF8A9A8F),
    surface: Color(0xFF18231C),
    background: Color(0xFF0F1712),
    divider: Color(0xFF34443A),
    statusPendingText: Color(0xFFFCD34D),
    statusPendingBg: Color(0xFF3A2E10),
    statusPendingIcon: Color(0xFFFBBF24),
    statusInProgressText: Color(0xFF93C5FD),
    statusInProgressBg: Color(0xFF14284A),
    statusResolvedText: Color(0xFF86EFAC),
    statusResolvedBg: Color(0xFF14341F),
    statusRejectedText: Color(0xFFFCA5A5),
    statusRejectedBg: Color(0xFF3F1818),
    statusUnknownText: Color(0xFFD1D5DB),
    statusUnknownBg: Color(0xFF2A322D),
  );

  @override
  AppColorsExtension copyWith() => this;

  @override
  AppColorsExtension lerp(ThemeExtension<AppColorsExtension>? other, double t) {
    if (other is! AppColorsExtension) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return AppColorsExtension(
      primary: l(primary, other.primary),
      primaryLight: l(primaryLight, other.primaryLight),
      textPrimary: l(textPrimary, other.textPrimary),
      textSecondary: l(textSecondary, other.textSecondary),
      textLink: l(textLink, other.textLink),
      inputBorder: l(inputBorder, other.inputBorder),
      inputFill: l(inputFill, other.inputFill),
      inputIcon: l(inputIcon, other.inputIcon),
      surface: l(surface, other.surface),
      background: l(background, other.background),
      divider: l(divider, other.divider),
      statusPendingText: l(statusPendingText, other.statusPendingText),
      statusPendingBg: l(statusPendingBg, other.statusPendingBg),
      statusPendingIcon: l(statusPendingIcon, other.statusPendingIcon),
      statusInProgressText: l(statusInProgressText, other.statusInProgressText),
      statusInProgressBg: l(statusInProgressBg, other.statusInProgressBg),
      statusResolvedText: l(statusResolvedText, other.statusResolvedText),
      statusResolvedBg: l(statusResolvedBg, other.statusResolvedBg),
      statusRejectedText: l(statusRejectedText, other.statusRejectedText),
      statusRejectedBg: l(statusRejectedBg, other.statusRejectedBg),
      statusUnknownText: l(statusUnknownText, other.statusUnknownText),
      statusUnknownBg: l(statusUnknownBg, other.statusUnknownBg),
    );
  }
}

/// Theme-aware text styles (same names as `AppTextStyles`).
class AppTextStylesThemed {
  const AppTextStylesThemed(this._c);
  final AppColorsExtension _c;

  TextStyle get heading1 => TextStyle(
      fontSize: 26,
      fontWeight: FontWeight.w700,
      color: _c.textPrimary,
      letterSpacing: -0.5);
  TextStyle get heading2 => TextStyle(
      fontSize: 22,
      fontWeight: FontWeight.w700,
      color: _c.textPrimary,
      letterSpacing: -0.3);
  TextStyle get bodyMedium => TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      color: _c.textSecondary,
      height: 1.5);
  TextStyle get bodySmall => TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w400,
      color: _c.textSecondary,
      height: 1.4);
  TextStyle get label => TextStyle(
      fontSize: 13, fontWeight: FontWeight.w500, color: _c.textPrimary);
  // Text on a brand-coloured button: always light on the primary fill.
  TextStyle get button => const TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w600,
      color: Colors.white,
      letterSpacing: 0.2);
  TextStyle get link => TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w600,
      color: _c.textLink,
      decoration: TextDecoration.underline,
      decorationColor: _c.textLink);
  // Splash sits on the brand colour in both modes.
  TextStyle get splashTitle => const TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w700,
      color: Colors.white,
      letterSpacing: -0.5);
  TextStyle get splashTagline => const TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w400,
      color: Color(0xCCFFFFFF),
      height: 1.5);
}

extension AppThemeContext on BuildContext {
  AppColorsExtension get colors =>
      Theme.of(this).extension<AppColorsExtension>() ??
      AppColorsExtension.light;
  AppTextStylesThemed get textStyles => AppTextStylesThemed(colors);
}
