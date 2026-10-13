import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/app_constants.dart';

class AppSettingsProvider extends ChangeNotifier {
  bool _darkMode = false;
  bool _notificationsEnabled = true;
  String _languageCode = 'en';

  bool get darkMode => _darkMode;
  bool get notificationsEnabled => _notificationsEnabled;
  String get languageCode => _languageCode;
  ThemeMode get themeMode => _darkMode ? ThemeMode.dark : ThemeMode.light;
  Locale get locale => Locale(_languageCode);

  Future<void> initialize() async {
    final prefs = await SharedPreferences.getInstance();
    _darkMode = prefs.getBool(AppConstants.keyDarkMode) ?? false;
    _notificationsEnabled =
        prefs.getBool(AppConstants.keyNotificationsEnabled) ?? true;
    _languageCode = prefs.getString(AppConstants.keyLanguage) ?? 'en';
  }

  Future<void> setDarkMode(bool value) async {
    if (_darkMode == value) return;
    _darkMode = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyDarkMode, value);
  }

  Future<void> setNotificationsEnabled(bool value) async {
    if (_notificationsEnabled == value) return;
    _notificationsEnabled = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(AppConstants.keyNotificationsEnabled, value);
  }

  Future<void> setLanguage(String value) async {
    if (_languageCode == value) return;
    _languageCode = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(AppConstants.keyLanguage, value);
  }
}
