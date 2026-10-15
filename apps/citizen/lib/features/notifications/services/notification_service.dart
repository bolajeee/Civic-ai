import 'dart:async';

import 'package:dio/dio.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../../core/services/api_client.dart';
import '../models/citizen_notification.dart';

class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final Dio _dio = ApiClient.instance.dio;
  final _openedRoutes = StreamController<String>.broadcast();
  final _messages = StreamController<void>.broadcast();
  bool _initialized = false;
  StreamSubscription<String>? _tokenSubscription;

  Stream<String> get openedRoutes => _openedRoutes.stream;
  Stream<void> get messages => _messages.stream;

  static const _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _senderId =
      String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const _androidAppId =
      String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const _iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const _iosBundleId = String.fromEnvironment('FIREBASE_IOS_BUNDLE_ID');

  bool get isConfigured {
    if (kIsWeb) return false;
    final appId =
        defaultTargetPlatform == TargetPlatform.iOS ? _iosAppId : _androidAppId;
    return _apiKey.isNotEmpty &&
        _projectId.isNotEmpty &&
        _senderId.isNotEmpty &&
        appId.isNotEmpty;
  }

  Future<bool> initialize() async {
    if (_initialized) return true;
    if (!isConfigured) return false;
    final isIos = defaultTargetPlatform == TargetPlatform.iOS;
    final appId = isIos ? _iosAppId : _androidAppId;
    await Firebase.initializeApp(
      options: FirebaseOptions(
        apiKey: _apiKey,
        appId: appId,
        messagingSenderId: _senderId,
        projectId: _projectId,
        iosBundleId: isIos && _iosBundleId.isNotEmpty ? _iosBundleId : null,
      ),
    );
    final messaging = FirebaseMessaging.instance;
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
    FirebaseMessaging.onMessage.listen((_) => _messages.add(null));
    FirebaseMessaging.onMessageOpenedApp.listen(_emitRoute);
    _emitRoute(await messaging.getInitialMessage());
    _tokenSubscription = messaging.onTokenRefresh.listen((token) async {
      try {
        await _registerToken(token);
      } catch (_) {}
    });
    _initialized = true;
    return true;
  }

  void _emitRoute(RemoteMessage? message) {
    final route = message?.data['route'];
    if (route is String && route.startsWith('/report-details/'))
      _openedRoutes.add(route);
  }

  Future<bool> registerDevice({bool requestPermission = false}) async {
    if (!await initialize()) return false;
    final messaging = FirebaseMessaging.instance;
    if (requestPermission) {
      await messaging.requestPermission(alert: true, badge: true, sound: true);
    }
    final settings = await messaging.getNotificationSettings();
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      return false;
    }
    await messaging.setAutoInitEnabled(true);
    final token = await messaging.getToken();
    if (token == null) return false;
    await _registerToken(token);
    return true;
  }

  Future<void> _registerToken(String token) =>
      _dio.post('/api/notifications/devices', data: {
        'token': token,
        'platform':
            defaultTargetPlatform == TargetPlatform.iOS ? 'IOS' : 'ANDROID',
      });

  Future<void> unregisterCurrentDevice() async {
    try {
      if (!_initialized) return;
      final messaging = FirebaseMessaging.instance;
      final token = await messaging.getToken();
      if (token != null) {
        try {
          await _dio.delete(
            '/api/notifications/devices',
            data: {'token': token},
          );
        } catch (_) {}
      }
      await messaging.setAutoInitEnabled(false);
      await messaging.deleteToken();
    } catch (_) {
      // Device cleanup is best effort and must never prevent sign-out.
    }
  }

  Future<bool> getPreference() async {
    final response = await _dio.get('/api/notifications/preferences');
    return (response.data as Map<String, dynamic>)['reportUpdatesEnabled']
        as bool;
  }

  Future<void> setPreference(bool enabled) =>
      _dio.patch('/api/notifications/preferences',
          data: {'reportUpdatesEnabled': enabled});

  Future<List<CitizenNotification>> fetchInbox() async {
    final response = await _dio.get(
      '/api/notifications/',
      queryParameters: {'limit': 100},
    );
    final values = (response.data as Map<String, dynamic>)['notifications']
        as List<dynamic>;
    return values
        .map(
          (value) =>
              CitizenNotification.fromJson(value as Map<String, dynamic>),
        )
        .toList();
  }

  Future<void> markRead(String id) => _dio.post('/api/notifications/$id/read');

  @visibleForTesting
  Future<void> dispose() async {
    await _tokenSubscription?.cancel();
    await _openedRoutes.close();
    await _messages.close();
  }
}
