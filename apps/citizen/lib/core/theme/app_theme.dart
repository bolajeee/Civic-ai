import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../constants/app_colors.dart';
import '../constants/app_constants.dart';
import 'app_colors_extension.dart';

abstract final class AppTheme {
  static ThemeData get light => _build(
        brightness: Brightness.light,
        c: AppColorsExtension.light,
        error: AppColors.error,
        onPrimary: Colors.white,
      );

  static ThemeData get dark => _build(
        brightness: Brightness.dark,
        c: AppColorsExtension.dark,
        error: const Color(0xFFFF6B6B),
        onPrimary: const Color(0xFF0F1712),
      );

  static ThemeData _build({
    required Brightness brightness,
    required AppColorsExtension c,
    required Color error,
    required Color onPrimary,
  }) {
    final isDark = brightness == Brightness.dark;
    final styles = AppTextStylesThemed(c);
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: brightness,
      primary: c.primary,
      onPrimary: onPrimary,
      surface: c.surface,
      onSurface: c.textPrimary,
      error: error,
    );

    OutlineInputBorder border(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      cardColor: c.surface,
      dividerColor: c.divider,
      extensions: [c],

      // Default text colour follows the theme.
      textTheme: Typography.material2021().black.apply(
            bodyColor: c.textPrimary,
            displayColor: c.textPrimary,
          ),

      appBarTheme: AppBarTheme(
        backgroundColor: c.surface,
        foregroundColor: c.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
          statusBarBrightness: isDark ? Brightness.dark : Brightness.light,
        ),
        titleTextStyle: styles.heading2,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: c.primary,
          foregroundColor: onPrimary,
          minimumSize: const Size(double.infinity, AppConstants.inputHeight),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppConstants.radiusButton),
          ),
          elevation: 0,
          textStyle: styles.button.copyWith(color: onPrimary),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.textPrimary,
          minimumSize: const Size(double.infinity, AppConstants.inputHeight),
          side: BorderSide(color: c.inputBorder),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppConstants.radiusButton),
          ),
          textStyle: styles.label,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: c.primary),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.inputFill,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppConstants.spacingMd,
          vertical: 14,
        ),
        border: border(c.inputBorder),
        enabledBorder: border(c.inputBorder),
        focusedBorder: border(c.primary, 1.5),
        errorBorder: border(error),
        focusedErrorBorder: border(error, 1.5),
        hintStyle: styles.bodyMedium,
        iconColor: c.inputIcon,
        prefixIconColor: c.inputIcon,
        suffixIconColor: c.inputIcon,
        labelStyle: styles.label,
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return c.primary;
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(onPrimary),
        side: BorderSide(color: c.inputBorder, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? onPrimary
              : (isDark ? c.textSecondary : Colors.white),
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? c.primary
              : (isDark ? c.inputBorder : const Color(0xFFD1D5DB)),
        ),
      ),

      dividerTheme: DividerThemeData(color: c.divider, thickness: 1, space: 1),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surface,
        modalBackgroundColor: c.surface,
      ),
      dialogTheme: DialogThemeData(backgroundColor: c.surface),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: c.surface,
        selectedItemColor: c.primary,
        unselectedItemColor: c.textSecondary,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? c.inputBorder : AppColors.textPrimary,
        contentTextStyle: const TextStyle(color: Colors.white),
      ),
    );
  }
}
