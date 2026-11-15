import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/app_constants.dart';

class AppSettingsProvider extends ChangeNotifier {
  ThemeMode _themeMode = ThemeMode.light;
  bool _notificationsEnabled = true;

  bool get darkMode => _themeMode == ThemeMode.dark;
  bool get notificationsEnabled => _notificationsEnabled;
  ThemeMode get themeMode => _themeMode;

  Future<void> initialize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(AppConstants.keyThemeMode);
      if (stored != null) {
        _themeMode = ThemeMode.values.firstWhere(
          (m) => m.name == stored,
          orElse: () => ThemeMode.light,
        );
      } else {
        // Settings saved before the "follow system" option existed.
        _themeMode = (prefs.getBool(AppConstants.keyDarkMode) ?? false)
            ? ThemeMode.dark
            : ThemeMode.light;
      }
      _notificationsEnabled =
          prefs.getBool(AppConstants.keyNotificationsEnabled) ?? true;
    } catch (_) {
      // Keep the in-memory defaults if preferences are temporarily
      // unavailable; settings can still be changed normally in this session.
    } finally {
      // Initialization now runs after runApp(), so publish the restored values
      // to MaterialApp once the platform-backed preferences call completes.
      notifyListeners();
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;
    _themeMode = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(AppConstants.keyThemeMode, mode.name);
    // Keep the legacy flag in step for anything still reading it.
    await prefs.setBool(AppConstants.keyDarkMode, mode == ThemeMode.dark);
  }

  Future<void> setDarkMode(bool value) =>
      setThemeMode(value ? ThemeMode.dark : ThemeMode.light);

  Future<void> setNotificationsEnabled(bool value) async {
    if (_notificationsEnabled == value) return;
    _notificationsEnabled = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyNotificationsEnabled, value);
  }
}
