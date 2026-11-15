import 'package:civic_report/core/constants/app_constants.dart';
import 'package:civic_report/core/providers/app_settings_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('loads and persists theme and notification settings', () async {
    SharedPreferences.setMockInitialValues({
      AppConstants.keyDarkMode: true,
      AppConstants.keyNotificationsEnabled: false,
    });
    final settings = AppSettingsProvider();
    await settings.initialize();

    expect(settings.themeMode, ThemeMode.dark);
    expect(settings.notificationsEnabled, isFalse);

    await settings.setThemeMode(ThemeMode.system);
    expect(settings.themeMode, ThemeMode.system);
    await settings.setDarkMode(false);
    await settings.setNotificationsEnabled(true);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool(AppConstants.keyDarkMode), isFalse);
    expect(prefs.getBool(AppConstants.keyNotificationsEnabled), isTrue);
  });
}
