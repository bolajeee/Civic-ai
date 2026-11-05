import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

import '../services/offline_report_queue.dart';

class ReportSyncProvider extends ChangeNotifier {
  ReportSyncProvider({
    OfflineReportQueue? queue,
    Connectivity? connectivity,
  })  : _queue = queue ?? OfflineReportQueue.instance,
        _connectivity = connectivity ?? Connectivity() {
    _connectivitySubscription =
        _connectivity.onConnectivityChanged.listen(_connectivityChanged);
  }

  final OfflineReportQueue _queue;
  final Connectivity _connectivity;
  late final StreamSubscription<List<ConnectivityResult>>
      _connectivitySubscription;

  String? _citizenId;
  int _pendingCount = 0;
  bool _isSyncing = false;
  int _lastSyncedCount = 0;

  int get pendingCount => _pendingCount;
  bool get isSyncing => _isSyncing;
  int get lastSyncedCount => _lastSyncedCount;

  void setCitizen(String? citizenId) {
    if (_citizenId == citizenId) return;
    _citizenId = citizenId;
    _pendingCount = 0;
    _lastSyncedCount = 0;
    notifyListeners();
    if (citizenId != null) unawaited(refreshAndSync());
  }

  Future<void> refresh() async {
    _pendingCount = await _queue.countFor(_citizenId);
    notifyListeners();
  }

  Future<void> refreshAndSync() async {
    final citizenId = _citizenId;
    if (citizenId == null || _isSyncing) return;
    _isSyncing = true;
    notifyListeners();
    try {
      _lastSyncedCount = await _queue.sync(citizenId);
      _pendingCount = await _queue.countFor(citizenId);
    } finally {
      _isSyncing = false;
      notifyListeners();
    }
  }

  void _connectivityChanged(List<ConnectivityResult> results) {
    if (results.any((result) => result != ConnectivityResult.none)) {
      unawaited(refreshAndSync());
    }
  }

  @override
  void dispose() {
    _connectivitySubscription.cancel();
    super.dispose();
  }
}
