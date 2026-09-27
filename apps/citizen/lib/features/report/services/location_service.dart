import 'package:flutter/foundation.dart' show kIsWeb;
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

    final position = await _currentPosition();

    return ReportLocation(
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
      address: await _reverseGeocode(position),
    );
  }

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

  /// A single fix, biased towards speed over precision.
  ///
  /// No continuous stream: a report is pinned to where the citizen stood when
  /// they filed it, not to where they walked afterwards.
  Future<Position> _currentPosition() async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: AppConstants.reportLocationTimeout,
        ),
      );
    } catch (_) {
      // `getCurrentPosition` throws on timeout and on a failed fix. Fall back
      // to the last known position — a fix from a minute ago is still far more
      // useful on a report than no location at all.
      //
      // Skipped on web, where `getLastKnownPosition` is unimplemented and throws
      // rather than returning null, which would escape this method instead of
      // becoming the `unavailable` failure the caller knows how to report.
      if (!kIsWeb) {
        final lastKnown = await Geolocator.getLastKnownPosition();
        if (lastKnown != null) return lastKnown;
      }

      throw const LocationException(LocationFailure.unavailable);
    }
  }

  /// Best-effort street address. Returns null on any failure, by design.
  Future<String?> _reverseGeocode(Position position) async {
    try {
      final placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
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
      if (_hasText(placemark.administrativeArea))
        placemark.administrativeArea!,
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
