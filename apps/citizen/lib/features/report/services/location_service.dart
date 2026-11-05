import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/constants/app_constants.dart';
import '../models/report_location.dart';

/// Why a location could not be captured.
///
/// These are kept distinct because each one has a different remedy, and telling
/// a citizen to "enable location" when the real problem is a denied permission
/// sends them to the wrong screen.
enum LocationFailure {
  /// Location services are switched off device-wide.
  serviceDisabled,

  /// The citizen declined this time. Asking again is reasonable.
  permissionDenied,

  /// The OS will not prompt again — only Settings can change this.
  permissionPermanentlyDenied,

  /// Permission is fine but no fix arrived before the deadline, which is the
  /// normal outcome indoors.
  unavailable,
}

extension LocationFailureMessage on LocationFailure {
  /// One line, aimed at the citizen, naming the remedy where there is one.
  String get message {
    switch (this) {
      case LocationFailure.serviceDisabled:
        return 'Location is turned off. Turn it on to attach where this is.';
      case LocationFailure.permissionDenied:
        return 'Location access denied. You can still submit without it.';
      case LocationFailure.permissionPermanentlyDenied:
        return 'Location access is blocked. Enable it in Settings, or submit '
            'without it.';
      case LocationFailure.unavailable:
        return 'Could not get a location fix. You can still submit without it.';
    }
  }

  /// Whether "Open Settings" is the remedy — the same distinction the photo
  /// picker makes, and for the same reason.
  bool get requiresSettings =>
      this == LocationFailure.permissionPermanentlyDenied ||
      this == LocationFailure.serviceDisabled;
}

/// Thrown when a coordinate could not be obtained.
///
/// Deliberately *not* fatal to a report: a citizen indoors or underground must
/// still be able to report a hazard. Callers catch this, show [failure]'s
/// message, and submit without a location.
class LocationException implements Exception {
  const LocationException(this.failure);

  final LocationFailure failure;

  @override
  String toString() => 'LocationException(${failure.name})';
}

/// Applies the quality boundary used before any live or cached fix is accepted.
@visibleForTesting
bool isUsableReportPosition(Position position, DateTime now) {
  if (!position.latitude.isFinite ||
      !position.longitude.isFinite ||
      !position.accuracy.isFinite ||
      position.latitude < -90 ||
      position.latitude > 90 ||
      position.longitude < -180 ||
      position.longitude > 180 ||
      position.accuracy < 0 ||
      position.accuracy > AppConstants.reportLocationMaxAccuracyMetres) {
    return false;
  }
  final age = now.toUtc().difference(position.timestamp.toUtc());
  return age <= AppConstants.reportLocationMaxAge &&
      age >= const Duration(minutes: -1);
}

/// Resolves the device's current position and, where possible, a street
/// address for it.
///
/// The address is a nicety, never a requirement: reverse geocoding is provided
/// by the platform (Google Play Services on Android, `CLGeocoder` on iOS) and
/// simply has no answer in some places, and none at all on a bare emulator.
/// Coordinates alone are a perfectly good location, so a geocoding failure is
/// swallowed and [ReportLocation.address] stays null.
class LocationService {
  LocationService._();
  static final LocationService instance = LocationService._();

  /// Captures a location, or throws [LocationException] explaining why not.
  Future<ReportLocation> capture() async {
    await _ensurePermission();

    final sample = await _bestPosition();

    return ReportLocation(
      latitude: sample.position.latitude,
      longitude: sample.position.longitude,
      accuracy: sample.position.accuracy,
      source: sample.source,
      capturedAt: sample.position.timestamp,
    );
  }

  Future<ReportLocation> reverseGeocode(ReportLocation location) async =>
      location.withAddress(
        await _reverseGeocode(location.latitude, location.longitude),
      );

  /// Opens the OS settings page for this app, so the citizen can undo a
  /// permanent denial without hunting through the Settings app.
  ///
  /// A no-op on web, where `geolocator_web` throws `UnsupportedError` for both
  /// settings methods — and where there is no app settings page to open anyway.
  /// The browser's own site-permission UI is the remedy there.
  Future<void> openSettings() =>
      kIsWeb ? Future.value() : Geolocator.openAppSettings();

  /// Opens the device's location-services toggle. Also a no-op on web, for the
  /// same reason.
  Future<void> openLocationSettings() =>
      kIsWeb ? Future.value() : Geolocator.openLocationSettings();

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  Future<void> _ensurePermission() async {
    // Services first: with them off, every permission is moot and the OS
    // reports `denied` regardless of what the citizen previously chose, which
    // would send them to a permission prompt that cannot help.
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationException(LocationFailure.serviceDisabled);
    }

    var permission = await Geolocator.checkPermission();

    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.deniedForever) {
      // On web this is not a permanent denial: `geolocator_web` maps *any*
      // failed prompt to `deniedForever`, and there is no app settings page to
      // send the citizen to. Reporting it as an ordinary denial keeps the field
      // offering "Try again" instead of a button that cannot work.
      throw const LocationException(
        kIsWeb
            ? LocationFailure.permissionDenied
            : LocationFailure.permissionPermanentlyDenied,
      );
    }
    if (permission == LocationPermission.denied) {
      throw const LocationException(LocationFailure.permissionDenied);
    }
  }

  /// Collects a bounded set of fixes and returns the most accurate valid one.
  Future<_PositionSample> _bestPosition() async {
    final positions = <Position>[];
    StreamSubscription<Position>? subscription;
    Timer? deadline;

    try {
      final done = Completer<void>();
      subscription = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
          distanceFilter: 0,
        ),
      ).listen((position) {
        if (!_isValid(position, DateTime.now())) return;
        positions.add(position);
        final enough =
            positions.length >= AppConstants.reportLocationSampleCount;
        final accurateEnough = positions.length >= 2 &&
            positions.any((item) =>
                item.accuracy <=
                AppConstants.reportLocationTargetAccuracyMetres);
        if ((enough || accurateEnough) && !done.isCompleted) done.complete();
      }, onError: (_) {
        if (!done.isCompleted) done.complete();
      });
      deadline = Timer(AppConstants.reportLocationTimeout, () {
        if (!done.isCompleted) done.complete();
      });
      await done.future;
    } catch (_) {
      // The bounded cached fallback below may still provide a valid fix.
    } finally {
      deadline?.cancel();
      await subscription?.cancel();
    }

    if (positions.isNotEmpty) {
      positions.sort((a, b) => a.accuracy.compareTo(b.accuracy));
      return _PositionSample(positions.first, ReportLocationSource.deviceGps);
    }

    if (!kIsWeb) {
      try {
        final cached = await Geolocator.getLastKnownPosition();
        if (cached != null && _isValid(cached, DateTime.now())) {
          return _PositionSample(cached, ReportLocationSource.cachedGps);
        }
      } catch (_) {
        // An unavailable platform cache is equivalent to an empty cache.
      }
    }

    throw const LocationException(LocationFailure.unavailable);
  }

  bool _isValid(Position position, DateTime now) {
    return isUsableReportPosition(position, now);
  }

  /// Best-effort street address. Returns null on any failure, by design.
  Future<String?> _reverseGeocode(double latitude, double longitude) async {
    try {
      final placemarks = await placemarkFromCoordinates(
        latitude,
        longitude,
      );

      if (placemarks.isEmpty) return null;

      return _formatPlacemark(placemarks.first);
    } catch (_) {
      // No geocoder, no network, or no result for these coordinates. The
      // ReportLocation falls back to showing the coordinates themselves.
      return null;
    }
  }

  /// Joins the parts of a placemark worth showing, from the most specific down.
  ///
  /// `name` is deliberately excluded: on both platforms it tends to hold the
  /// full formatted address, so including it alongside the components would
  /// repeat most of the string.
  String? _formatPlacemark(Placemark placemark) {
    final parts = <String>[
      if (_hasText(placemark.street)) placemark.street!,
      if (_hasText(placemark.subLocality)) placemark.subLocality!,
      if (_hasText(placemark.locality)) placemark.locality!,
      if (_hasText(placemark.administrativeArea)) placemark.administrativeArea!,
    ];

    final unique = <String>[];
    for (final part in parts) {
      if (!unique.contains(part)) unique.add(part);
    }

    if (unique.isEmpty) return null;
    return unique.join(', ');
  }

  bool _hasText(String? value) => value != null && value.trim().isNotEmpty;
}

class _PositionSample {
  const _PositionSample(this.position, this.source);
  final Position position;
  final ReportLocationSource source;
}
