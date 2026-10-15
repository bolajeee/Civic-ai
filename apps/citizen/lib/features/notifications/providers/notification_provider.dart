import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/citizen_notification.dart';
import '../services/notification_service.dart';

class NotificationProvider extends ChangeNotifier {
  NotificationProvider() {
    _messageSubscription =
        _service.messages.listen((_) => unawaited(refresh()));
  }

  final NotificationService _service = NotificationService.instance;
  late final StreamSubscription<void> _messageSubscription;
  String? _citizenId;
  List<CitizenNotification> _items = const [];
  bool _enabled = true;
  bool _loading = false;
  String? _error;

  List<CitizenNotification> get items => List.unmodifiable(_items);
  bool get enabled => _enabled;
  bool get loading => _loading;
  String? get error => _error;
  int get unreadCount => _items.where((item) => !item.isRead).length;
  bool get pushConfigured => _service.isConfigured;

  void setCitizen(String? citizenId) {
    if (_citizenId == citizenId) return;
    _citizenId = citizenId;
    _items = const [];
    _error = null;
    if (citizenId != null) unawaited(_load());
    notifyListeners();
  }

  Future<void> _load() async {
    final owner = _citizenId;
    if (owner == null) return;
    _loading = true;
    notifyListeners();
    try {
      final results =
          await Future.wait([_service.getPreference(), _service.fetchInbox()]);
      if (_citizenId != owner) return;
      _enabled = results[0] as bool;
      _items = results[1] as List<CitizenNotification>;
      _error = null;
      if (_enabled) unawaited(_registerSilently());
    } catch (_) {
      if (_citizenId == owner)
        _error = 'Could not load notifications. Pull down to retry.';
    } finally {
      if (_citizenId == owner) {
        _loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> refresh() => _load();

  Future<void> setEnabled(bool value) async {
    final previous = _enabled;
    _enabled = value;
    _error = null;
    notifyListeners();
    try {
      await _service.setPreference(value);
      if (value) {
        final granted = await _service.registerDevice(requestPermission: true);
        if (!granted && _service.isConfigured) {
          _error =
              'Enable notifications in device Settings to receive push updates.';
        }
      } else {
        await _service.unregisterCurrentDevice();
      }
    } catch (_) {
      _enabled = previous;
      _error = 'Could not update notification preferences.';
    }
    notifyListeners();
  }

  Future<void> markRead(CitizenNotification item) async {
    if (item.isRead) return;
    final index = _items.indexWhere((value) => value.id == item.id);
    if (index < 0) return;
    final updated = [..._items]..[index] = item.markRead();
    _items = updated;
    notifyListeners();
    try {
      await _service.markRead(item.id);
    } catch (_) {
      await refresh();
    }
  }

  Future<void> registerAfterPermissionGrant() => _registerSilently();

  Future<void> _registerSilently() async {
    try {
      await _service.registerDevice();
    } catch (_) {
      // Registration is retried on the next authenticated load/token refresh.
    }
  }

  @override
  void dispose() {
    _messageSubscription.cancel();
    super.dispose();
  }
}
