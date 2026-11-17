import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'sos_service.dart';

/// Reports the citizen's position to the API while an SOS alert is active.
///
/// The server decides whether contacts get an SMS (interval elapsed *and*
/// moved 100 m), so this only has to report regularly — at most once per
/// interval, plus whenever a move arrives after the interval has passed. A
/// periodic report also lets the server apply its 6-hour cap to a citizen who
/// has not moved.
///
/// On Android a foreground-service notification keeps the position stream
/// alive with the app in the background; iOS uses background location updates.
class SosLocationTracker {
  SosLocationTracker({
    required this.publicId,
    required this.interval,
    required this.onReport,
    required this.onStopped,
    SosService? service,
  }) : _service = service ?? SosService.instance;

  final String publicId;
  final Duration interval;
  final SosService _service;

  /// Called after each report reaches the server.
  final void Function(LocationUpdateResult result, DateTime at) onReport;

  /// Called once when the server ends updates.
  final VoidCallback onStopped;

  /// Shortens the reporting interval in on-device tests.
  @visibleForTesting
  static Duration? debugIntervalOverride;

  /// Hard client-side stop, matching the server's cap.
  static const maxDuration = Duration(hours: 6);

  StreamSubscription<Position>? _positions;
  Timer? _timer;
  Position? _latest;
  DateTime? _lastReportAt;
  DateTime? _startedAt;
  bool _reporting = false;
  bool _stopped = false;

  Duration get _interval => debugIntervalOverride ?? interval;

  void start() {
    _startedAt = DateTime.now();
    _positions = Geolocator.getPositionStream(locationSettings: _settings())
        .listen((position) {
      _latest = position;
      final last = _lastReportAt;
      if (last == null || DateTime.now().difference(last) >= _interval) {
        unawaited(_report());
      }
    }, onError: (_) {
      // Permission revoked or services turned off mid-alert: the periodic
      // timer keeps reporting the last known position.
    });
    _timer = Timer.periodic(_interval, (_) => unawaited(_report()));
  }

  Future<void> stop() async {
    _stopped = true;
    _timer?.cancel();
    await _positions?.cancel();
    _positions = null;
  }

  Future<void> _report() async {
    final position = _latest;
    if (_stopped || _reporting || position == null) return;
    if (DateTime.now().difference(_startedAt!) >= maxDuration) {
      await stop();
      onStopped();
      return;
    }
    _reporting = true;
    try {
      final now = DateTime.now();
      final result = await _service.sendLocation(
        publicId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        recordedAt: position.timestamp,
      );
      _lastReportAt = now;
      if (_stopped) return;
      onReport(result, now);
      if (result.stopUpdates) {
        await stop();
        onStopped();
      }
    } on SosException {
      // Offline: try again on the next tick. Updates never fall back to the
      // phone's SMS app — each one would need the citizen to tap Send.
    } finally {
      _reporting = false;
    }
  }

  LocationSettings _settings() {
    const distanceFilter = 100;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilter,
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'SOS active',
          notificationText:
              'Sharing your location with your trusted contacts. Open CivicAI to mark yourself safe.',
          notificationChannelName: 'SOS location sharing',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilter,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
        pauseLocationUpdatesAutomatically: false,
      );
    }
    return const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: distanceFilter,
    );
  }
}
